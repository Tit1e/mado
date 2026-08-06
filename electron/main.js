/**
 * [INPUT]: 依赖 Electron 窗口/菜单/IPC 能力、PTY/Shell 集成/恢复/退出/开发刷新等领域服务、../server.js 与端口配置
 * [OUTPUT]: 对外提供 Mado 桌面主进程、PTY/恢复与文件/剪贴板/更新/菜单语言 IPC、Codex 新会话与命令重启快捷键、开发热重载、菜单和窗口生命周期
 * [POS]: electron 模块的主进程编排器，与 preload.js 和开发监督脚本协作连接渲染层、本地服务和操作系统
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
'use strict';
const { app, BrowserWindow, ipcMain, shell, nativeImage, Menu, clipboard, dialog, net, session } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { resolvePort } = require('../port-config');
const {
  validVersion, validGithubUrl,
} = require('./ipc-validation');
const { createPtyService } = require('./pty-service');
const { createFileWatchService } = require('./file-watch-service');
const { createSystemFileService } = require('./system-file-service');
const { createLidGuard } = require('./power-service');
const { createQuitGuard } = require('./quit-service');
const { createZshIntegration } = require('./shell-integration');
const { createTerminalRecoveryStore } = require('./terminal-recovery-store');
const { createDevReloadService } = require('./dev-reload-service');

const APP_NAME = 'Mado';
app.setName(APP_NAME);
// 正式版与开发版使用独立目录，避免同时运行时共享 Chromium 状态和窗口配置。
app.setPath('userData', path.join(app.getPath('appData'), app.isPackaged ? 'Mado' : 'Mado Dev'));

// 复用现有后端：require 即 listen 127.0.0.1:PORT，不自动开浏览器
process.env.MADO_NO_OPEN = '1';
const PORT = resolvePort({ dev: !app.isPackaged });
process.env.MADO_PORT = String(PORT);
require('../server.js');

// node-pty 是原生模块，需 electron-rebuild 编译过；未就绪时终端能力降级但 app 仍可用
let pty = null;
try { pty = require('node-pty'); }
catch (e) { console.error('[mado] node-pty 未就绪（跑 npm run rebuild）：', e.message); }

let win = null;
const send = (channel, payload) => {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
};
let terminalCount = 0;
const lidGuard = createLidGuard({
  platform: process.platform,
  setDisableSleep: trySetDisableSleep,
  persist: (value) => writeConfig({ lidStayAwake: value }),
  onChange: () => buildMenu(),
});
const zshIntegration = createZshIntegration(app.getPath('userData'));
const recoveryStore = createTerminalRecoveryStore(app.getPath('userData'));
const ptyService = createPtyService({ pty, send, zshIntegration, onCountChange: (count) => { terminalCount = count; lidGuard.refresh(count); } });
const watchService = createFileWatchService({ send });
const systemFileService = createSystemFileService({ app, nativeImage, clipboard });

// ---------- 窗口尺寸/位置记忆 ----------
const stateFile = () => path.join(app.getPath('userData'), 'window-state.json');
function loadBounds() {
  try {
    const b = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
    if (b && b.width > 400 && b.height > 300) return b;
  } catch { /* 首次启动无记录 */ }
  return { width: 1320, height: 860 };
}
function saveBounds() {
  if (!win || win.isDestroyed() || win.isMinimized()) return;
  try { fs.writeFileSync(stateFile(), JSON.stringify(win.getBounds())); } catch { /* */ }
}

