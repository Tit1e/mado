/**
 * [INPUT]: 依赖终端控制器、文件变化桥接、共享 state/follow、预览与导航回调
 * [OUTPUT]: 对外提供 createFileFollowController，管理 Agent 文件跟随、实时渲染和变化反馈
 * [POS]: public/modules 的文件跟随领域控制器，被终端状态和文件监听事件消费
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
export function createFileFollowController(deps) {
  const { $, state, follow, term, api, openPreview, navigate, renderFiles, refresh, applySelection, renderPreviewFoot, renderPreviewActions, showPreviewPanel, fsUrl, escapeHtml, iconSvg, fmtSize, baseOf, dirOf, toast, mona, crepe, playChime, rippleFileArea, kindFromName, isNoisyChange, runtime, selfOpened, isMdName, openWith } = deps;
// ---------- 文件跟随（agent 改哪个文件，文件区 + 预览就跟到哪）----------
// 代码文件实时滚动到刚写入的行并高亮；html 边写边出实时网页（双缓冲换页不白闪）；
// md 边写边渲染。任何手动浏览/编辑 = 接管，跟随立即自动停，想跟再点按钮。
const isHtmlName = (n) => /\.(html?|xhtml)$/i.test(String(n || ''));
// 「产物」= agent 编译/打包出来的东西，不是写给人实时看的源码：二进制、库、压缩包、安装包。
// 跟随到这些时不抢实时渲染，改成一张干净的产物卡片（而不是死板的「无法预览」）。
const ARTIFACT_EXT = new Set(['app', 'dylib', 'so', 'o', 'a', 'node', 'wasm', 'bin', 'exe', 'dll', 'class', 'pyc', 'pyo',
  'dmg', 'pkg', 'deb', 'rpm', 'msi', 'framework', 'jar', 'war', 'ipa', 'apk', 'lib', 'obj', 'zip', 'tar', 'gz', 'tgz',
  'bz2', 'xz', '7z', 'rar', 'iso', 'bundle', 'xcarchive']);
// 无扩展名但其实是文本、值得跟的常见配置/构建文件（白名单外的无扩展名一律按二进制产物处理）
const NOEXT_TEXT = new Set(['Makefile', 'Dockerfile', 'LICENSE', 'README', 'CHANGELOG', 'Procfile', 'Gemfile',
  'Rakefile', 'Brewfile', 'Caddyfile', 'Justfile', 'Vagrantfile', 'Jenkinsfile']);
function isFollowArtifact(name) {
  const base = baseOf(String(name || ''));
  const segs = String(name).split('/');
  if (segs.some((s) => /\.(app|framework|xcarchive|bundle)$/i.test(s))) return true; // .app 等「包」内部的一切都算产物
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return !NOEXT_TEXT.has(base); // 无扩展名：白名单外当二进制（编译出的可执行多半没扩展名）
  return ARTIFACT_EXT.has(base.slice(dot + 1).toLowerCase());
}
function rememberFollowChange(dir, sub) {
  const now = Date.now();
  const path = dir.replace(/\/$/, '') + '/' + sub;
  follow.recentChanges = [
    { path, ts: now },
    ...follow.recentChanges.filter((item) => item.path !== path && now - item.ts < 300000),
  ].slice(0, 20);
}
function setFileFollow(on, offMsg) {
  if (follow.on === on) return;
  // 开启：把跟随死死锚定到一个活着的终端 tab——只盯这个 agent，别的 tab 一律不串。
  // 桌面有终端却没有活动 tab 时直接拒绝（否则退化成「全文件系统跟随」，正是要根治的乱源）。
  if (on && typeof term !== 'undefined' && term.available()) {
    const sid = term.sessions.some((x) => x.id === term.active) ? term.active : null;
    if (!sid) { toast('先点开一个终端 tab，跟随才知道盯哪个 Codex 会话', true); $('#file-follow')?.classList.remove('on'); return; }
    follow.sid = sid;
    const s = term.sessions.find((x) => x.id === sid);
    if (s) term.refreshCwd(s, true).catch(() => {}); // 立刻校准 cwd，scope 从第一笔就准（不靠回车后的延迟轮询）
    follow.label = s ? (baseOf(s.cwd || s.startDir || '') || s.title || '') : '';
  } else {
    follow.sid = null; follow.label = ''; // 浏览器版无终端：维持旧口径（全跟）
  }
  follow.on = on;
  $('#file-follow')?.classList.toggle('on', on);
  clearTimeout(follow.timers.sw); clearTimeout(follow.timers.rd);
  stopFollowNarration(); // 清掉上一轮旁白轮询（interval 不能靠下面的 timers={} 回收）
  follow.timers = {};
  follow.path = null; follow.pendingPath = null; follow.lastContent = null;
  follow.swapping = false; follow.swapDirty = false;
  if (typeof term !== 'undefined') term.renderTabs(); // 给绑定的 tab 标上/撤掉「跟随中」标记
  if (!on) $('#preview-title')?.querySelector('.live-badge')?.remove(); // 留住最后画面，只摘掉「跟随中」
  toast(on ? (follow.label ? `文件跟随已开 · 盯着「${follow.label}」这个终端` : '文件跟随已开：Codex 改哪个文件就看哪个') : (offMsg || '文件跟随已停'));
  // 一开就有得看：5 分钟内有过范围内的变更就直接跟上，不用干等 agent 下一笔
  if (on) {
    startFollowNarration(); // 底部过程旁白：实时说 agent 在干嘛
    const recent = follow.recentChanges.find((c) => Date.now() - c.ts < 300000 && inFollowScope(c.path));
    if (recent) followSwitch(recent.path);
  }
}
// 跟随范围 = 绑定终端「现在」所在的项目目录（cwd 随 agent cd 走）；没绑终端则保持旧口径全跟
function followScopeRoot() {
  if (!follow.sid || typeof term === 'undefined') return null;
  const s = term.sessions.find((x) => x.id === follow.sid);
  if (!s) return null;
  return (s.cwd || s.startDir || '').replace(/\/$/, '') || null;
}
function inFollowScope(full) {
  if (!follow.sid) return typeof term === 'undefined' || !term.available(); // 只有无终端(浏览器)才全跟；桌面没绑=不跟
  const root = followScopeRoot();
  if (!root) return false;
  return full === root || full.startsWith(root + '/');
}
// 归属硬化：文件事件本身不带「谁写的」，靠「绑定 tab 此刻在不在干活」消歧。
// 别的 tab 在重叠目录里写东西时，绑定 tab 多半是空闲的，于是这笔不会被误当成它的产出。
function boundCodexActive() {
  if (!follow.sid || typeof term === 'undefined') return true; // 没绑(浏览器降级)不设此关
  const s = term.sessions.find((x) => x.id === follow.sid);
  if (!s) return false;
  return s.status === 'busy' || (Date.now() - (s.lastData || 0) < 8000);
}
// 看头优先级：html/md 这种「写给人看的」> 代码 > 其它（图片/数据）> 产物（二进制/压缩包，最不该抢屏）
const followPrio = (p) => isFollowArtifact(p) ? 0 : ((isHtmlName(p) || isMdName(p)) ? 3 : (kindFromName(p) === 'text' ? 2 : 1));
// 变更事件入口（已过噪声/自打开过滤）：同一文件继续写 → 只刷视图；换了文件 → 节流切目标
function followChange(dir, sub) {
  if (!follow.on) return;
  // 绑定的终端 tab 被关掉：跟随失去对象，全部动作就地停
  if (follow.sid && typeof term !== 'undefined' && !term.sessions.some((x) => x.id === follow.sid)) {
    setFileFollow(false, '绑定的终端已关闭，文件跟随已停');
    return;
  }
  const full = dir.replace(/\/$/, '') + '/' + sub;
  if (!inFollowScope(full)) return; // 别的项目/别的 App 写的文件，不归这次跟随管
  if (!boundCodexActive()) return;  // 绑定的 Codex 此刻没在干活——这笔多半是别的 tab 写的，不抢屏
  if (full === follow.path) { scheduleFollowRender(); return; }
  if (runtime.dirtyCheck || runtime.autosaveFlush || runtime.imgEditState) return; // 编辑器开着就不抢屏，等用户收工
  // 已排队的目标更值得看（html/md）时，不被低优先级写入顶掉
  if (follow.timers.sw && follow.pendingPath && followPrio(follow.pendingPath) > followPrio(full)) return;
  follow.pendingPath = full;
  // 节流而非防抖：agent 在多个文件间快速轮写时，定时器只设一次，到点取最新目标，
  // 防抖会被连续事件无限顺延、永远切不过去
  if (!follow.timers.sw) {
    const wait = follow.path ? 900 : 120; // 还没跟上任何文件时秒切，已在跟随时稳住节奏
    follow.timers.sw = setTimeout(() => { follow.timers.sw = null; followSwitch(follow.pendingPath); }, wait);
  }
}
async function followSwitch(full) {
  if (!follow.on || !full) return;
  if (runtime.dirtyCheck || runtime.autosaveFlush || runtime.imgEditState) return;
  follow.switching = true; // 切换期间压住 scheduleFollowRender，末尾的整体渲染会兜住
  follow.path = full; follow.lastContent = null; follow.pendingPath = null;
  follow.swapping = false; follow.swapDirty = false;
  try {
    const dir = dirOf(full);
    if (dir !== state.cwd) {
      follow.navving = true;
      try { await navigate(dir, false); } finally { follow.navving = false; }
      if (!follow.on || state.cwd !== dir) { follow.path = null; return; } // 目录打不开/期间被停掉
    }
    let e = state.entries.find((x) => x.path === full);
    if (!e) { await refresh(); e = state.entries.find((x) => x.path === full); } // 新文件刚出现，列表还没刷出来
    if (e && e.isDir) { follow.path = null; return; } // mkdir 之类的目录变更不跟
    if (!e) e = { path: full, name: baseOf(full), kind: kindFromName(full), isDir: false };
    applySelection(full);
    await followRender(e, true);
  } finally { follow.switching = false; }
}
function scheduleFollowRender() {
  if (follow.timers.rd) return;
  follow.timers.rd = setTimeout(() => {
    follow.timers.rd = null;
    if (!follow.on || !follow.path || follow.switching) return;
    const e = state.entries.find((x) => x.path === follow.path)
      || { path: follow.path, name: baseOf(follow.path), kind: kindFromName(follow.path), isDir: false };
    followRender(e, false);
  }, 300);
}
async function followRender(e, first) {
  if (!follow.on || follow.path !== e.path) return;
  const kind = e.kind || kindFromName(e.path);
  // 产物（二进制/压缩包/包内容）或服务端识别为不可预览的：不实时渲染，给一张干净的产物卡片
  if (isFollowArtifact(e.name) || !['text', 'image', 'video', 'audio', 'pdf'].includes(kind)) {
    return followArtifactCard(e);
  }
  if (kind === 'text') {
    if (first) followChrome(e);
    if (isHtmlName(e.name)) return liveHtml(e, first);
    if (isMdName(e.name) && window.marked && !window.__noMarked) return liveMd(e, first);
    return liveCode(e, first);
  }
  // 图片/视频/PDF 等：走常规预览，塞新鲜 mtime 破缓存，每次写入整个换新
  await openPreview({ ...e, mtime: Date.now() });
  if (follow.on && follow.path === e.path) followBadge(e);
}
// 跟随视图的外框：面板 + 标题徽标 + 动作条（不复用 openPreview，避免 md 被它转进编辑器）
function followChrome(e) {
  mona.disposeIfAny(); crepe.disposeIfAny(); runtime.imgEditState = null;
  showPreviewPanel();
  followBadge(e);
  renderPreviewActions(e);
  renderPreviewFoot(e);
  $('#preview-body').innerHTML = '<div class="cmdk-loading">加载中…</div>';
}
// 产物卡片：agent 编译/打包出来的成品，没法实时渲染，给一张「已生成」的交付态卡片，比「无法预览」有用得多
function followArtifactCard(e) {
  followChrome(e);
  const body = $('#preview-body');
  const real = state.entries.find((x) => x.path === e.path) || e;
  const sizeStr = real.size ? fmtSize(real.size) : '';
  body.innerHTML =
    `<div class="empty-state artifact-card">
      <div class="big">${iconSvg(real, 48)}</div>
      <div class="art-name">${escapeHtml(e.name)}</div>
      <div class="art-sub">Codex 刚生成${sizeStr ? ' · ' + sizeStr : ''}</div>
      <div class="art-btns"><button class="ghost-btn" data-act="reveal">在访达显示</button><button class="ghost-btn" data-act="open">打开</button></div>
    </div>`;
  body.querySelector('[data-act="reveal"]').onclick = () => openWith(e.path, 'reveal');
  body.querySelector('[data-act="open"]').onclick = () => openWith(e.path, 'default');
}
function followBadge(e) {
  const art = isFollowArtifact(e.name);
  const where = follow.label ? `<span class="live-where">${escapeHtml(follow.label)}</span>` : '';
  $('#preview-title').innerHTML = `<span class="live-badge${art ? ' done' : ''}"><i></i>${art ? '已生成' : '跟随中'}</span>${where}${escapeHtml(e.name)}`;
}
// ===== 阶段二「过程旁白」：结果是主视图，底部一行实时说 agent 此刻在干嘛 =====
// Codex 工具调用动词 → 人话
const ACTION_VERB = { Read: '读', Edit: '写', Update: '写', Write: '写', MultiEdit: '写', NotebookEdit: '写',
  Bash: '跑', Grep: '搜', Glob: '找', Search: '搜', Task: '子任务', TodoWrite: '理清单', Fetch: '抓取' };
// 从绑定终端的输出尾巴里捞最近一条「干了什么」。尽量稳健：认 ⏺/● 圆点工具行，认 Web Search，
// 都没有就看是不是在思考（页脚挂着 esc to interrupt）。提炼失败返回空串（旁白只显示文件侧）。
function latestCodexAction(s) {
  const txt = term.tailText(s, 40);
  if (!txt) return '';
  const lines = txt.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const ln = lines[i];
    let m = ln.match(/(?:web\s*search|websearch)[\s(:]+["“]?([^"”)\n]{1,40})/i);
    if (m) return '联网搜 ' + m[1].trim();
    m = ln.match(/[⏺●·]\s*([A-Z][A-Za-z]+)\s*\(([^)]*)\)/);
    if (m) {
      const verb = ACTION_VERB[m[1]] || m[1];
      let arg = (m[2] || '').trim().replace(/^["']|["']$/g, '');
      if (['读', '写'].includes(verb) && arg.includes('/')) arg = baseOf(arg);
      if (arg.length > 30) arg = arg.slice(0, 30) + '…';
      return arg ? `${verb} ${arg}` : verb;
    }
  }
  if (/esc to interrupt/i.test(txt)) return '思考中…';
  return '';
}
function renderFollowNarration() {
  const el = $('#follow-narration');
  if (!el) return;
  if (!follow.on) { el.classList.add('hidden'); el.innerHTML = ''; return; }
  const s = follow.sid && typeof term !== 'undefined' ? term.sessions.find((x) => x.id === follow.sid) : null;
  const busy = !!(s && (s.status === 'busy' || Date.now() - (s.lastData || 0) < 8000));
  const action = s ? latestCodexAction(s) : '';
  // 结果已在主视图 + 标题徽标里；这条只说「过程」：优先 agent 的终端动作，
  // 没动作就退回「在写哪个文件」，agent 闲下来则报一句平静的收尾。
  let main, live = busy;
  if (busy && action) main = action;
  else if (busy && follow.path) main = (isFollowArtifact(baseOf(follow.path)) ? '生成 ' : '写 ') + baseOf(follow.path);
  else if (action && action !== '思考中…') main = action; // 刚停手，留住最后动作
  // 跟随已开但绑的终端还没写文件：明说「等待…」，别把旁白栏藏起来让用户以为跟随坏了（#30）
  else { main = follow.path ? '停在 ' + baseOf(follow.path) : (follow.label ? `等待「${follow.label}」写文件…` : '等待 Codex 写文件…'); live = false; }
  if (!main) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  const lead = live ? 'Codex 正在 ' : '';
  el.innerHTML = `<span class="fn-dot${live ? ' live' : ''}"></span>${escapeHtml(lead)}<span class="fn-term">${escapeHtml(main)}</span>`;
}
function startFollowNarration() { stopFollowNarration(); follow.timers.narr = setInterval(renderFollowNarration, 1200); renderFollowNarration(); }
function stopFollowNarration() { if (follow.timers.narr) { clearInterval(follow.timers.narr); follow.timers.narr = null; } const el = $('#follow-narration'); if (el) { el.classList.add('hidden'); el.innerHTML = ''; } }
// 找出新内容相对旧内容的变动行区间（首尾共同前后缀夹逼，够准且 O(n)）
function changedRange(oldStr, newStr) {
  const a = oldStr.split('\n'), b = newStr.split('\n');
  const min = Math.min(a.length, b.length);
  let s = 0;
  while (s < min && a[s] === b[s]) s++;
  let e1 = a.length - 1, e2 = b.length - 1;
  while (e1 >= s && e2 >= s && a[e1] === b[e2]) { e1--; e2--; }
  if (e2 < s) return { start: Math.min(s, b.length - 1), end: Math.min(s, b.length - 1) }; // 纯删除：指向删除位置
  return { start: s, end: e2 };
}
// 把 hljs 输出按行切开：跨行的 span 行尾闭合、下一行重开，每行都是闭合 HTML
function splitHighlighted(html) {
  const out = []; const open = []; let cur = ''; let last = 0; let m;
  const re = /<span[^>]*>|<\/span>|\n/g;
  while ((m = re.exec(html)) !== null) {
    cur += html.slice(last, m.index); last = re.lastIndex;
    if (m[0] === '\n') { out.push(cur + '</span>'.repeat(open.length)); cur = open.join(''); }
    else if (m[0] === '</span>') { if (open.length) { open.pop(); cur += '</span>'; } }
    else { open.push(m[0]); cur += m[0]; }
  }
  out.push(cur + html.slice(last));
  return out;
}
function highlightLines(content, ext) {
  if (window.hljs && !window.__noHljs && ext && window.hljs.getLanguage(ext)) {
    try { return splitHighlighted(window.hljs.highlight(content, { language: ext, ignoreIllegals: true }).value); }
    catch { /* 高亮失败退纯文本 */ }
  }
  return content.split('\n').map(escapeHtml);
}
// 代码实时流：每次写入重读全文，逐行渲染，本次改动的行闪一下并平滑滚过去
async function liveCode(e, first) {
  const data = await api('/api/read?path=' + encodeURIComponent(e.path));
  if (!follow.on || follow.path !== e.path) return; // 拉取期间已切走/停掉
  const body = $('#preview-body');
  if (data.error || data.tooLarge) {
    body.innerHTML = `<div class="empty-state">${escapeHtml(data.tooLarge ? '文件太大，跟随暂不渲染内容' : (data.error || '读取失败'))}</div>`;
    follow.lastContent = null;
    return;
  }
  const content = data.content || '';
  if (!first && content === follow.lastContent) return;
  const range = follow.lastContent == null ? null : changedRange(follow.lastContent, content);
  const lines = highlightLines(content, (data.ext || '').toLowerCase());
  let host = body.querySelector('.follow-code');
  if (!host) { body.innerHTML = '<pre class="follow-code"></pre>'; host = body.querySelector('.follow-code'); }
  host.innerHTML = lines.map((ln, i) =>
    `<div class="cl${range && i >= range.start && i <= range.end ? ' cl-new' : ''}">${ln}</div>`).join('');
  follow.lastContent = content;
  // 首次（不知道改了哪）滚到底——正被写的文件大概率在长尾巴；之后跟着改动行走
  const target = range ? host.children[Math.min(range.end, host.children.length - 1)] : host.lastElementChild;
  if (target) target.scrollIntoView({ block: 'center', behavior: first ? 'auto' : 'smooth' });
}
// md 实时渲染：变更在尾部就贴底滚动（agent 通常从上往下写），改中间则保持视口不跳
async function liveMd(e, first) {
  const data = await api('/api/read?path=' + encodeURIComponent(e.path));
  if (!follow.on || follow.path !== e.path) return;
  const body = $('#preview-body');
  if (data.error || data.tooLarge) return liveCode(e, first); // 复用其错误/超限展示
  const content = data.content || '';
  if (!first && content === follow.lastContent) return;
  const range = follow.lastContent == null ? null : changedRange(follow.lastContent, content);
  const nearEnd = !range || range.end >= content.split('\n').length - 4;
  const keep = body.scrollTop;
  body.innerHTML = `<div class="md-body">${window.marked.parse(content)}</div>`;
  if (window.hljs && !window.__noHljs) body.querySelectorAll('pre code').forEach((b) => { try { window.hljs.highlightElement(b); } catch { /* */ } });
  follow.lastContent = content;
  if (nearEnd) body.scrollTo({ top: body.scrollHeight, behavior: first ? 'auto' : 'smooth' });
  else body.scrollTop = keep;
}
// html 实时网页：新 iframe 隐身加载、onload 后换掉旧的（双缓冲），白屏闪烁为零；
// 半截 html 浏览器本来就能渐进渲染，正好呈现「网页长出来」的过程
function liveHtml(e, first) {
  const body = $('#preview-body');
  let wrap = body.querySelector('.follow-html');
  if (first || !wrap) {
    body.innerHTML = `<div class="follow-html"><iframe class="iframe-preview" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals" src="${fsUrl(e.path, Date.now())}"></iframe></div>`;
    return;
  }
  if (follow.swapping) { follow.swapDirty = true; return; } // 正在换页，攒一次换完补刷
  follow.swapping = true;
  const next = document.createElement('iframe');
  next.className = 'iframe-preview follow-next';
  next.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups allow-modals'); // 与常规 html 预览同口径：经隔离端口给 same-origin（跨源于 App，接管不了）
  let swapped = false;
  const swap = () => {
    if (swapped) return;
    swapped = true;
    follow.swapping = false;
    if (!next.isConnected) return;
    if (!follow.on || follow.path !== e.path) { next.remove(); return; } // 换页途中跟随被停/切走：丢弃，别抢屏
    wrap.querySelectorAll('iframe').forEach((f) => { if (f !== next) f.remove(); });
    next.classList.remove('follow-next');
    if (follow.swapDirty) { follow.swapDirty = false; scheduleFollowRender(); }
  };
  next.onload = swap;
  setTimeout(swap, 2500); // onload 不来（死循环脚本等）也强制换，跟随不卡死
  next.src = fsUrl(e.path, Date.now());
  wrap.appendChild(next);
}

