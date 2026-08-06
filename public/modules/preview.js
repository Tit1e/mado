/**
 * [INPUT]: 依赖文件与 Git Diff API、共享 state/runtime、编辑器与终端代理
 * [OUTPUT]: 对外提供 createPreviewController，管理文件预览、单文件 Git Diff、预览动作和窗口布局
 * [POS]: public/modules 的预览与布局领域控制器，被文件浏览、编辑和文件跟随流程消费
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
export function createPreviewController(deps) {
  const { $, state, runtime, guardDirty, mona, crepe, follow, setFileFollow, api, fmtSize, escapeHtml, applySelection, term, toast, enterEditMode, enterImageEdit, openWith, copyPath, ic, isHtmlName, iconSvg, fmtTime, isMdName } = deps;
// ---------- 预览 ----------
async function openPreview(e) {
  if (!await guardDirty()) return;
  mona.disposeIfAny(); crepe.disposeIfAny(); runtime.imgEditState = null; // 离开编辑态时回收编辑器（连带 worker），避免泄漏
  showPreviewPanel();
  $('#preview-title').textContent = e.name;
  const body = $('#preview-body');
  body.innerHTML = '<div class="cmdk-loading">加载中…</div>';
  renderPreviewActions(e);
  renderPreviewFoot(e);
  const k = e.kind;
  if (k === 'image') {
    // 预览用中等缩略图（秒开）。heic/heif/tiff 浏览器无法直接渲染原图，统一走 sips 缩略图端点
    const exi = (e.name.split('.').pop() || '').toLowerCase();
    const nativeImg = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'].includes(exi);
    const fallback = nativeImg ? `/api/raw?path=${encodeURIComponent(e.path)}&v=${e.mtime || 0}` : `/api/thumb?path=${encodeURIComponent(e.path)}&w=1600&v=${e.mtime || 0}`;
    body.innerHTML = `<img class="pv-img" src="/api/thumb?path=${encodeURIComponent(e.path)}&w=1000&v=${e.mtime || 0}" title="点击放大" onerror="this.onerror=null;this.src='${fallback}'">`;
    body.querySelector('.pv-img').onclick = () => lightbox(e.path, nativeImg, e.mtime);
  } else if (k === 'video') {
    body.innerHTML = `<video controls src="/api/raw?path=${encodeURIComponent(e.path)}"></video>`;
  } else if (k === 'audio') {
    body.innerHTML = `<div class="preview-meta"><span>${fmtSize(e.size)}</span></div><audio controls src="/api/raw?path=${encodeURIComponent(e.path)}"></audio>`;
  } else if (k === 'pdf') {
    body.innerHTML = `<iframe class="iframe-preview" src="/api/raw?path=${encodeURIComponent(e.path)}"></iframe>`;
  } else if (k === 'text') {
    // 代码/文本「预览即编辑」：像 md 一样默认进可编辑态，不用再点编辑按钮。
    // html 例外（给人看的是渲染形态）、csv/tsv 例外（表格视图更有用）→ 仍走只读渲染。
    if (isHtmlName(e.name) || /\.(csv|tsv)$/i.test(e.name)) {
      renderTextPreview(await api('/api/read?path=' + encodeURIComponent(e.path)));
    } else {
      return enterEditMode(e); // md/代码/纯文本：打开即可编辑、自动保存守卫
    }
  } else if (k === 'archive') {
    const d = await api('/api/archive?path=' + encodeURIComponent(e.path));
    if (!d.ok) {
      body.innerHTML = `<div class="empty-state"><div class="big">${iconSvg(e, 48)}</div>${escapeHtml(d.error || '无法读取')}<br><br>${fmtSize(e.size)}</div>`;
    } else {
      const rows = d.entries.map((en) =>
        `<div class="arch-row${en.name.endsWith('/') ? ' is-dir' : ''}"><span class="arch-name">${escapeHtml(en.name)}</span><span class="arch-size">${en.size != null ? fmtSize(en.size) : ''}</span></div>`).join('');
      body.innerHTML = `<div class="preview-meta"><span>${fmtSize(e.size)}</span><span>${d.entries.length}${d.truncated ? '+' : ''} 项</span></div><div class="arch-list">${rows}</div>`;
    }
  } else {
    body.innerHTML = `<div class="empty-state"><div class="big">${iconSvg(e, 48)}</div>这个文件类型无法预览<br><br>${fmtSize(e.size)}</div>`;
  }
}
function renderTextPreview(data) {
  const body = $('#preview-body');
  const meta = `<div class="preview-meta"><span>${data.ext || 'txt'}</span><span>${fmtSize(data.size)}</span><span>${fmtTime(data.mtime)}</span></div>`;
  const ex = (data.ext || '').toLowerCase();
  if ((ex === 'md' || ex === 'markdown') && !window.__noMarked && window.marked) {
    body.innerHTML = meta + `<div class="md-body">${window.marked.parse(data.content || '')}</div>`;
    if (window.hljs) body.querySelectorAll('pre code').forEach((b) => { try { window.hljs.highlightElement(b); } catch {} });
  } else if (ex === 'csv' || ex === 'tsv') {
    body.innerHTML = meta + csvTable(data.content || '', ex === 'tsv' ? '\t' : ',');
  } else if (ex === 'html' || ex === 'htm') {
    renderHtmlPreview(data, meta);
  } else {
    const pre = document.createElement('pre');
    const code = document.createElement('code');
    if (ex) code.className = 'language-' + ex;
    code.textContent = data.content || '';
    pre.appendChild(code);
    body.innerHTML = meta;
    body.appendChild(pre);
    if (window.hljs && !window.__noHljs) { try { window.hljs.highlightElement(code); } catch {} }
  }
}
function csvTable(text, delim) {
  const rows = text.split('\n').filter((r) => r.trim()).slice(0, 500).map((r) => r.split(delim));
  if (!rows.length) return '<div class="empty-state">空表格</div>';
  let h = '<div class="csv-wrap"><table class="csv-table"><thead><tr>';
  rows[0].forEach((c) => { h += `<th>${escapeHtml(c)}</th>`; });
  h += '</tr></thead><tbody>';
  for (let i = 1; i < rows.length; i++) {
    h += '<tr>';
    rows[i].forEach((c) => { h += `<td>${escapeHtml(c)}</td>`; });
    h += '</tr>';
  }
  h += '</tbody></table></div>';
  return h;
}
// 把绝对路径编码成 /fs/ 端点 URL，逐段 encode 以保留目录层级（相对引用按段解析）。
// 指向「预览专用端口」(主端口+1)：那个源只出文件、不含 /api，且与 App 跨源——
// 配合 iframe 的 allow-same-origin，页面能完整交互又碰不到 App 本体（防接管/删文件）。
function fsUrl(p, mtime) {
  const segs = '/fs/' + p.split('/').filter(Boolean).map(encodeURIComponent).join('/') + '?v=' + (mtime || 0);
  const base = (location.protocol === 'http:' && location.port)
    ? `${location.protocol}//${location.hostname}:${Number(location.port) + 1}` : '';
  return base + segs;
}
function renderHtmlPreview(data, meta) {
  const body = $('#preview-body');
  // 用 html-preview-host 把 meta、工具栏、iframe 包成 flex 列：
  // iframe 占满剩余高度，避免 100% 高度叠加兄弟元素导致父容器也出现滚动条，
  // 从而让 iframe 自己稳定处理页面内滚动。
  // 头部不再放 meta/「查看源码」/「浏览器打开」：顶栏的编辑（笔）= 看源码、打开 = 浏览器打开，已经够了
  body.innerHTML =
    `<div class="html-preview-host">
      <div class="iframe-wrap"><iframe class="iframe-preview" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals" scrolling="yes" src="${fsUrl(data.path, data.mtime)}"></iframe></div>
    </div>`;
  // 桌面 Chromium 的 iframe 不认 viewport meta，定宽桌面页在窄预览框里只露左上角。
  // /fs/ 注入的测宽脚本会把页面自然宽度 postMessage 过来：超出容器就整页等比缩到适配宽度。
  const wrap = body.querySelector('.iframe-wrap');
  const frame = wrap.firstElementChild;
  let natW = 0;
  // 定宽桌面页超出预览框就整页等比缩到适配宽度；放得下就保持原样
  const applyFit = () => {
    const cw = wrap.clientWidth;
    if (!natW || natW <= cw + 8 || !cw) { frame.removeAttribute('style'); return; }
    const k = cw / natW;
    frame.style.cssText = `width:${natW}px;height:${Math.round(wrap.clientHeight / k)}px;transform:scale(${k});transform-origin:0 0;`;
  };
  const onMsg = (ev) => {
    if (!frame.isConnected || ev.source !== frame.contentWindow) return;
    const w = ev.data && ev.data.madoPreviewWidth;
    if (typeof w === 'number' && w > 0 && w !== natW) { natW = w; applyFit(); }
  };
  // 上一个 HTML 预览的监听先拆掉（切文件时旧 iframe 已 detach，监听只剩泄漏）
  if (renderHtmlPreview._cleanup) renderHtmlPreview._cleanup();
  window.addEventListener('message', onMsg);
  const ro = new ResizeObserver(applyFit);
  ro.observe(wrap);
  renderHtmlPreview._cleanup = () => { window.removeEventListener('message', onMsg); ro.disconnect(); renderHtmlPreview._cleanup = null; };
}
// 查看改动：HEAD 版本 vs 工作区当前内容，用 Monaco 只读 DiffEditor 并排渲染
async function showDiff(e) {
  if (follow.on) setFileFollow(false, '手动接管，文件跟随已停');
  const data = await api('/api/git-file?path=' + encodeURIComponent(e.path));
  if (!data.isRepo) { toast('该文件不在 git 仓库里', true); return; }
  if (!data.diffable) { toast('该类型不支持 diff', true); return; }
  if (!data.isNew && (data.original || '') === (data.modified || '')) { toast('与 HEAD 无差异'); return; }
  if (!await mona.load()) { toast('编辑器未就绪', true); return; }
  if (!await guardDirty()) return;
  mona.disposeIfAny(); crepe.disposeIfAny(); runtime.imgEditState = null;
  showPreviewPanel();
  applySelection(e.path);
  $('#preview-title').textContent = (e.deleted ? '删除 · ' : data.isNew ? '新增 · ' : '改动 · ') + e.name;
  if (e.deleted) { $('#preview-actions').innerHTML = ''; $('#preview-foot').innerHTML = ''; }
  else { renderPreviewActions(e); renderPreviewFoot(e); }
  const body = $('#preview-body');
  body.innerHTML =
    `<div class="editor-bar"><span class="editor-hint">${data.isNew ? '新文件（HEAD 中不存在）' : e.deleted ? '文件已从工作区删除' : '左：HEAD　·　右：当前工作区'} · 只读</span><button id="diff-close" class="ghost-btn">${e.deleted ? '关闭' : '返回预览'}</button></div>` +
    `<div id="ed-host" class="mona-host"></div>`;
  mona.openDiff($('#ed-host'), data.original, data.modified, (e.name.split('.').pop() || '').toLowerCase());
  $('#diff-close').onclick = () => e.deleted ? closePreview() : openPreview(e);
}
function renderPreviewActions(e) {
  const box = $('#preview-actions');
  box.innerHTML = '';
  const clip = window.madoClipboard;
  // 图标为主、文字精简：主操作「打开」留字，其余只留图标 + tooltip
  const acts = [
    { id: 'preview-maxbtn', icon: ic(previewMax ? 'minimize' : 'maximize', 'currentColor', 15), title: previewMax ? '退出全屏' : '全屏放大', fn: () => setPreviewMax() },
    { icon: ic('link', 'currentColor', 14), label: '打开', title: '默认应用打开', cls: 'primary', fn: () => openWith(e.path, 'default') },
    ...(e.kind === 'text' && !isMdName(e.name) ? [{ icon: ic('edit3', 'currentColor', 15), title: '编辑文本', fn: () => enterEditMode(e) }] : []), // md 预览即编辑，无需入口
    ...(e.kind === 'text' ? [{ icon: ic('gitbranch', 'currentColor', 15), title: '查看改动（HEAD vs 当前）', fn: () => showDiff(e) }] : []),
    ...(e.kind === 'image' ? [{ icon: ic('edit3', 'currentColor', 15), title: '编辑图片', fn: () => enterImageEdit(e) }] : []),
    { icon: ic('term', 'currentColor', 15), title: '在编辑器打开', fn: () => openWith(e.path, 'editor') },
    { icon: ic('folder', 'currentColor', 15), title: '在访达显示', fn: () => openWith(e.path, 'reveal') },
    ...(e.kind === 'image' && clip ? [{ icon: ic('image', 'currentColor', 15), title: '复制图片（可粘贴到其它应用）', fn: () => copyImage(e.path) }] : []),
    ...(clip ? [{ icon: ic('copy', 'currentColor', 15), title: '复制文件（访达里可粘贴）', fn: () => copyFile(e.path) }] : []),
    { icon: ic('clip', 'currentColor', 15), title: '复制路径', fn: () => copyPath(e.path) },
  ];
  acts.forEach((a) => {
    const b = document.createElement('button');
    if (a.id) b.id = a.id;
    b.className = (a.cls || '') + (a.label ? '' : ' icon-only');
    // 有可见文字的按钮不需气泡；纯图标按钮用 data-tip 即时气泡（不再用慢吞吞的原生 title）
    if (!a.label && a.title) b.dataset.tip = a.title;
    b.innerHTML = a.label ? `${a.icon}<span>${a.label}</span>` : a.icon;
    b.onclick = a.fn;
    box.appendChild(b);
  });
}
// 预览底部：大小 · 创建 · 修改
function fmtDateTime(ms) {
  if (!ms) return '—';
  const d = new Date(ms); const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function renderPreviewFoot(e) {
  const f = $('#preview-foot');
  if (!f) return;
  if (!e || e.isDir) { f.innerHTML = ''; return; }
  f.innerHTML = `<span title="大小">${e.size ? fmtSize(e.size) : '0 B'}</span><span title="创建时间">创建 ${fmtDateTime(e.btime)}</span><span title="修改时间">改 ${fmtDateTime(e.mtime)}</span>`;
}
async function copyImage(p) { const r = await window.madoClipboard.copyImage(p); toast(r.ok ? '已复制图片，可粘贴到其它应用' : '复制图片失败：' + (r.error || ''), !r.ok); }
async function copyFile(p) { const r = await window.madoClipboard.copyFile(p); toast(r.ok ? '已复制文件，可在访达里粘贴' : '复制文件失败', !r.ok); }
async function closePreview() {
  if (!await guardDirty()) return;
  mona.disposeIfAny(); crepe.disposeIfAny(); runtime.imgEditState = null;
  if (previewMax) setPreviewMax(false);
  animateLayout();
  $('#preview').classList.add('hidden');
  $('#preview-resizer').classList.add('hidden');
  applySelection(null);
  term.fitActive();
}
function lightbox(path, nativeImg, mtime) {
  // heic/heif/tiff 无法渲染原图，放大也用大尺寸缩略图
  if (nativeImg === undefined) { const ex = (path.split('.').pop() || '').toLowerCase(); nativeImg = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'].includes(ex); }
  const src = nativeImg ? `/api/raw?path=${encodeURIComponent(path)}&v=${mtime || 0}` : `/api/thumb?path=${encodeURIComponent(path)}&w=1600&v=${mtime || 0}`;
  const ov = document.createElement('div');
  ov.className = 'lightbox';
  ov.innerHTML = `<img src="${src}"><div class="lb-hint">点击空白处关闭 · 滚轮缩放</div>`;
  let scale = 1;
  const img = ov.querySelector('img');
  ov.onclick = (ev) => { if (ev.target === ov) ov.remove(); };
  ov.onwheel = (ev) => { ev.preventDefault(); scale = Math.min(8, Math.max(0.2, scale - ev.deltaY * 0.002)); img.style.transform = `scale(${scale})`; };
  document.body.appendChild(ov);
}
// 布局：侧栏(可折叠) + 主区；折叠时侧栏 display:none 退出栅格，故改单列 1fr 让主区铺满
function applyLayout() {
  $('#app').style.gridTemplateColumns = state.sidebarCollapsed ? '1fr' : `${state.sidebarW}px 1fr`;
  document.documentElement.style.setProperty('--sidebar-w', state.sidebarW + 'px'); // 供拖拽条 fixed 定位
}
// WOW3：把选中的文字做成一个残影「甩」进终端，落地时终端闪一下——交互本身就是惊喜
function flingToTerminal(text, fromRect) {
  const panel = $('#terminal-panel');
  const tRect = (panel && !panel.classList.contains('hidden')) ? panel.getBoundingClientRect() : null;
  const ghost = document.createElement('div');
  ghost.className = 'fling-ghost';
  ghost.textContent = text.length > 42 ? text.slice(0, 42) + '…' : text;
  const sx = fromRect.left, sy = fromRect.top;
  ghost.style.left = sx + 'px'; ghost.style.top = sy + 'px';
  document.body.appendChild(ghost);
  const tx = tRect ? (tRect.left + tRect.width / 2 - 60) : window.innerWidth - 120;
  const ty = tRect ? (tRect.top + tRect.height / 2) : window.innerHeight - 80;
  requestAnimationFrame(() => {
    ghost.style.transform = `translate(${tx - sx}px, ${ty - sy}px) scale(0.25) rotate(7deg)`;
    ghost.style.opacity = '0';
  });
  ghost.addEventListener('transitionend', () => ghost.remove(), { once: true });
  setTimeout(() => ghost.remove(), 800); // 兜底清理
  if (panel && tRect) { panel.classList.remove('term-catch'); void panel.offsetWidth; panel.classList.add('term-catch'); setTimeout(() => panel.classList.remove('term-catch'), 520); }
}
// 在预览里选中文字 → 浮现「发到终端」按钮，一键把这段作为上下文喂给 agent（md/代码/文本预览生效）
function bindSelectionToTerminal() {
  const body = $('#preview-body');
  if (!body) return;
  let btn = null;
  const hide = () => { if (btn) { btn.remove(); btn = null; } };
  const show = () => {
    const sel = window.getSelection();
    const text = sel && sel.toString().trim();
    if (!text || !term.available()) { hide(); return; }
    const node = sel.anchorNode;
    const host = node && (node.nodeType === 3 ? node.parentNode : node);
    if (!host || !body.contains(host)) { hide(); return; } // 选区必须落在预览正文里
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    if (!rect || (!rect.width && !rect.height)) { hide(); return; }
    if (!btn) { btn = document.createElement('button'); btn.className = 'sel-send'; document.body.appendChild(btn); }
    btn.innerHTML = `${ic('term', 'currentColor', 13)} 发到终端`;
    const top = Math.min(window.innerHeight - 44, rect.bottom + 8);
    btn.style.top = top + 'px';
    btn.style.left = Math.max(8, Math.min(window.innerWidth - 130, rect.left)) + 'px';
    btn.onmousedown = (ev) => ev.preventDefault(); // 别让点击清掉选区
    btn.onclick = () => { const r = btn.getBoundingClientRect(); flingToTerminal(text, r); term.sendContext(text, state.selected); hide(); toast('已甩进终端，补一句要求再回车'); };
  };
  body.addEventListener('mouseup', () => setTimeout(show, 10));
  body.addEventListener('scroll', hide, true);
  document.addEventListener('mousedown', (ev) => { if (btn && ev.target !== btn && !btn.contains(ev.target)) hide(); });
}
// 给「无可见文字」的图标按钮挂即时气泡标签：把原生 title 转成 data-tip（CSS 气泡），移除 title 防双重提示
function enableTooltips(scope) {
  (scope || document).querySelectorAll('[title]').forEach((el) => {
    const label = el.getAttribute('title');
    if (!label) return;
    if (el.textContent.replace(/\s/g, '').length > 2) return; // 有明确文字标签的按钮就不加气泡
    el.dataset.tip = label;
    el.removeAttribute('title');
  });
}
// 侧边栏右缘拖拽改宽度（折叠态不可拖）
function bindSidebarResizer() {
  const handle = $('#sidebar-resizer');
  if (!handle) return;
  let dragging = false, raf = null, target = null;
  const apply = () => { raf = null; if (target == null) return; state.sidebarW = target; target = null; applyLayout(); if (typeof term !== 'undefined') term.fitActive(); };
  handle.addEventListener('mousedown', (e) => {
    if (state.sidebarCollapsed) return;
    dragging = true; e.preventDefault();
    handle.classList.add('dragging');
    document.body.style.userSelect = 'none'; document.body.style.cursor = 'col-resize';
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    target = Math.round(Math.min(420, Math.max(190, e.clientX)));
    if (!raf) raf = requestAnimationFrame(apply);
  });
  window.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false; handle.classList.remove('dragging');
    document.body.style.userSelect = ''; document.body.style.cursor = '';
    if (raf) { cancelAnimationFrame(raf); raf = null; }
    apply();
    localStorage.setItem('mado_sidebar_w', state.sidebarW);
  });
}
// 预览尺寸随 dock 翻转：终端在右→预览在下方用高度，否则用宽度
function applyPreviewSize() {
  const pv = $('#preview');
  if (!pv || pv.classList.contains('hidden')) return;
  const isRight = term.dock === 'right';
  let basis = isRight ? state.previewH : state.previewW; // 0 = 还没手动拖过
  if (!basis) { // 首次：文件列表:预览 = 1:2，预览占 2/3
    const fm = $('#filemgmt');
    const r = fm && fm.getBoundingClientRect();
    const span = r ? (isRight ? r.height : r.width) : 0;
    basis = span ? Math.round(span * 2 / 3) : (isRight ? 340 : 480);
  }
  pv.style.flexBasis = basis + 'px';
}
// 离散布局切换时短暂开启过渡（拖拽时不开，保证跟手）
function animateLayout() {
  const mb = $('#main-body'); if (!mb) return;
  mb.classList.add('lay-anim');
  clearTimeout(animateLayout._t);
  animateLayout._t = setTimeout(() => mb.classList.remove('lay-anim'), 280);
}
// 极端态特例：只在「文件区被完全盖住」时出手——终端铺满 → 还原；拖成全铺 → 退出并把终端回到 1:2 默认。
// 不做任何「最小尺寸」挤压，普通分栏比例一律不碰（这才是删掉 ensureFileAreaSize 之后要留的唯一兜底）。
function restoreFileAreaIfHidden() {
  const panel = $('#terminal-panel');
  if (!panel || panel.classList.contains('hidden')) return;
  if (term.maximized) term.toggleMax(false); // 铺满：还原即可，终端保留原尺寸
  const mb = $('#main-body');
  if (mb && mb.classList.contains('fm-squeezed')) { // 拖成全铺：文件区被压没，退出并给终端一个 2/3 的默认尺寸
    mb.classList.remove('fm-squeezed');
    localStorage.setItem('mado_term_squeeze', '0');
    const r = mb.getBoundingClientRect();
    if (term.dock === 'bottom') {
      const h = r.height ? Math.round(r.height * 2 / 3) : 280;
      panel.style.height = h + 'px'; localStorage.setItem('mado_term_h', h);
    } else {
      const w = r.width ? Math.round(r.width * 2 / 3) : 480;
      panel.style.width = w + 'px'; localStorage.setItem('mado_term_w', w);
    }
    animateLayout(); term.fitActive();
  }
}
function showPreviewPanel() {
  const wasHidden = $('#preview').classList.contains('hidden');
  $('#preview').classList.remove('hidden');
  $('#preview-resizer').classList.remove('hidden');
  if (wasHidden) animateLayout();
  applyPreviewSize();
}
// 预览全屏：让 #preview 铺满整个窗口（盖住文件区/终端/侧边栏）。md 全屏下仍是所见即所得，可继续编辑。
let previewMax = false;
function setPreviewMax(on) {
  previewMax = on === undefined ? !previewMax : !!on;
  $('#preview').classList.toggle('is-max', previewMax);
  document.documentElement.classList.toggle('preview-maxed', previewMax); // 全屏期间关掉顶栏 drag 区，否则它会吞预览按钮的点击
  // 全屏时藏掉左上角红黄绿系统按钮（和右侧自家关闭图标太像），退出再显回来
  try { window.madoWin?.trafficLights(!previewMax); } catch { /* 浏览器版无此桥 */ }
  const b = $('#preview-maxbtn');
  if (b) { b.innerHTML = ic(previewMax ? 'minimize' : 'maximize', 'currentColor', 15); b.dataset.tip = previewMax ? '退出全屏' : '全屏放大'; }
}
function applyPreviewWidth() { applyPreviewSize(); } // 兼容旧调用名
function toggleSidebar(force) {
  // 关/开侧栏前记下终端占主区的比例（仅左右分栏时）：腾出/收回的宽度按比例分给「文件区+预览」和终端，
  // 而不是全甩给左侧文件区
  const panel = $('#terminal-panel');
  const scaleTerm = panel && !panel.classList.contains('hidden') && term.dock === 'right' && !term.maximized;
  let frac = 0, oldMw = 0;
  if (scaleTerm) {
    oldMw = $('#main-body').getBoundingClientRect().width;
    if (oldMw > 0) frac = panel.getBoundingClientRect().width / oldMw;
  }
  state.sidebarCollapsed = force === undefined ? !state.sidebarCollapsed : force;
  localStorage.setItem('mado_sidebar_collapsed', state.sidebarCollapsed ? '1' : '0');
  $('#app').classList.toggle('sidebar-collapsed', state.sidebarCollapsed);
  $('#btn-sidebar')?.classList.toggle('on', state.sidebarCollapsed);
  applyLayout();
  if (scaleTerm && frac > 0) {
    const newMw = oldMw + (state.sidebarCollapsed ? state.sidebarW : -state.sidebarW); // 主区列 ±侧栏宽
    const tw = Math.max(280, Math.min(newMw - 480, Math.round(newMw * frac))); // 终端/文件区各留最小宽
    panel.style.width = tw + 'px';
    localStorage.setItem('mado_term_w', tw);
    term.fitActive();
  }
}

  return { openPreview, showDiff, renderTextPreview, fsUrl, renderPreviewActions, renderPreviewFoot, closePreview, lightbox, applyLayout, bindSelectionToTerminal, enableTooltips, bindSidebarResizer, applyPreviewSize, animateLayout, restoreFileAreaIfHidden, showPreviewPanel, setPreviewMax, isPreviewMax: () => previewMax, toggleSidebar };
}