function createWindow() {
  const b = loadBounds();
  win = new BrowserWindow({
    width: b.width, height: b.height, x: b.x, y: b.y,
    minWidth: 920, minHeight: 600,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0b0c0a',
    vibrancy: 'sidebar',
    visualEffectState: 'active',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  // 拖动/缩放后防抖记忆，关窗再存一次兜底
  let bt = null;
  const remember = () => { clearTimeout(bt); bt = setTimeout(saveBounds, 400); };
  win.on('resize', remember);
  win.on('move', remember);
  // macOS：点左上角红叉只隐藏到 Dock（保活渲染进程，所有界面/终端状态原样保留），真正退出走 ⌘Q。
  win.on('close', (e) => {
    saveBounds();
    if (process.platform === 'darwin' && !quitGuard.isQuitting()) { e.preventDefault(); win.hide(); }
  });

  // 等后端起来再加载（首次 listen 有几十毫秒延迟）
  const load = () => win.loadURL(`http://localhost:${PORT}`).catch(() => setTimeout(load, 150));
  setTimeout(load, 250);

  // 外部链接走系统浏览器，不在 app 里开新窗口
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) { shell.openExternal(url); return { action: 'deny' }; }
    return { action: 'allow' };
  });

  win.on('closed', () => { win = null; });
}

app.whenReady().then(() => {
  // 开发模式下 macOS 默认显示 Electron 图标——换成 Mado 自己的（打包后由 electron-builder 的 icon 接管）
  if (process.platform === 'darwin' && app.dock) {
    try { app.dock.setIcon(nativeImage.createFromPath(path.join(__dirname, '..', 'build', 'icon.png'))); } catch { /* */ }
  }
  // 后端跑在 localhost，访问它永不该走代理。个别环境（clash 强制系统代理、企业 PAC 把 loopback 也代理）
  // 会把本地请求拦成 502 → 整个界面白屏。给 loopback 显式加旁路；其余（如查更新走 GitHub）仍按系统代理，互不影响。
  session.defaultSession.setProxy({ mode: 'system', proxyBypassRules: 'localhost;127.0.0.1;[::1]' }).catch(() => { /* 设置失败就退回默认行为，不影响启动 */ });
  // 合盖继续运行：恢复上次的开关意图；启动时把残留的禁休眠清掉（防上次崩溃没恢复），有终端跑起来再按需重新生效
  lidGuard.restore(!!readConfig().lidStayAwake, terminalCount);
  if (process.platform === 'darwin') trySetDisableSleep(false);
  buildMenu();
  try {
    const m = Menu.getApplicationMenu();
    const view = m && m.items.find((i) => i.label === M('视图', 'View'));
    console.log('[lid] 视图 子菜单 =', view ? JSON.stringify(view.submenu.items.map((x) => x.label || `<${x.type}>`)) : '没找到视图菜单');
  } catch (e) { console.log('[lid] dump menu 出错:', e.message); }
  createWindow();
  // 临时调试：dev 实例强制抢到最前，避免和正式版搞混
  setTimeout(() => { try { app.focus({ steal: true }); if (win && !win.isDestroyed()) { win.show(); win.focus(); win.setAlwaysOnTop(true); setTimeout(() => win.setAlwaysOnTop(false), 1500); } } catch { /* */ } }, 1200);
  startShotWatch();
  // 启动 6 秒后查一次新版本（不挡启动）；长开会话每 2 小时再查；
  // 窗口重新聚焦也顺手查（30 分钟节流）——否则发版当天老 app 要等满周期才知道有新版
  setTimeout(checkUpdate, 6000);
  setInterval(checkUpdate, 2 * 3600 * 1000);
  app.on('browser-window-focus', () => {
    if (Date.now() - lastAutoCheck > 30 * 60 * 1000) checkUpdate();
  });
});