// WOW4 环境感知：完成时文件区荡开一圈大涟漪 + 极轻提示音（Web Audio 当场合成，无需音频文件）
// WOW1 活的仪表盘：每次写入，让对应文件行当场荡开涟漪 + 高亮 + 按热度发光，agent 写到哪光走到哪。
function igniteRow(top, count) {
  const area = $('#file-area');
  if (!area || !state.cwd) return;
  const path = state.cwd.replace(/\/$/, '') + state.sep + top;
  const el = area.querySelector(`[data-path="${CSS.escape(path)}"]`);
  if (!el) return; // 文件行还没渲染（新文件首次出现），等 refresh 后由 renderFiles 接管发光
  el.style.setProperty('--heat', Math.min(1, 0.4 + count * 0.12).toFixed(2));
  el.classList.remove('live-edit'); void el.offsetWidth; el.classList.add('live-edit'); // 重新触发弹跳
  const host = el.querySelector('.icon') || el;
  const ripple = document.createElement('span');
  ripple.className = 'edit-ripple';
  host.appendChild(ripple);
  ripple.addEventListener('animationend', () => ripple.remove(), { once: true });
}

// pty 数据回流（全局一次）
if (window.codexboxPty) {
  window.codexboxPty.onData(({ id, data }) => { const s = term.sessions.find((x) => x.id === id); if (s) { s.xterm.write(data); term.markBusy(s); } });
  window.codexboxPty.onExit(({ id }) => {
    const s = term.sessions.find((x) => x.id === id);
    if (s) {
      s.dead = true; s.status = 'dead';
      const service = s.kind === 'service';
      s.xterm.write(service
        ? '\r\n\x1b[90m[运行服务已退出]\x1b[0m\r\n'
        : '\r\n\x1b[90m[进程已退出 — 回车重开，或 ✕ 关闭]\x1b[0m\r\n');
      term.renderTabs();
      if (!service) term.notify(s, '终端已退出', (s.title || 'shell') + ' 的进程结束了');
    }
  });
}
// 文件变化 → 自动刷新列表（看着 agent 干活）；编辑中不动预览，避免吞掉未保存内容
if (window.codexboxFs) {
  let rt = null;
  state.changed = new Map(); // 顶层名 → { count, files:Set, ts }
  let sweep = null;
  const scheduleSweep = () => {
    if (sweep) return;
    sweep = setInterval(() => {
      const now = Date.now(); let dirty = false;
      for (const [k, v] of state.changed) { if (now - v.ts > 4500) { state.changed.delete(k); dirty = true; } }
      if (!state.changed.size) { clearInterval(sweep); sweep = null; }
      if (dirty) renderFiles();
    }, 1000); // 单一清理定时器，避免大批量变更时堆积成千上万个 timer
  };
  window.codexboxFs.onChanged(({ dir, filename }) => {
    // 系统/构建噪声（~/Library 缓存、node_modules 等 macOS 后台不停写）直接丢弃：
    // 既不点亮文件行、不触发文件跟随，也不刷新列表，否则 Library 会永远显示「被修改」。
    if (filename && isNoisyChange(filename)) return;
    // 自己刚打开的文件：macOS 写 lastuseddate 扩展属性触发的假变更，整条丢弃（不点卡、不跟随、不刷新）
    if (filename) {
      const abs = dir.replace(/\/$/, '') + '/' + String(filename);
      const t = selfOpened.get(abs);
      if (t) {
        if (Date.now() - t < 3000) return;
        selfOpened.delete(abs); // 过期条目顺手清掉，Map 不积垃圾
      }
    }
    // 文件跟随：必须在「不是当前目录就 return」之前喂，跨目录改动才跟得上
    if (filename) {
      rememberFollowChange(dir, String(filename));
      followChange(dir, String(filename));
    }
    // 打开中的 md 编辑器若对应的磁盘文件被外部（如 agent / 命令行）改了：未脏就静默重载，脏则不动（保存时 mtime 冲突保护会拦）
    if (filename && runtime.currentEditor) {
      const abs = dir.replace(/\/$/, '') + '/' + String(filename);
      if (abs === runtime.currentEditor.path && !runtime.currentEditor.isDirty()) runtime.currentEditor.reload();
    }
    if (dir !== state.cwd) return;
    // 高亮被 agent 改动的项：递归监听下 src/foo.js 归到顶层 src，并累计计数 + 记子路径供 tooltip 定位
    if (filename) {
      const sub = String(filename);
      const top = sub.split('/')[0];
      let rec = state.changed.get(top);
      if (!rec) { rec = { count: 0, files: new Set(), ts: 0 }; state.changed.set(top, rec); }
      rec.count++; rec.ts = Date.now();
      if (rec.files.size < 8 && sub !== top) rec.files.add(sub);
      scheduleSweep();
      igniteRow(top, rec.count); // 当场点亮这一行，不等 250ms 刷新。
    }
    clearTimeout(rt);
    rt = setTimeout(async () => {
      await refresh();
      if (follow.on && follow.path && state.selected === follow.path) return; // 跟随有自己的实时渲染，别用 openPreview 顶掉（md 会被转进编辑器）
      if (state.selected && !$('#preview').classList.contains('hidden') && !$('#ed-host') && !runtime.imgEditState) {
        const e = state.entries.find((x) => x.path === state.selected);
        if (e && (e.kind === 'text' || e.kind === 'image')) openPreview(e);
      }
    }, 250);
  });
}


  return { setFileFollow, rememberFollowChange, followChange };
}
