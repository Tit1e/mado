/**
 * [INPUT]: 依赖 Electron PTY/恢复桥、xterm 浏览器资源、Agent 启动/状态/快捷子控制器、共享 state/follow 与文件导航回调
 * [OUTPUT]: 对外提供 createTerminalController，管理多终端标签、隐藏服务会话、命令恢复、Codex/Pi 启动、拖放和布局
 * [POS]: public/modules 的终端领域控制器，被应用事件层和文件跟随模块消费
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
export function createTerminalController(deps) {
  const { $, state, follow, openWith, applyPreviewSize, animateLayout, updateWatches, escapeHtml, ic, baseOf, dirOf, navigate, renderBreadcrumb, playChime, toast, TERM_LINK_RE_BARE, api, apiPost, shQuote, applySelection, openPreview, recordRecent, agentResumeLast, setPreviewMax, isMdName, isHtmlName, popupMenu, rippleFileArea, resolveAgentLaunch, createTerminalAgentStatus, createTerminalShortcutActions } = deps;
// ---------- 内嵌终端（仅桌面 app；浏览器版优雅降级）----------
const term = {
  sessions: [], seq: 0, active: null, maximized: false,
  dock: localStorage.getItem('mado_term_dock') || 'right',
  available() { return !!(window.madoPty && window.Terminal && !window.__noXterm); },
  // 每套皮肤一整套手调 ANSI 主题——暗皮肤暗终端、亮皮肤亮终端，不再出现「暖纸里嵌黑块」
  themes: {
    terminal: {
      background: '#0b0c0a', foreground: '#d6dac9', cursor: '#cdf24b', cursorAccent: '#0b0c0a', selectionBackground: '#cdf24b40',
      black: '#1c1e17', red: '#e8825b', green: '#cdf24b', yellow: '#e8c95b', blue: '#7bc9e8', magenta: '#d68ad6', cyan: '#5bd6c0', white: '#d6dac9',
      brightBlack: '#62655a', brightRed: '#ff9b73', brightGreen: '#dcff66', brightYellow: '#ffe082', brightBlue: '#9ad8ff', brightMagenta: '#f0a8f0', brightCyan: '#7fffe0', brightWhite: '#f2f2ea',
    },
    warm: {
      background: '#ece2d2', foreground: '#4a3f30', cursor: '#cc785c', cursorAccent: '#ece2d2', selectionBackground: '#cc785c33',
      black: '#3a3025', red: '#b5502f', green: '#5f7a36', yellow: '#9a7b2e', blue: '#3a6a8a', magenta: '#9a5a7a', cyan: '#3a7a70', white: '#6b6355',
      brightBlack: '#8a7d68', brightRed: '#c75f38', brightGreen: '#6f8a40', brightYellow: '#b08a30', brightBlue: '#4a7a9a', brightMagenta: '#aa6a8a', brightCyan: '#4a8a82', brightWhite: '#3a3025',
    },
    editorial: {
      background: '#eae5d8', foreground: '#1a1a1a', cursor: '#ff433d', cursorAccent: '#eae5d8', selectionBackground: '#ff433d22',
      black: '#0a0a0a', red: '#cc1f1a', green: '#00803a', yellow: '#8a6d00', blue: '#0000cc', magenta: '#9a2a8a', cyan: '#007a8a', white: '#57534a',
      brightBlack: '#57534a', brightRed: '#e8302a', brightGreen: '#00a33e', brightYellow: '#a67c00', brightBlue: '#2222dd', brightMagenta: '#b03aa0', brightCyan: '#008a9a', brightWhite: '#0a0a0a',
    },
  },
  theme() { return this.themes[state.theme] || this.themes.terminal; },
  toggle() {
    if (!this.available()) { if (state.cwd) openWith(state.cwd, 'terminal'); return; } // 浏览器降级到系统终端
    const hidden = $('#terminal-panel').classList.contains('hidden');
    hidden ? this.open() : this.close();
  },
  open() {
    $('#terminal-panel').classList.remove('hidden');
    $('#terminal-resizer').classList.remove('hidden');
    this.applyDock();
    const interactive = this.tabSessions();
    if (!interactive.length) this.newTab();
    else if (!this.active || !interactive.some((session) => session.id === this.active)) this.activate(interactive[0].id);
    else this.fitActive();
    $('#btn-terminal').classList.add('active');
    localStorage.setItem('mado_term_open', '1');
    if (!localStorage.getItem('mado_term_draghint')) { localStorage.setItem('mado_term_draghint', '1'); setTimeout(() => toast('提示：把左侧文件 / 文件夹拖进终端，即插入路径喂给 Agent'), 700); }
  },
  close() {
    if (this.maximized) this.toggleMax(false); // 铺满状态下收起终端，term-max 不清会把文件区一起藏没
    $('#terminal-panel').classList.add('hidden');
    $('#terminal-resizer').classList.add('hidden');
    $('#main-body').classList.remove('fm-squeezed'); // 终端收起后文件区必须回来
    $('#btn-terminal').classList.remove('active');
    localStorage.setItem('mado_term_open', '0');
  },
  applyDock() {
    const mb = $('#main-body');
    mb.classList.toggle('dock-bottom', this.dock === 'bottom');
    mb.classList.toggle('dock-right', this.dock === 'right');
    // 全铺状态只在终端可见时恢复，否则文件区会凭空消失
    const termOpen = !$('#terminal-panel').classList.contains('hidden');
    mb.classList.toggle('fm-squeezed', termOpen && localStorage.getItem('mado_term_squeeze') === '1');
    const panel = $('#terminal-panel');
    // 首次开终端：文件区:终端 = 1:2，终端占主区 2/3（用户拖过 resizer 后用记下的 px）
    const mbr = mb.getBoundingClientRect();
    if (this.dock === 'bottom') {
      const h = Number(localStorage.getItem('mado_term_h')) || (mbr.height ? Math.round(mbr.height * 2 / 3) : 280);
      panel.style.height = h + 'px'; panel.style.width = '';
    } else {
      const w = Number(localStorage.getItem('mado_term_w')) || (mbr.width ? Math.round(mbr.width * 2 / 3) : 480);
      panel.style.width = w + 'px'; panel.style.height = '';
    }
    applyPreviewSize(); // 预览随 dock 翻转轴向
    this.fitActive();
  },
  setDock(d) {
    if (this.maximized) this.toggleMax(false); // 铺满下切布局看不出任何变化，先退出铺满让分屏可见
    animateLayout(); this.dock = d; localStorage.setItem('mado_term_dock', d); this.applyDock();
  },
  // 终端最大化：铺满整个中区（文件区让位），再点还原
  toggleMax(force) {
    animateLayout();
    this.maximized = force === undefined ? !this.maximized : force;
    $('#main-body').classList.toggle('term-max', this.maximized);
    const b = $('#term-max');
    if (b) { b.classList.toggle('on', this.maximized); b.title = this.maximized ? '还原终端' : '终端铺满'; }
    this.fitActive();
  },
  // 在指定目录开终端（新标签）；浏览器版降级到系统终端。返回新 session（spawn 完成后）
  openInDir(dir, options = {}) {
    if (!this.available()) { openWith(dir, 'terminal'); return null; }
    $('#terminal-panel').classList.remove('hidden');
    $('#terminal-resizer').classList.remove('hidden');
    this.applyDock();
    $('#btn-terminal').classList.add('active');
    localStorage.setItem('mado_term_open', '1'); // 右键/一键开终端也记住开合，和 open/close 对称
    return this.newTab(dir, options);
  },
  // 拖拽文件/文件夹进来：把 shell 转义后的路径插入活动终端（作为 agent 上下文）
  insertPath(p) {
    if (!this.available()) { openWith(dirOf(p), 'terminal'); return; }
    const wasHidden = $('#terminal-panel').classList.contains('hidden');
    if (wasHidden) this.open();
    const write = () => { if (this.active) this.input(this.active, shQuote(p) + ' '); const s = this.sessions.find((x) => x.id === this.active); if (s) s.xterm.focus(); };
    if (wasHidden) setTimeout(write, 280); else write();
  },
  // 第一方 Agent 一键启动：只接受固定 Agent/动作，始终在左侧当前目录新建标签。
  async launchAgent(agent, { action } = {}) {
    const resolvedAction = action || (agentResumeLast() ? 'continue' : 'new');
    const launch = resolveAgentLaunch(agent, resolvedAction);
    if (!launch) { toast('不支持的 Agent 启动方式', true); return false; }
    if (!this.available()) { openWith(state.cwd, 'terminal'); return false; }
    const session = await this.openInDir(state.cwd, { agent });
    if (!session || session.dead) { toast('终端启动失败', true); return false; }
    this.input(session.id, launch.command + '\r');
    session.xterm.focus();
    toast(launch.message);
    return true;
  },
  // 在指定目录新开标签跑命令（续会话/发版等）：不复用别处的空闲 shell，目录必须对
  async runInDir(dir, cmd, msg) {
    if (!this.available()) { openWith(dir, 'terminal'); return; }
    const sess = await this.openInDir(dir);
    if (sess && !sess.dead) { this.input(sess.id, cmd + '\r'); sess.xterm.focus(); toast(msg || '已在终端启动'); }
    else toast('终端启动失败', true);
  },
  // 恢复记录已经在主进程中一次性取出；逐条创建终端并执行，单条失败不阻断其余任务。
  async restoreCommands(entries) {
    if (!this.available() || !Array.isArray(entries) || !entries.length) return 0;
    const restoresTerminal = entries.some((entry) => entry.kind !== 'service');
    if (restoresTerminal) {
      $('#terminal-panel').classList.remove('hidden');
      $('#terminal-resizer').classList.remove('hidden');
      $('#btn-terminal').classList.add('active');
      localStorage.setItem('mado_term_open', '1');
      this.applyDock();
    }
    let restored = 0;
    for (const entry of entries) {
      if (entry.kind === 'service') {
        const result = await this.startProjectRun({
          id: entry.serviceKey || `legacy_${this.serviceRecoveryKey(entry)}`,
          cwd: entry.cwd,
          command: entry.command,
          recovered: !entry.serviceKey,
        });
        if (result.ok) restored++;
        continue;
      }
      const sess = await this.newTab(entry.cwd);
      if (!sess || sess.dead) continue;
      this.input(sess.id, entry.command + '\r');
      restored++;
    }
    if (restored) this.sessions.find((item) => item.id === this.active)?.xterm.focus();
    return restored;
  },
  // 把预览里选中的文字作为「上下文」喂给终端 agent：带文件出处 + 围栏，bracketed paste 防逐行误提交
  sendContext(text, srcPath) {
    if (!this.available()) { toast('内嵌终端不可用（网页版没有终端）', true); return; }
    const wasHidden = $('#terminal-panel').classList.contains('hidden');
    if (wasHidden) this.open();
    const rel = srcPath ? srcPath.replace(state.home, '~') : '';
    const head = rel ? `（来自 ${rel} 的片段）` : '（选中的片段）';
    const block = `${head}\n\`\`\`\n${text}\n\`\`\`\n`;
    const write = () => {
      if (!this.active) return;
      // \x1b[200~ … \x1b[201~ 是 bracketed paste：多行内容当作一次粘贴，不会被 shell/TUI agent 逐行执行
      this.input(this.active, '\x1b[200~' + block + '\x1b[201~');
      const s = this.sessions.find((x) => x.id === this.active); if (s) s.xterm.focus();
    };
    if (wasHidden) setTimeout(write, 300); else write();
  },
  // 用户输入统一入口：记 lastInput 供回显过滤（击键/粘贴/拖路径/跟随 cd 引发的重绘不算 agent 干活）
  input(id, d) {
    const s = this.sessions.find((x) => x.id === id);
    if (s) {
      s.lastInput = Date.now();
      // 回车多半提交了条命令（cd 这类被回显过滤、不走 busy 周期），稍后把标题对齐真实目录
      if (d.indexOf('\r') !== -1) { clearTimeout(s._cwdT); s._cwdT = setTimeout(() => this.refreshCwd(s, true), 800); }
    }
    window.madoPty.input(id, d);
  },
  // 点终端里的文件名/路径 → 结合 cwd + 回扫 scrollback + 搜索定位真实文件，在 Mado 里打开
  // tail：路径在该逻辑行里的后续文本，服务端用它做「空格扩展」stat 验证（带空格的文件名靠它补全）
  // rowHint：点击处逻辑行的末物理行号（buffer 绝对行），回扫 scrollback 的起点
  async openTermPath(id, raw, tail, rowHint) {
    let p = String(raw).replace(/^['"]+/, '').replace(/[)\]'"`,:;]+$/, '');
    let cwd = state.cwd;
    let candidate = p;
    const isRel = !p.startsWith('/') && !p.startsWith('~');
    if (isRel) {
      try { const r = await window.madoPty.cwd(id); if (r && r.ok && r.cwd) cwd = r.cwd; } catch { /* */ }
      candidate = (cwd || '').replace(/\/$/, '') + '/' + p.replace(/^\.\//, '');
    }
    const name = p.replace(/\/+$/, '').split('/').pop(); // 去掉目录结尾 / 再取 basename，否则名为空 basename 搜索失效
    // 回扫 scrollback：agent 生成文件时几乎总打印过全路径（裸文件名常常不在 cwd 下），比模糊搜索可信
    const alt = isRel ? this.scanScrollbackFor(id, name, rowHint) : '';
    // 活跃项目根（浏览目录 + 各终端项目目录）作 basename 搜索的额外根
    const roots = [];
    if (state.cwd) roots.push(state.cwd);
    this.sessions.forEach((x) => { const d = x.cwd || x.startDir; if (d && !roots.includes(d)) roots.push(d); });
    const q = encodeURIComponent;
    const r = await api(`/api/locate?path=${q(candidate)}&name=${q(name)}&root=${q(cwd || state.home)}&tail=${q(tail || '')}&alt=${q(alt)}&roots=${q(roots.join('\n'))}`);
    if (!r.found) { toast('没找到「' + name + '」', true); return; }
    if (r.isDir) { navigate(r.path); toast('已跳到该目录'); return; }
    await navigate(dirOf(r.path));
    const e = state.entries.find((x) => x.path === r.path) || { path: r.path, name: baseOf(r.path), kind: 'text', isDir: false };
    applySelection(r.path); openPreview(e); recordRecent(r.path);
    // md/html 是「写给人看」的：点开即全屏，最贴合「我想看看这文件长啥样」的意图（代码等退回常规分栏）
    setPreviewMax(isMdName(r.path) || isHtmlName(r.path));
    toast(r.viaSearch ? '未精确命中，已打开最接近的「' + baseOf(r.path) + '」' : (r.viaScrollback ? '已按会话里出现过的路径打开' : '已打开'));
  },
  // 从 fromRow 往上回扫 scrollback（最多 2000 物理行），收集含该 basename 的绝对路径（/ 或 ~ 开头，
  // 最近出现在前，≤3 个），交给 /api/locate 逐个 stat 验证。折行沿 isWrapped 拼回逻辑行；
  // 含 … 的截断路径、URL（// 开头或紧跟冒号）跳过，继续往上找干净的
  scanScrollbackFor(id, name, fromRow) {
    const s = this.sessions.find((x) => x.id === id);
    if (!s || !name) return '';
    const buf = s.xterm.buffer.active;
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('(?:~|/)(?:[^\\s\'"`()]*/)?' + esc + '(?=$|[\\s\'"`)\\],:;。，）】、？！；：])', 'gu');
    const hits = [];
    let row = Math.min(fromRow == null ? buf.length - 1 : fromRow, buf.length - 1);
    let budget = 2000;
    while (row >= 0 && budget > 0 && hits.length < 3) {
      let start = row;
      while (start > 0 && buf.getLine(start) && buf.getLine(start).isWrapped) start--;
      budget -= row - start + 1;
      let text = '';
      for (let i = start; i <= row; i++) {
        const ln = buf.getLine(i);
        if (ln) text += ln.translateToString(i === row); // 折行中段保持整行宽（不 trim），仅末行 trim
      }
      if (text.includes(name)) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(text)) !== null) { // 行内多候选：跳过被护栏否决的，继续找同行更干净的
          const cand = m[0];
          if (cand && !cand.includes('…') && !cand.includes('...') && !cand.startsWith('//') && text[m.index - 1] !== ':' && !hits.includes(cand)) { hits.push(cand); break; }
        }
      }
      row = start - 1;
    }
    return hits.join('\n');
  },
  // 定位文件区到活动终端的真实目录
  async locateCwd() {
    if (!this.active) return;
    const r = await window.madoPty.cwd(this.active);
    if (r && r.ok && r.cwd) navigate(r.cwd);
    else toast('取终端目录失败', true);
  },
  // 项目身份色：路径稳定哈希到色相——同一项目的标签色点永远一个色，扫一眼即配对
  hueOf(p) { let h = 0; for (let i = 0; i < (p || '').length; i++) h = (h * 31 + p.charCodeAt(i)) >>> 0; return h % 360; },
  // 标签标题跟着终端「现在」的目录走（lsof 查真实 cwd），不再停留在创建时的快照；
  // 多标签跑不同项目的 agent 时，标题才认得出谁是谁
  async refreshCwd(s, force) {
    if (!s || s.dead) return;
    const now = Date.now();
    // 轻节流：避免每 3-5 秒打一条日志的后台会话（dev server）在 busy→idle 间无限循环里反复 spawn lsof。
    // cd / 用户主动场景传 force 跳过节流，标题立刻对齐
    if (!force && now - (s._cwdAt || 0) < 4000) return;
    s._cwdAt = now;
    try {
      const r = await window.madoPty.cwd(s.id);
      if (r && r.ok && r.cwd && r.cwd !== s.cwd) {
        s.cwd = r.cwd; s.title = baseOf(r.cwd) || s.title;
        this.renderTabs(); renderBreadcrumb(); // 面包屑的项目配对色点也跟着换
      }
    } catch { /* 取不到就保持原标题 */ }
  },
  async newTab(cwdOverride, options = {}) {
    const startDir = cwdOverride || state.cwd;
    const kind = options.kind === 'service' ? 'service' : 'terminal';
    const id = 't' + (++this.seq);
    const host = document.createElement('div');
    host.className = 'xterm-instance' + (kind === 'service' ? ' service-host' : '');
    $('#xterm-host').appendChild(host);
    if (kind !== 'service') host.classList.add('show'); // 普通标签先可见再 open/fit：display:none 下 fit 量不出尺寸，PTY 会以 80 列出生
    const FitCtor = window.FitAddon ? (window.FitAddon.FitAddon || window.FitAddon) : null;
    const xterm = new window.Terminal({
      fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--font-term').trim() || 'monospace',
      fontSize: 13, lineHeight: 1.2, cursorBlink: true, theme: this.theme(), scrollback: 5000,
      allowProposedApi: true, // unicode11 宽度 API 需要
      // claude/codex 等 TUI 会开启鼠标上报，鼠标拖拽被程序吃掉 → 默认无法选中文字。
      // 开这个开关后按住 Option 拖拽即可强制选中复制（iTerm/VS Code 终端同款约定）
      macOptionClickForcesSelection: true,
      // agent 常输出按深色终端设计的 256 色/真彩（如淡蓝路径），在浅色皮肤上几乎隐形；
      // 自动把对比度不足的前景色压暗/提亮到 4.5:1（WCAG AA，VS Code 终端同款默认值）
      minimumContrastRatio: 4.5,
    });
    const fit = FitCtor ? new FitCtor() : null;
    if (fit) xterm.loadAddon(fit);
    // 剪贴板支持：右键菜单 + 复制粘贴
    if (!window.__noClipboard && window.ClipboardAddon) {
      try { const C = window.ClipboardAddon.ClipboardAddon || window.ClipboardAddon; xterm.loadAddon(new C()); } catch { /* */ }
    }
    // CJK 宽字符正确宽度：没有它，中文目录名会让 zsh 提示符重绘错列（乱码）
    if (!window.__noUnicode11 && window.Unicode11Addon) {
      try { const U = window.Unicode11Addon.Unicode11Addon || window.Unicode11Addon; xterm.loadAddon(new U()); xterm.unicode.activeVersion = '11'; } catch { /* */ }
    }
    xterm.open(host);
    // WebGL 渲染加速（大输出/TUI 不掉帧），失败或上下文丢失回退 DOM
    // 诊断开关：控制台跑 madoWebgl(false) 关掉 WebGL（用 DOM renderer）排查 CJK 残影乱码，madoWebgl(true) 恢复，需新开标签生效
    const webglOff = (() => { try { return localStorage.getItem('mado.noWebgl') === '1'; } catch { return false; } })();
    let wg = null; // 存到 session 上，换肤/字号/resize 时清图集修 CJK 残影乱码（#37/#45）
    if (!webglOff && !window.__noWebgl && window.WebglAddon) {
      try {
        const Wg = window.WebglAddon.WebglAddon || window.WebglAddon;
        wg = new Wg();
        wg.onContextLoss(() => { try { wg.dispose(); } catch { /* */ } });
        xterm.loadAddon(wg);
        this.watchAtlas(wg);
      } catch { wg = null; /* 回退默认 DOM renderer */ }
    }
    if (fit && kind !== 'service') try { fit.fit(); } catch { /* */ }
    const sess = {
      id, xterm, fit, host, webgl: wg, dead: false, status: 'idle', unread: false, startDir,
      title: options.title || baseOf(startDir || '') || 'shell', kind, agent: options.agent || '',
      projectRoot: kind === 'service' ? (options.projectRoot || startDir) : null,
      projectCommand: kind === 'service' ? (options.projectCommand || '') : '',
      projectRuleId: kind === 'service' ? (options.projectRuleId || '') : '',
      recoveredService: kind === 'service' && options.recoveredService === true,
      revealed: false,
    };
    this.sessions.push(sess);
    if (kind !== 'service') this.activate(id);
    else this.renderTabs();
    updateWatches(); // 新终端的项目目录也纳入监听
    const r = await window.madoPty.spawn({
      id, cwd: startDir, cols: kind === 'service' ? 120 : xterm.cols, rows: kind === 'service' ? 24 : xterm.rows,
      kind, serviceKey: kind === 'service' ? sess.projectRuleId : undefined,
    });
    if (!r.ok) { sess.dead = true; xterm.write('\r\n  \x1b[31m终端启动失败：' + (r.error || '') + '\x1b[0m\r\n'); }
    else sess.cwd = r.cwd || startDir; // 末尾 renderTabs 统一带上 cwd 重画
    xterm.onData((d) => {
      if (sess.dead) { if (d === '\r' || d === '\n') this.respawn(sess); return; } // 进程退出后回车真重开
      this.input(id, d);
    });
    xterm.onResize(({ cols, rows }) => { sess.lastInput = Date.now(); window.madoPty.resize(id, cols, rows); }); // resize 引发的 TUI 重绘不算 agent 干活
    if (kind !== 'service') window.madoPty.resize(id, xterm.cols, xterm.rows); // spawn 等待期间 fit 过的 resize 事件无人监听会丢：补发一次对齐 PTY
    // 自定义键盘处理：macOS 用 ⌘，其它平台用 Ctrl；纯 Ctrl 按键在 macOS 交给终端程序
    xterm.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true;
      const primaryShortcut = window.madoEnv?.platform === 'darwin' ? e.metaKey : e.ctrlKey;
      if (primaryShortcut && (e.key === 'c' || e.key === 'C')) {
        if (xterm.hasSelection()) {
          // 有选中 → 复制到剪贴板，不发给 PTY
          try {
            const sel = xterm.getSelection();
            navigator.clipboard.writeText(sel);
            xterm.clearSelection();
          } catch { /* 剪贴板不可用时走菜单兜底 */ }
          e.preventDefault();
          return false;
        }
        // 无选中 → 交给 xterm / 原生菜单按平台处理；macOS 的 Ctrl+C 会在上面直接透传
        return true;
      }
      if (primaryShortcut && (e.key === 'v' || e.key === 'V')) {
        // macOS 的 ⌘V / 其它平台的 Ctrl+V 粘贴文本
        e.preventDefault();
        navigator.clipboard.readText().then(text => {
          if (text) xterm.paste(text);
        }).catch(() => { /* 无权限时走Electron菜单兜底 */ });
        return false;
      }
      if (primaryShortcut && (e.key === '=' || e.key === '+' || e.key === '0')) {
        e.preventDefault();
        const delta = e.key === '0' ? 0 : (e.key === '=' || e.key === '+' ? 1 : -1);
        term.adjustFont(sess, delta);
        return false;
      }
      if (primaryShortcut && e.key === '-') {
        e.preventDefault();
        term.adjustFont(sess, -1);
        return false;
      }
      return true;
    });
    // 右键菜单：复制/粘贴
    host.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const hasSel = xterm.hasSelection();
      const items = [];
      if (hasSel) items.push({ label: '复制', fn: () => {
        try { navigator.clipboard.writeText(xterm.getSelection()); xterm.clearSelection(); } catch {}
      }});
      items.push({ label: '粘贴', fn: async () => {
        try { const text = await navigator.clipboard.readText(); if (text) xterm.paste(text); } catch {}
      }});
      popupMenu(e, items);
    });
    // 选中即复制（iTerm2 默认行为）
    xterm.onSelectionChange(() => {
      if (xterm.hasSelection()) {
        try { navigator.clipboard.writeText(xterm.getSelection()); } catch { /* 静默失败，用户仍可右键/菜单复制 */ }
      }
    });
    // 终端路径链接按引号串、斜杠路径、裸文件名分层匹配，逐 cell 处理长路径折行与 CJK 坐标。
    if (xterm.registerLinkProvider) {
      xterm.registerLinkProvider({
        provideLinks: (lineNo, cb) => {
          const buf = xterm.buffer.active;
          if (!buf.getLine(lineNo - 1)) { cb(undefined); return; }
          let startRow = lineNo - 1;
          while (startRow > 0 && buf.getLine(startRow).isWrapped) startRow--;
          let endRow = startRow;
          while (buf.getLine(endRow + 1) && buf.getLine(endRow + 1).isWrapped) endRow++;
          let text = '';
          const pos = []; // pos[i] = 第 i 个字符的终端坐标 {x, y, w}
          for (let row = startRow; row <= endRow; row++) {
            const ln = buf.getLine(row);
            if (!ln) break;
            for (let col = 0; col < ln.length; col++) {
              const cell = ln.getCell(col);
              if (!cell || cell.getWidth() === 0) continue; // 宽字符的占位列
              const ch = cell.getChars() || ' ';
              for (const c of ch) { text += c; pos.push({ x: col + 1, y: row + 1, w: cell.getWidth() }); }
            }
          }
          const t = text.replace(/\s+$/, '');
          const links = []; const found = [];
          const overlaps = (s, e) => found.some((f) => s < f.e && e > f.s);
          const push = (s, e, cand, tail, act) => {
            if (e - s < 3 || overlaps(s, e)) return;
            const a = pos[s], b = pos[e - 1];
            if (!a || !b) return;
            found.push({ s, e, cand, tail });
            links.push({
              range: { start: { x: a.x, y: a.y }, end: { x: b.x + b.w - 1, y: b.y } },
              text: cand,
              decorations: { pointerCursor: true, underline: true },
              activate: act || (() => this.openTermPath(id, cand, tail, endRow)),
            });
          };
          let m;
          // 0. URL：直接系统浏览器打开（Electron 的 windowOpenHandler 会转 shell.openExternal）
          // 全角标点不可能裸出现在合法 URL 里（必须百分号编码），排除掉防止「url、后续散文」粘连
          const reU = /\bhttps?:\/\/[^\s'"`<>）（【】「」，。、？！：；]+/g;
          while ((m = reU.exec(t)) !== null) {
            const url = m[0].replace(/[)\],.:;。，？！?!）】>]+$/, '');
            push(m.index, m.index + url.length, url, '', () => window.open(url));
          }
          // 1. 引号串：拖拽插入/agent 输出常用 '…' 包路径，内容像路径或文件名就整体认
          const reQ = /'([^']{3,})'|"([^"]{3,})"/g;
          while ((m = reQ.exec(t)) !== null) {
            const inner = m[1] || m[2];
            if (!inner.includes('/') && !/\.[A-Za-z0-9]{1,8}$/.test(inner)) continue;
            push(m.index + 1, m.index + 1 + inner.length, inner, '');
          }
          // 2. 含斜杠的 token：宽进严出——整个 token 都收（.claude/x、写作/01-xx、/abs、~/x 全覆盖），
          // 配不配下划线交给服务端 stat 验证（散文里的「分发/产品演示——……」会被验证刷掉）。
          // 全角胶水标点（：、，。等）必须进切断集：它们出现在路径「前面」时（看看效果：/tmp/x.png、
          // 顿号列举的第二项），后置 split 救不回来——要么整段散文粘进候选 stat 必败，要么首段为空整条丢弃
          const reP = /[^\s'"`:()（）「」【】<>：；，。、？！]*\/[^\s'"`:()（）「」【】<>：；，。、？！]*/g;
          const r2 = [];
          const truncated = [];
          while ((m = reP.exec(t)) !== null) {
            // 全角标点几乎不出现在路径里，却常把路径和后续散文粘成一个 token：切到第一个为止。
            // … 不进切断集：它是 agent 截断长路径的省略号（…tems/x/截屏.png 开头截断最常见），
            // 一刀切会把整条截断路径切成空串丢掉。… 后面还有 / 说明在路径头/中段，保留；
            // 后面没有 / 的才是粘连散文或尾部截断（basename 已残，搜也搜不到），从右往左切掉
            let raw = m[0].split(/[，。、？！—]+/)[0];
            let gi;
            while ((gi = raw.lastIndexOf('…')) !== -1 && !raw.slice(gi + 1).includes('/')) raw = raw.slice(0, gi);
            raw = raw.replace(/[)\],.:;]+$/, '');
            if (raw.length < 3 || !raw.includes('/') || /^https?:\/\//.test(raw)) continue;
            if (overlaps(m.index, m.index + raw.length)) continue;
            const tail = t.slice(m.index + raw.length).split(/['"`]/)[0].slice(0, 160);
            // 截断路径（.../…）：完整字符串通不过 stat 验证，但 basename 搜索通常能定位，
            // 所以不等待验证，直接给下划线；点开后 openTermPath 会走 basename 搜索兜底。
            const isTruncated = raw.includes('…') || /(^|\/)\.{3,}/.test(raw);
            if (isTruncated) truncated.push({ s: m.index, e: m.index + raw.length, cand: raw, tail });
            else r2.push({ s: m.index, e: m.index + raw.length, cand: raw, tail });
          }
          // 截断路径直接创建链接，避免验证失败导致无法点击
          truncated.forEach((x) => push(x.s, x.e, x.cand, x.tail));
          // 目录候选（结尾 /）：和带扩展名的裸文件名享受同等兜底——验证通过则用精确路径，
          // 验证失败（终端 cwd 与打印的相对路径基准不一致时常见）也保留链接，点开走 basename 搜索。
          // 文件靠扩展名白名单兜底，目录没扩展名，全靠结尾 / 这个强信号（散文几乎不这么写）。
          const dirCands = r2.filter((x) => x.cand.endsWith('/'));
          const finish = () => {
            // 3. 裸文件名：unicode 字符类（调研.md 能点）+ 扩展名白名单（e.g/node.js 不误报）。
            // 紧跟斜杠路径、只隔空格的裸名多半是同一带空格路径的后半段：点哪段都按完整串定位
            //（真分离的如 ls /tmp foo.md，完整串 stat 不中会回落到 basename 搜索，不会开错）
            TERM_LINK_RE_BARE.lastIndex = 0;
            let mm;
            while ((mm = TERM_LINK_RE_BARE.exec(t)) !== null) {
              const end = mm.index + mm[0].length;
              const prev = found.find((f) => f.tail && f.e <= mm.index && /^\s+$/.test(t.slice(f.e, mm.index)));
              if (prev) push(mm.index, end, t.slice(prev.s, end), t.slice(end).split(/['"`]/)[0].slice(0, 160));
              else push(mm.index, end, mm[0], '');
            }
            // 验证未命中的目录候选再兜一刀（已被 apply 精确链接的会被 overlaps 跳过）
            dirCands.forEach((x) => push(x.s, x.e, x.cand, x.tail));
            cb(links.length ? links : undefined);
          };
          if (!r2.length) { finish(); return; }
          const sess0 = this.sessions.find((x) => x.id === id);
          const cwd0 = (sess0 && (sess0.cwd || sess0.startDir)) || state.cwd || '';
          // 验证结果按 (cwd, cand, tail) 缓存：provideLinks 在鼠标移动时反复触发，别反复打接口
          this._vCache = this._vCache || new Map();
          const need = r2.filter((x) => !this._vCache.has(cwd0 + ' ' + x.cand + ' ' + x.tail));
          const apply = () => {
            r2.forEach((x) => { if (this._vCache.get(cwd0 + ' ' + x.cand + ' ' + x.tail)) push(x.s, x.e, x.cand, x.tail); });
            finish();
          };
          if (!need.length) { apply(); return; }
          apiPost('/api/term-verify', { cwd: cwd0, items: need.map((x) => ({ cand: x.cand, tail: x.tail })) }).then((res) => {
            need.forEach((x, i) => this._vCache.set(cwd0 + ' ' + x.cand + ' ' + x.tail, !!(res.results && res.results[i])));
            if (this._vCache.size > 600) { for (const k of this._vCache.keys()) { this._vCache.delete(k); if (this._vCache.size <= 400) break; } }
            apply();
          }).catch(() => finish()); // 验证不可用：宁可不划线，不要误标
        },
      });
    }
    this.renderTabs();
    return sess;
  },
  tabSessions() { return this.sessions.filter((session) => session.kind !== 'service' || session.revealed); },
  serviceRecoveryKey({ cwd, command }) {
    let hash = 5381;
    for (const char of `${cwd}\n${command}`) hash = ((hash * 33) ^ char.charCodeAt(0)) >>> 0;
    return hash.toString(36).padStart(8, '0');
  },
  serviceSession(rule) {
    return this.sessions.find((session) => session.kind === 'service'
      && (session.projectRuleId === rule.id
        || (session.recoveredService && session.projectRoot === rule.cwd && session.projectCommand === rule.command)));
  },
  async startProjectRun(rule) {
    if (!this.available()) return { ok: false, error: '内嵌终端不可用（网页版没有运行服务）' };
    if (!rule?.id || !rule.cwd || !rule.command) return { ok: false, error: '运行命令配置无效' };
    let session = this.serviceSession(rule);
    if (session && !session.dead) {
      session.projectCommand = rule.command;
      const foreground = await window.madoPty.hasForegroundProcess(session.id);
      if (foreground?.ok && foreground.running) return { ok: true, id: session.id, running: true, reused: true };
    } else {
      session = await this.newTab(rule.cwd, {
        kind: 'service', projectRoot: rule.cwd, projectCommand: rule.command, projectRuleId: rule.id,
        recoveredService: rule.recovered === true, title: baseOf(rule.cwd) || 'service',
      });
    }
    if (!session || session.dead) return { ok: false, error: '运行服务启动失败' };
    this.input(session.id, rule.command + '\r');
    return { ok: true, id: session.id, running: true };
  },
  async projectRunState(rule) {
    const session = this.serviceSession(rule);
    if (!session || session.dead) return { root: rule.cwd, ruleId: rule.id, running: false };
    try {
      const foreground = await window.madoPty.hasForegroundProcess(session.id);
      return { root: rule.cwd, ruleId: rule.id, id: session.id, command: session.projectCommand, running: foreground?.ok === true && foreground.running === true };
    } catch { return { root: rule.cwd, ruleId: rule.id, id: session.id, command: session.projectCommand, running: false }; }
  },
  async projectRunStates() {
    return Promise.all(this.sessions
      .filter((session) => session.kind === 'service')
      .map((session) => this.projectRunState({ id: session.projectRuleId, cwd: session.projectRoot, command: session.projectCommand })));
  },
  async restartProjectRun(rule) {
    const session = this.serviceSession(rule);
    if (!session || session.dead) return { ok: false, error: '运行服务不存在' };
    return window.madoPty.restartCommand(session.id);
  },
  async stopProjectRun(rule) {
    const session = this.serviceSession(rule);
    if (!session || session.dead) return { ok: false, error: '运行服务不存在' };
    const foreground = await window.madoPty.hasForegroundProcess(session.id);
    if (!foreground?.ok || !foreground.running) return { ok: false, error: '当前没有正在运行的命令' };
    this.input(session.id, '\x03');
    return { ok: true };
  },
  revealProjectRun(rule) {
    const session = this.serviceSession(rule);
    if (!session || session.dead) return false;
    session.revealed = true;
    $('#terminal-panel').classList.remove('hidden');
    $('#terminal-resizer').classList.remove('hidden');
    this.applyDock();
    $('#btn-terminal').classList.add('active');
    localStorage.setItem('mado_term_open', '1');
    this.activate(session.id);
    return true;
  },
  hideProjectRun(id) {
    const session = this.sessions.find((item) => item.id === id && item.kind === 'service');
    if (!session) return false;
    session.revealed = false;
    const next = this.tabSessions().find((item) => item.id !== id);
    if (next) this.activate(next.id);
    else this.close();
    this.renderTabs();
    return true;
  },
  newTerminal() {
    if (!this.available()) { if (state.cwd) openWith(state.cwd, 'terminal'); return null; }
    const hidden = $('#terminal-panel').classList.contains('hidden');
    const hadSessions = this.tabSessions().length > 0;
    if (hidden) this.open();
    // open() 会在首次展开且没有会话时自动创建一个，避免首次 Cmd+T 连开两个标签。
    if (hidden && !hadSessions) return null;
    return this.newTab();
  },
  async respawn(sess) {
    sess.dead = false;
    sess.xterm.reset(); // 清掉死亡残留，新 shell 提示符不和旧画面叠在一起
    const r = await window.madoPty.spawn({
      id: sess.id, cwd: sess.startDir || state.cwd, cols: sess.xterm.cols, rows: sess.xterm.rows,
      kind: sess.kind, serviceKey: sess.kind === 'service' ? sess.projectRuleId : undefined,
    });
    if (!r.ok) { sess.dead = true; sess.xterm.write('\x1b[31m重开失败：' + (r.error || '') + '\x1b[0m\r\n'); }
    else sess.cwd = r.cwd || sess.startDir;
  },
  // 对齐 Chrome：1-8 按顺序选标签，9 永远选最后一个；不存在时不创建会话
  activateByShortcut(number) {
    const tabs = this.tabSessions();
    const index = number === 9 ? tabs.length - 1 : number - 1;
    const target = index >= 0 ? tabs[index] : null;
    if (!target) {
      toast(number === 9 ? '没有可切换的终端标签' : `没有第 ${number} 个终端标签`);
      return;
    }
    if ($('#terminal-panel').classList.contains('hidden')) this.open();
    this.activate(target.id);
  },
  activate(id) {
    const target = this.sessions.find((session) => session.id === id);
    if (!target || (target.kind === 'service' && !target.revealed)) return;
    this.active = id;
    this.sessions.forEach((s) => s.host.classList.toggle('show', s.id === id));
    const cur = this.sessions.find((x) => x.id === id);
    if (cur) cur.unread = false; // 切到该标签即清未读
    this.renderTabs();
    requestAnimationFrame(() => {
      const activeTab = $('#term-tabs .term-tab.active');
      if (activeTab) activeTab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
    const s = this.sessions.find((x) => x.id === id);
    if (s) {
      this.fitActive();
      setTimeout(() => s.xterm.focus(), 0);
      // 延迟刷新标题（避开双击窗口：双击的第二下若撞上 renderTabs 重建会丢 dblclick 事件）
      setTimeout(() => this.refreshCwd(s), 600);
    }
  },
  closeTab(id) {
    const i = this.sessions.findIndex((x) => x.id === id);
    if (i < 0) return;
    const s = this.sessions[i];
    if (s.kind === 'service') { this.hideProjectRun(id); return; }
    const visibleIndex = this.tabSessions().findIndex((session) => session.id === id);
    try { window.madoPty.kill(id); } catch { /* */ }
    try { s.xterm.dispose(); } catch { /* */ }
    s.host.remove();
    this.sessions.splice(i, 1);
    updateWatches(); // 该终端的项目目录不再需要监听
    const tabs = this.tabSessions();
    if (!tabs.length) {
      this.active = null;
      this.renderTabs();
      this.close();
      return;
    }
    if (this.active === id) {
      const nextIndex = Math.max(0, Math.min(visibleIndex - 1, tabs.length - 1));
      this.activate(tabs[nextIndex].id);
    }
    else this.renderTabs();
  },
  fitActive() {
    const s = this.sessions.find((x) => x.id === this.active);
    if (!s || !s.fit) return;
    requestAnimationFrame(() => { try { s.fit.fit(); } catch { /* */ } });
  },
  // WebGL 字形图集保养：大量中文输出会撑满图集触发分页合并，上游 bug 让汉字画成别字碎片
  //（拖拽窗口能复原＝resize 重建了图集）。忙时每 5 分钟、收工时距上次 >60s 主动重建，重画一帧无感。
  // 图集按字体配置在标签间共享，单独清一个标签会让其他标签的字指向已清空的纹理（大面积丢字），
  // 所以全局节流、到点后所有标签同一 tick 一起清：头一个清掉共享纹理，其余只重建自己的模型并重绘
  atlasCare(now, eager) {
    if (!this._atlasAt) { this._atlasAt = now; return; } // 刚启动图集是干净的，先记时间
    if (now - this._atlasAt < (eager ? 60000 : 300000)) return;
    this._atlasAt = now;
    this.sessions.forEach((s) => { try { s.webgl?.clearTextureAtlas(); } catch { /* */ } });
  },
  // 图集压力监视（分页合并的机制级防线）：addon 每开一页新图集就发事件（同一页会被共享它的每个
  // 标签各转发一次，WeakSet 去重后计数≈真实页数）。页数到 12（上限一般 16，顶格才触发出乱码的
  // 分页合并）就整体重建，让合并从机制上没机会发生。定时的 atlasCare 只回收页内空间、减缓页数增长，
  // 但 clearTextureAtlas 页数只增不减（合并出的大页清空后还永久占坑不可写），压不住时得靠这里真重建
  watchAtlas(wg) {
    if (!wg || !wg.onAddTextureAtlasCanvas) return;
    if (!this._atlasSeen) this._atlasSeen = new WeakSet();
    wg.onAddTextureAtlasCanvas((canvas) => {
      if (this._atlasSeen.has(canvas)) return;
      this._atlasSeen.add(canvas);
      this._atlasPages = (this._atlasPages || 0) + 1;
      if (this._atlasPages < 12 || this._atlasRecycling) return;
      this._atlasRecycling = true;
      requestAnimationFrame(() => this.recycleWebgl()); // 事件在绘制途中同步发出，等这帧画完再动手
    });
  },
  // 真重建：所有标签的 WebGL 插件先全部销毁、再全部重装。图集按引用计数存活，
  // 边销毁边重装会让新插件捡回那张退化的旧图集，必须两趟分开走
  recycleWebgl() {
    this._atlasRecycling = false;
    this._atlasPages = 0;
    this._atlasSeen = new WeakSet();
    this._atlasAt = Date.now();
    const Wg = (!window.__noWebgl && window.WebglAddon) ? (window.WebglAddon.WebglAddon || window.WebglAddon) : null;
    const wants = this.sessions.filter((s) => s.webgl);
    wants.forEach((s) => { try { s.webgl.dispose(); } catch { /* */ } s.webgl = null; });
    if (!Wg) return; // 环境没了 WebGL 就顺势落回 DOM renderer
    wants.forEach((s) => {
      try {
        const wg = new Wg();
        wg.onContextLoss(() => { try { wg.dispose(); } catch { /* */ } if (s.webgl === wg) s.webgl = null; });
        s.xterm.loadAddon(wg);
        s.webgl = wg;
        this.watchAtlas(wg);
      } catch { /* 单个失败回退 DOM，不拦其他 */ }
    });
  },
  // 兼容渲染模式：关 WebGL 改用 DOM renderer（无字形图集，从机制上杜绝中文乱码；大输出略慢）。
  // 对所有已开标签立即生效；选择存 localStorage，新标签在创建处同样遵守
  setWebgl(on) {
    try { if (on) localStorage.removeItem('mado.noWebgl'); else localStorage.setItem('mado.noWebgl', '1'); } catch { /* */ }
    this.tabSessions().forEach((s) => {
      try {
        if (!on && s.webgl) { s.webgl.dispose(); s.webgl = null; }
        else if (on && !s.webgl && !window.__noWebgl && window.WebglAddon) {
          const Wg = window.WebglAddon.WebglAddon || window.WebglAddon;
          const wg = new Wg();
          wg.onContextLoss(() => { try { wg.dispose(); } catch { /* */ } if (s.webgl === wg) s.webgl = null; });
          s.xterm.loadAddon(wg);
          s.webgl = wg;
          this.watchAtlas(wg);
        }
      } catch { /* 单个会话失败不拦其他 */ }
    });
  },
  // 字体缩放：⌘+/⌘- 调整字号，⌘0 重置为默认 13px
  adjustFont(sess, delta) {
    if (!sess._fontSize) sess._fontSize = 13;
    if (delta === 0) sess._fontSize = 13;
    else sess._fontSize = Math.max(10, Math.min(24, sess._fontSize + delta));
    const xterm = sess.xterm;
    // xterm 没有直接改 fontSize 的 API，通过 options 更新
    xterm.options.fontSize = sess._fontSize;
    // 字号变了要重新 fit，避免内容裁切。顺带清图集防 CJK 残影——图集在同字号标签间共享，
    // 只清自己会让其他标签的字悬空指向已清空的纹理（2.6.1 的教训），必须所有标签同一 tick 一起清
    requestAnimationFrame(() => {
      try { sess.fit.fit(); } catch { /* */ }
      this.sessions.forEach((s) => { try { s.webgl?.clearTextureAtlas?.(); } catch { /* */ } });
    });
    // 通知 PTY 重新获取尺寸（fit 会触发 onResize，已经做了）
  },
  renderTabs() {
    const bar = $('#term-tabs');
    bar.innerHTML = '';
    this.tabSessions().forEach((s) => {
      const t = document.createElement('div');
      const dotState = s.dead ? 'dead' : (s.status === 'busy' ? 'busy' : 'idle');
      const followed = follow.on && follow.sid === s.id; // 文件跟随正盯着这个 tab
      t.className = 'term-tab' + (s.id === this.active ? ' active' : '') + (s.unread ? ' unread' : '') + (followed ? ' following' : '');
      const runningTitle = s.agent === 'pi' ? 'Pi 运行中' : (s.agent === 'codex' ? 'Codex 运行中' : '终端有输出');
      const dotTitle = s.dead ? '进程已退出' : (s.status === 'busy' ? (s.kind === 'service' ? '服务有输出' : runningTitle) : '空闲');
      // 终端图标按项目路径染色：同项目同色，和面包屑的配对色点呼应
      const hue = this.hueOf(s.cwd || s.startDir);
      t.title = s.kind === 'service' ? '服务输出，关闭只收起视图' : (followed ? '文件跟随正盯着这个终端 · 双击跳到它所在目录' : '双击：文件区跳到该终端所在目录');
      const eye = followed ? `<span class="tab-eye" title="文件跟随盯着它">${ic('eye', 'currentColor', 11)}</span>` : '';
      t.innerHTML = `<span class="tab-dot ${dotState}" title="${dotTitle}"></span>${eye}${ic('term', `hsl(${hue} 62% 48%)`, 12)}<span>${escapeHtml(s.title)}</span><span class="tab-x" title="${s.kind === 'service' ? '收起输出' : '关闭'}">✕</span>`;
      t.onclick = (e) => { if (e.target.classList.contains('tab-x')) { this.closeTab(s.id); return; } this.activate(s.id); };
      t.ondblclick = (e) => { if (e.target.classList.contains('tab-x')) return; this.locateCwd(); };
      bar.appendChild(t);
    });
  },
  // 换主题后 WebGL 图集里缓存的还是旧配色字形，且 CJK 宽字符偶发图集损坏（#37/#45）：清一次图集强制重栅格化。
  // try/catch 兜住 GPU 故障，别让单个 session 的渲染异常连累其它 session 或拖垮渲染进程（#35）。
  retheme() { const th = this.theme(); this.sessions.forEach((s) => { try { s.xterm.options.theme = th; s.webgl?.clearTextureAtlas?.(); } catch { /* */ } }); },
};
  const agentStatus = createTerminalAgentStatus({ $, term, playChime, rippleFileArea });
  term.markBusy = agentStatus.markBusy;
  term.tailText = agentStatus.tailText;
  term.lastReplyExcerpt = agentStatus.lastReplyExcerpt;
  term.notify = agentStatus.notify;
  const shortcutActions = createTerminalShortcutActions({
    term, pty: window.madoPty, win: window.madoWin, confirmDialog: deps.confirmDialog, toast,
  });
  term.closeActive = shortcutActions.closeActive;
  term.restartActive = shortcutActions.restartActive;
  term.bindDesktopEvents = shortcutActions.bindDesktopEvents;
  return term;
}