// ---------- 截图直通车：监听系统截屏落盘，新截图推给渲染层浮出直通卡 ----------
function screenshotDir() {
  try {
    const out = require('child_process').execSync('defaults read com.apple.screencapture location 2>/dev/null', { encoding: 'utf8' }).trim();
    if (out) return out.startsWith('~') ? path.join(os.homedir(), out.slice(1)) : out;
  } catch { /* 未自定义 → 默认桌面 */ }
  return path.join(os.homedir(), 'Desktop');
}
let shotWatcher = null;
const shotSent = new Map(); // path -> t，fs.watch 同一文件会连发多个事件，3s 内去重
function startShotWatch() {
  if (process.platform !== 'darwin' || shotWatcher) return;
  const dir = screenshotDir();
  if (!fs.existsSync(dir)) return;
  try {
    shotWatcher = fs.watch(dir, { persistent: false }, (evt, filename) => {
      const name = filename ? filename.toString() : '';
      // 截屏写盘有「.截屏xxx.png」点前缀的中间态，跳过；只认系统截屏的命名习惯
      if (!/^(截屏|截圖|截图|Screenshot|Screen Shot|CleanShot|SCR-)/i.test(name) || !/\.(png|jpe?g)$/i.test(name)) return;
      const fp = path.join(dir, name);
      // 等写盘「真正完成」再通知：Retina 全屏截图有几 MB，固定等 600ms 可能文件还在写，
      // 缩略图会拿到半截文件生成失败→裂图。改成轮询直到大小连续两次不变（最多 ~3s）。
      const waitStable = (tries, lastSize) => {
        fs.stat(fp, (err, st) => {
          if (err || !st.isFile()) return;
          if (st.size >= 1000 && st.size === lastSize) { // 大小稳定 = 写完
            const last = shotSent.get(fp) || 0;
            if (Date.now() - last < 3000) return;
            shotSent.set(fp, Date.now());
            if (shotSent.size > 50) { const k = shotSent.keys().next().value; shotSent.delete(k); }
            if (win && !win.isDestroyed()) win.webContents.send('shot:new', { path: fp, name, size: st.size });
            return;
          }
          if (tries > 0) setTimeout(() => waitStable(tries - 1, st.size), 250); // 还在涨，再等
        });
      };
      setTimeout(() => waitStable(12, -1), 350);
    });
  } catch { /* 无权限等，静默放弃 */ }
}

// ---------- 更新检测：查 GitHub Releases，有新版本通知渲染层引导下载 ----------
// 现阶段只做「检测 + 引导」：Apple Development 签名过不了 Squirrel.Mac 的校验，
// electron-updater 全自动更新要等升级 Developer ID 后再换
function cmpVer(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map(Number);
  const pb = String(b).replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d; }
  return 0;
}
const RELEASE_REPO = 'Tit1e/mado';
const REL_PAGE = `https://github.com/${RELEASE_REPO}/releases/latest`;
async function fetchLatestRelease() {
  // 先走 API（信息全）；代理共享出口 IP 很容易吃 GitHub API 的未认证限流（60 次/小时/IP，403），
  // 失败就退回抓 releases/latest 网页重定向——重定向后的 URL 自带 tag，且不占 API 配额
  try {
    const res = await net.fetch(`https://api.github.com/repos/${RELEASE_REPO}/releases/latest`, {
      headers: { 'User-Agent': 'mado-app', Accept: 'application/vnd.github+json' },
    });
    if (res.ok) {
      const rel = await res.json();
      if (rel.tag_name) return { tag: rel.tag_name, url: rel.html_url || REL_PAGE };
    }
  } catch { /* 走兜底 */ }
  const res = await net.fetch(REL_PAGE, { headers: { 'User-Agent': 'mado-app' } });
  const m = String(res.url || '').match(/\/releases\/tag\/([^/?#]+)/);
  if (m) return { tag: decodeURIComponent(m[1]), url: res.url };
  return null;
}
let pendingUpdate = null; // 渲染层晚注册监听也能拉到（启动 6 秒的推送 vs init 加载大目录，谁先谁后说不准）
let updRetry = 0;
let lastAutoCheck = 0;
async function checkUpdate(opts) {
  const manual = !!(opts && opts.manual);
  if (!manual) lastAutoCheck = Date.now();
  let info = null;
  try { info = await fetchLatestRelease(); } catch { info = null; }
  if (!info) {
    if (manual) {
      dialog.showMessageBoxSync(win && !win.isDestroyed() ? win : undefined, {
        type: 'warning', buttons: [M('好', 'OK')], message: M('检查更新失败', 'Update check failed'),
        detail: M('没连上 GitHub（网络问题或接口限流），稍后再试。', 'Could not reach GitHub (network issue or rate limit). Try again later.'),
      });
    } else if (updRetry < 3) { updRetry++; setTimeout(checkUpdate, 10 * 60 * 1000); } // 失败别干等 12 小时
    return;
  }
  updRetry = 0;
  const newer = cmpVer(info.tag, app.getVersion()) > 0;
  if (newer) {
    pendingUpdate = { version: info.tag.replace(/^v/, ''), url: info.url };
    if (win && !win.isDestroyed()) win.webContents.send('update:available', pendingUpdate);
  }
  if (manual) {
    const owner = win && !win.isDestroyed() ? win : undefined;
    if (newer) {
      const c = dialog.showMessageBoxSync(owner, {
        type: 'info', buttons: [M('去下载', 'Download'), M('取消', 'Cancel')], defaultId: 0, cancelId: 1,
        message: M(`发现新版本 v${pendingUpdate.version}`, `New version v${pendingUpdate.version} available`),
        detail: M(`当前版本 v${app.getVersion()}。点「去下载」打开发布页，下载后替换 /Applications 里的旧版即可。`, `You are on v${app.getVersion()}. "Download" opens the release page; replace the old app in /Applications.`),
      });
      if (c === 0) shell.openExternal(pendingUpdate.url);
    } else {
      dialog.showMessageBoxSync(owner, {
        type: 'info', buttons: [M('好', 'OK')], message: M('已是最新版本', 'You are up to date'),
        detail: M(`当前版本 v${app.getVersion()} 就是最新发布版。`, `v${app.getVersion()} is the latest release.`),
      });
    }
  }
}
ipcMain.handle('update:open', (e, { url }) => { if (validGithubUrl(url)) shell.openExternal(url); });
ipcMain.handle('update:get', () => pendingUpdate);

// #26 应用内下载更新：按当前架构拼 dmg 资产地址（发布产物统一 Mado-<版本>-<arch>.dmg），
// 下到 ~/Downloads 后直接打开挂载，拖进 Applications 即完成。全自动安装（Squirrel）仍要等 Developer ID 签名
let updDownloading = false;
ipcMain.handle('update:download', async (e, { version }) => {
  if (updDownloading) return { ok: false, error: 'busy' };
  const ver = validVersion(version);
  if (!ver) return { ok: false, error: 'bad version' };
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  const assetName = `${APP_NAME}-${ver}-${arch}.dmg`;
  const url = `https://github.com/${RELEASE_REPO}/releases/download/v${ver}/${assetName}`;
  const dest = path.join(app.getPath('downloads'), assetName);
  const send = (m) => { if (win && !win.isDestroyed()) win.webContents.send('update:progress', m); };
  updDownloading = true;
  const tmp = dest + '.part';
  try {
    const res = await net.fetch(url, { headers: { 'User-Agent': 'mado-app' } });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    const total = Number(res.headers.get('content-length')) || 0;
    const out = fs.createWriteStream(tmp);
    let got = 0, lastPct = -1;
    for await (const chunk of res.body) {
      const buf = Buffer.from(chunk);
      if (!out.write(buf)) await new Promise((r) => out.once('drain', r));
      got += buf.length;
      const pct = total ? Math.floor((got / total) * 100) : -1;
      if (pct !== lastPct) { lastPct = pct; send({ state: 'downloading', pct }); }
    }
    await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
    await fs.promises.rename(tmp, dest);
    send({ state: 'done', file: dest });
    shell.openPath(dest);
    return { ok: true, file: dest };
  } catch (err) {
    fs.promises.unlink(tmp).catch(() => {});
    send({ state: 'error', error: String((err && err.message) || err) });
    return { ok: false, error: String((err && err.message) || err) };
  } finally { updDownloading = false; }
});

// 点完成通知把 app 拉到前台（渲染层 window.focus() 唤不醒最小化/被遮挡的窗口）
ipcMain.handle('win:focus', () => {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
});

// 预览全屏时藏掉左上角红黄绿系统按钮——它和右侧自家关闭图标太像，容易让人误点
ipcMain.handle('win:traffic', (e, { show }) => {
  if (!win || win.isDestroyed() || typeof win.setWindowButtonVisibility !== 'function') return;
  win.setWindowButtonVisibility(!!show);
});

// 界面语言：用户手动选过的存在 ~/.mado/config.json（渲染层切换时写入），没选过跟随系统
function uiLang() {
  try {
    const c = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.mado', 'config.json'), 'utf8'));
    if (c.lang === 'zh' || c.lang === 'en') return c.lang;
  } catch { /* 没配置过 */ }
  return String(app.getLocale() || '').toLowerCase().startsWith('zh') ? 'zh' : 'en';
}
const M = (zh, en) => (uiLang() === 'zh' ? zh : en);
const devReloadService = createDevReloadService({ app, dialog, ptyService, getWindow: () => win, translate: M });
if (process.env.MADO_DEV_WATCH === '1') {
  process.on('message', (message) => {
    if (message && message.type === 'mado-dev') devReloadService.request(message.action);
  });
}

// ---------- 合盖继续运行（禁用合盖休眠）----------
// macOS 的「合盖休眠」是独立机制，caffeinate / powerSaveBlocker 这类 power assertion 都挡不住，
// 唯一手段是 `pmset -a disablesleep 1`（需 root）。为避免智能模式反复弹密码，首次开启时装一条
// 仅限 pmset disablesleep 0/1 的 sudoers 免密规则，之后静默切换。
// 智能模式：只有「开关开 且 有终端在跑」才真正禁休眠；终端全退/退出 app 立即恢复，绝不让 Mac 一直不睡。
const CONFIG = path.join(os.homedir(), '.mado', 'config.json');
function readConfig() { try { return JSON.parse(fs.readFileSync(CONFIG, 'utf8')); } catch { return {}; } }
function writeConfig(patch) {
  try { const c = readConfig(); Object.assign(c, patch); fs.mkdirSync(path.dirname(CONFIG), { recursive: true }); fs.writeFileSync(CONFIG, JSON.stringify(c, null, 2)); }
  catch { /* 写失败不致命，下次再写 */ }
}
// 用 sudo -n（非交互）切换；sudoers 没装好就直接失败、绝不在后台弹密码
function trySetDisableSleep(on) {
  if (process.platform !== 'darwin') return false;
  // stdio 全静音：免密规则没装时 `sudo -n` 会往 stderr 喷「a password is required」，无害但会误导
  try { require('child_process').execFileSync('/usr/bin/sudo', ['-n', 'pmset', '-a', 'disablesleep', on ? '1' : '0'], { stdio: 'ignore' }); return true; }
  catch { return false; }
}

// 首次开启时弹一次系统管理员框，装仅限本用户、仅限 pmset disablesleep 0/1 的免密规则
function installSudoers() {
  return new Promise((resolve) => {
    const user = (os.userInfo().username || '').replace(/[^a-zA-Z0-9._-]/g, '');
    if (!user) return resolve(false);
    const sh = [
      '#!/bin/sh', 'set -e',
      'f=/etc/sudoers.d/mado-pmset',
      "cat > \"$f\" <<'EOF'",
      `${user} ALL=(root) NOPASSWD: /usr/bin/pmset -a disablesleep 0, /usr/bin/pmset -a disablesleep 1`,
      'EOF',
      'chown root:wheel "$f"',
      'chmod 440 "$f"',
      '/usr/sbin/visudo -cf "$f" || { rm -f "$f"; exit 1; }',
      '',
    ].join('\n');
    let tmp;
    try { tmp = path.join(app.getPath('temp'), 'mado-sudoers-install.sh'); fs.writeFileSync(tmp, sh, { mode: 0o700 }); }
    catch { return resolve(false); }
    const apple = `do shell script "/bin/sh " & quoted form of "${tmp}" with administrator privileges`;
    console.log('[lid] running osascript admin prompt, tmp =', tmp);
    require('child_process').execFile('/usr/bin/osascript', ['-e', apple], (err, stdout, stderr) => {
      console.log('[lid] osascript done. err =', err && err.message, '| stderr =', stderr);
      try { fs.unlinkSync(tmp); } catch { /* */ }
      resolve(!err); // 用户取消 → err（-128）→ false
    });
  });
}

// 菜单勾选/取消的入口
async function setLidIntent(on) {
  console.log('[lid] setLidIntent called, on =', on);
  if (process.platform !== 'darwin') return;
  if (on) {
    const choice = dialog.showMessageBoxSync(win && !win.isDestroyed() ? win : undefined, {
      type: 'warning', buttons: [M('开启', 'Enable'), M('取消', 'Cancel')], defaultId: 0, cancelId: 1,
      message: M('合盖后继续运行', 'Keep running with lid closed'),
      detail: M('开启后，只要还有终端会话在跑，合上盖子也不会休眠——agent 任务能接着干。\n\n注意：合盖期间持续耗电发热，建议接电源。终端全部退出或退出 Mado 时自动恢复正常休眠。\n\n首次开启需输入一次管理员密码（装一条仅限电源设置的免密规则）。',
        'While any terminal session is running, closing the lid won\'t sleep the Mac — your agent tasks keep going.\n\nNote: it keeps drawing power and heat while closed; stay plugged in. Normal sleep is restored once all terminals exit or you quit Mado.\n\nFirst time needs your admin password once (installs a power-only passwordless rule).'),
    });
    console.log('[lid] warning dialog choice =', choice, '(0=开启)');
    if (choice !== 0) { buildMenu(); return; } // 取消 → 复位勾选
    // 探针：能否免密 sudo（设 0 无害）。不行就装规则。
    const probe = trySetDisableSleep(false);
    console.log('[lid] sudo probe ok =', probe, '→', probe ? '已有免密规则' : '需安装');
    if (!probe) {
      const installed = await installSudoers();
      console.log('[lid] installSudoers result =', installed);
      if (!installed) { buildMenu(); return; } // 装失败/取消 → 保持关闭
    }
  }
  lidGuard.setIntent(on, terminalCount);
}

// 原生菜单——关键是 Edit role，终端里的 ⌘C/⌘V 才生效
function buildMenu() {
  const isMac = process.platform === 'darwin';
  const { intent: lidIntent, active: lidActive } = lidGuard.state();
  const template = [
    ...(isMac ? [{ label: APP_NAME, submenu: [
      { role: 'about', label: M('关于 Mado', 'About Mado') },
      { label: M('检查更新…', 'Check for Updates…'), click: () => checkUpdate({ manual: true }) },
      { type: 'separator' },
      { role: 'hide', label: M('隐藏 Mado', 'Hide Mado') }, { role: 'hideOthers', label: M('隐藏其他', 'Hide Others') }, { role: 'unhide', label: M('全部显示', 'Show All') },
      { type: 'separator' },
      { role: 'quit', label: M('退出 Mado', 'Quit Mado') },
    ] }] : []),
    { label: M('文件', 'File'), submenu: [
      ...(isMac ? [] : [{ label: M('检查更新…', 'Check for Updates…'), click: () => checkUpdate({ manual: true }) }, { type: 'separator' }]),
      {
        label: M('新建终端', 'New Terminal'),
        accelerator: 'CmdOrCtrl+T',
        click: () => send('terminal:new'),
      },
      {
        label: M('新建 Codex 终端', 'New Codex Terminal'),
        accelerator: 'CmdOrCtrl+Shift+T',
        click: () => send('terminal:launch-codex'),
      },
      {
        label: M('新建 Codex 会话', 'Start New Codex Session'),
        accelerator: 'CmdOrCtrl+Shift+N',
        click: () => send('terminal:launch-codex-new'),
      },
      {
        label: M('重新运行当前命令', 'Rerun Active Command'),
        accelerator: 'CmdOrCtrl+Shift+R',
        click: () => send('terminal:restart-active'),
      },
      {
        label: M('关闭当前终端', 'Close Active Terminal'),
        accelerator: 'CmdOrCtrl+W',
        click: () => send('terminal:close-active'),
      },
      ...(!isMac ? [{ type: 'separator' }, { role: 'quit' }] : []),
    ] },
    { label: M('编辑', 'Edit'), submenu: [
      { role: 'undo', label: M('撤销', 'Undo') }, { role: 'redo', label: M('重做', 'Redo') }, { type: 'separator' },
      { role: 'cut', label: M('剪切', 'Cut') }, { role: 'copy', label: M('复制', 'Copy') }, { role: 'paste', label: M('粘贴', 'Paste') },
      { role: 'selectAll', label: M('全选', 'Select All') },
    ] },
    { label: M('视图', 'View'), submenu: [
      ...(!isMac ? [{ role: 'reload', label: M('重新加载', 'Reload') }] : []),
      { role: 'toggleDevTools', label: M('开发者工具', 'Developer Tools') },
      { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
      { type: 'separator' }, { role: 'togglefullscreen', label: M('全屏', 'Full Screen') },
      ...(isMac ? [{ type: 'separator' }, {
        // 合盖后继续运行：仅在有终端跑着时真正生效（智能模式）；勾选状态反映用户意图
        label: lidActive ? M('合盖后继续运行（生效中）', 'Keep running with lid closed (active)') : M('合盖后继续运行', 'Keep running with lid closed'),
        type: 'checkbox', checked: lidIntent,
        click: (item) => { setLidIntent(item.checked); },
      }] : []),
    ] },
    { role: 'window', label: M('窗口', 'Window'), submenu: [{ role: 'minimize', label: M('最小化', 'Minimize') }, { role: 'zoom' }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
// 渲染层持久化语言配置成功后重建原生菜单；不重载窗口，PTY 会话保持不变。
ipcMain.handle('locale:refresh-menu', () => {
  buildMenu();
  return { ok: true };
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
  else if (win && !win.isDestroyed()) { win.show(); win.focus(); } // 从 Dock 点回来：显示隐藏的窗口，状态原样还在
});
// ⌘Q 只保护确实存在前台任务的终端；空闲 Shell 不阻止退出。
const quitGuard = createQuitGuard({ app, dialog, ptyService, recoveryStore, getWindow: () => win, translate: M });
app.on('before-quit', (event) => quitGuard.handleBeforeQuit(event));
app.on('window-all-closed', () => {
  ptyService.killAll();
  watchService.closeAll();
  lidGuard.shutdown();
  if (process.platform !== 'darwin') app.quit();
});
// 退出兜底：无论怎么退（⌘Q、崩溃前的正常退出），都恢复系统休眠，绝不留禁休眠的烂摊子
app.on('will-quit', () => lidGuard.shutdown());

// ---------- 领域服务 IPC ----------
ipcMain.handle('pty:spawn', (event, payload) => ptyService.spawn(payload));
ipcMain.on('pty:input', (event, payload) => ptyService.input(payload));
ipcMain.on('pty:resize', (event, payload) => ptyService.resize(payload));
ipcMain.on('pty:kill', (event, payload) => ptyService.kill(payload));
ipcMain.handle('pty:cwd', (event, payload) => ptyService.cwd(payload));
ipcMain.handle('pty:has-foreground-process', (event, payload) => ptyService.hasForegroundProcess(payload));
ipcMain.handle('pty:restart-command', (event, payload) => ptyService.restartCommand(payload));
ipcMain.handle('terminal-recovery:list', () => recoveryStore.list());
ipcMain.handle('terminal-recovery:take', (event, payload) => recoveryStore.take(payload && payload.ids));
ipcMain.handle('terminal-recovery:clear', () => { recoveryStore.clear(); return { ok: true }; });
ipcMain.handle('clip:image', (event, payload) => systemFileService.copyImage(payload));
ipcMain.handle('clip:file', (event, payload) => systemFileService.copyFile(payload));
ipcMain.handle('drop:save', (event, payload) => systemFileService.save(payload));
ipcMain.handle('drop:save-into', (event, payload) => systemFileService.saveInto(payload));
ipcMain.handle('drop:copy-into', (event, payload) => systemFileService.copyInto(payload));
ipcMain.handle('fs:watch-set', (event, payload) => watchService.set(payload));
ipcMain.handle('fs:watch', (event, payload) => watchService.watch(payload));
