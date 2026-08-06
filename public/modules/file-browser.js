/**
 * [INPUT]: 依赖文件/Git API、共享 state、Svelte 文件列表、终端、Git 状态与预览动作代理
 * [OUTPUT]: 对外提供 createFileBrowserController，管理导航、文件视图模型、Git 状态、选择、拖放和键盘移动
 * [POS]: public/modules 的文件浏览领域控制器，被侧边栏、预览、终端和应用入口消费
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
export function createFileBrowserController(deps) {
  const { $, guardDirty, follow, restoreFileAreaIfHidden, api, toast, state, renderRootsActive, renderProjectRunActions, term, openPreview, setFileFollow, recordRecent, toggleFav, fmtSize, escapeHtml, openWith, showContextMenu, baseOf, ic, diskPanel, refresh, kindFromName, setPreviewMax, loadGitStatus, renderGitStatus, fileList } = deps;
// ---------- 导航 ----------
async function navigate(p, pushHistory = true) {
  if (!await guardDirty()) return;
  if (pushHistory && !follow.navving) restoreFileAreaIfHidden(); // 用户主动导航时，终端铺满/全铺就退出，让文件区回来
  try {
    const data = await api('/api/list?path=' + encodeURIComponent(p));
    if (data.error) { toast('无法打开：' + data.error, true); return; }
    if (pushHistory && state.cwd) state.history.push(state.cwd);
    state.cwd = data.path;
    state.entries = data.entries;
    state.project = data.project;
    state.breadcrumb = data.breadcrumb;
    state.parent = data.parent;
    state.cursor = -1;
    render();
    loadGitStatus(state.cwd);
    renderRootsActive();
    // 联动：监听此目录 + 各终端项目目录的文件变化（agent 改文件→自动刷新）
    updateWatches();
    // 手动跳目录 = 接管浏览，文件跟随让位（跟随自己发起的导航除外）
    if (follow.on && !follow.navving) setFileFollow(false, '手动接管，文件跟随已停');
  } catch (e) { toast('打开失败', true); }
}
// 汇总当前要监听的目录：浏览目录 + 每个终端会话的项目目录，发给主进程做增量监听
function updateWatches() {
  if (!window.codexboxFs) return;
  const dirs = new Set();
  if (state.cwd) dirs.add(state.cwd);
  if (typeof term !== 'undefined') term.sessions.forEach((s) => { if (s.startDir) dirs.add(s.startDir); });
  if (window.codexboxFs.watchSet) window.codexboxFs.watchSet([...dirs]);
  else window.codexboxFs.watch(state.cwd); // 旧版主进程兜底
}
// shell 单引号转义（用于把路径塞进终端 cd 命令）
function shQuote(s) { return `'${String(s).replace(/'/g, `'\\''`)}'`; }
function goBack() { if (state.history.length) navigate(state.history.pop(), false); }
function goUp() { if (state.parent && state.parent !== state.cwd) navigate(state.parent); }

// ---------- 渲染 ----------
function render() {
  renderBreadcrumb();
  renderFiles();
}
function renderBreadcrumb() {
  const bc = $('#breadcrumb');
  bc.innerHTML = '';
  (state.breadcrumb || []).forEach((c, i, arr) => {
    if (i > 0) { const s = document.createElement('span'); s.className = 'sep'; s.textContent = '›'; bc.appendChild(s); }
    const el = document.createElement('span');
    el.className = 'crumb' + (i === arr.length - 1 ? ' last' : '');
    if (c.name === '/') el.innerHTML = ic('monitor', 'currentColor', 15);
    else el.textContent = c.name;
    el.onclick = () => navigate(c.path);
    bc.appendChild(el);
  });
  // 项目配对色点：当前浏览目录落在某个终端的项目里 → 末级面包屑挂同款色，和终端标签图标呼应
  if (typeof term !== 'undefined' && term.sessions.length) {
    const ts = term.sessions
      // 排掉 / 和家目录这类浅根：它们 startsWith 任何路径都成立，色点会常亮、配对语义失效
      .filter((s) => s.cwd && s.cwd !== '/' && s.cwd !== state.home && (state.cwd === s.cwd || (state.cwd || '').startsWith(s.cwd.replace(/\/$/, '') + '/')))
      .sort((a, b) => b.cwd.length - a.cwd.length)[0];
    if (ts) {
      const d = document.createElement('span');
      d.className = 'crumb-proj';
      d.style.background = `hsl(${term.hueOf(ts.cwd)} 62% 48%)`;
      d.title = '终端「' + (ts.title || '') + '」正在这个项目里干活';
      bc.appendChild(d);
    }
  }
  if (state.project) {
    const b = document.createElement('span');
    b.className = 'proj-badge';
    b.textContent = state.project.toUpperCase() + ' 项目';
    bc.appendChild(b);
  }
  renderProjectRunActions();
  // 滚到末尾，确保被挤压时也能看到当前所在目录（而非根目录）
  requestAnimationFrame(() => { bc.scrollLeft = bc.scrollWidth; });
}
function visibleEntries() {
  let list = state.entries.slice();
  if (!state.showHidden) list = list.filter((e) => !e.hidden);
  const dirFirst = (a, b) => (a.isDir !== b.isDir ? (a.isDir ? -1 : 1) : 0);
  if (state.sort === 'mtime') list.sort((a, b) => dirFirst(a, b) || b.mtime - a.mtime);
  else if (state.sort === 'size') list.sort((a, b) => dirFirst(a, b) || b.size - a.size);
  else list.sort((a, b) => dirFirst(a, b) || a.name.localeCompare(b.name, 'zh', { numeric: true }));
  return list;
}
// 底部状态条：当前文件夹的基础信息小字常驻，「占用透视」入口也安在这
function renderStatusbar() {
  const sb = $('#statusbar'); if (!sb) return;
  if (!state.cwd) { sb.classList.add('hidden'); return; }
  const list = state.visible || [];
  const dirs = list.filter((e) => e.isDir).length;
  const files = list.length - dirs;
  const bytes = list.reduce((a, e) => a + (e.isDir ? 0 : e.size || 0), 0);
  sb.classList.remove('hidden');
  sb.innerHTML = `<span>${list.length} 项${dirs ? ` · ${dirs} 文件夹` : ''}${files ? ` · ${files} 文件 ${fmtSize(bytes)}` : ''}</span><span class="sb-links"><span id="git-status-slot"></span><a id="sb-du" title="算上子目录的真实磁盘占用">占用透视</a></span>`;
  renderGitStatus();
  $('#sb-du').onclick = () => diskPanel(state.cwd);
}
function renderFiles() {
  const list = visibleEntries();
  state.visible = list;
  renderStatusbar();
  fileList.render({
    entries: list, view: state.view, gridSize: state.gridSize, selected: state.selected,
    cursor: state.cursor, changed: state.changed, favorites: state.favorites.map((favorite) => favorite.path),
  }, {
    click: (entry, index) => { state.cursor = index; onItemClick(entry); },
    open: (event, entry) => { if (!event.target.closest('.fav-btn')) onItemOpen(entry); },
    menu: (event, entry, index) => { state.cursor = index; showContextMenu(event, entry); },
    favorite: (entry) => toggleFav(entry),
    drag: dragItem,
  });
  state.cols = fileList.measureColumns();
}
function dragItem(event, entry) {
  event.dataTransfer.setData('text/plain', entry.path);
  event.dataTransfer.setData('application/x-codexbox-path', entry.path);
  // 图片拖进 Markdown 时传原始路径，不能把缩略图 URL 写入文档。
  if (entry.kind === 'image') event.dataTransfer.setData('text/html', `<img src="${escapeHtml(encodeURI(entry.path))}" alt="${escapeHtml(entry.name)}">`);
  event.dataTransfer.effectAllowed = 'copy';
}
// 把系统拖入的文件（Finder 文件 / 截图浮窗缩略图）存进目标目录：
// 有真实路径就复制进去，没路径（file-promise）就把字节直接写进去。仿终端那套口径。
async function dropFilesInto(fileList, dir) {
  if (!window.codexboxDrop || !dir) { toast('该环境不支持拖入保存', true); return; }
  const files = [...(fileList || [])];
  if (!files.length) return;
  let saved = 0, lastPath = null;
  for (const f of files) {
    const src = window.codexboxDrop.pathForFile(f);
    let r;
    if (src) r = await window.codexboxDrop.copyInto(src, dir).catch(() => null);
    else r = await window.codexboxDrop.saveInto(dir, f.name, await f.arrayBuffer()).catch(() => null);
    if (r && r.ok) { saved++; lastPath = r.path; }
  }
  if (!saved) { toast('存入失败', true); return; }
  const where = dir === state.cwd ? '' : '「' + baseOf(dir) + '」';
  toast(saved === 1 ? `已存入${where} ${baseOf(lastPath)}` : `已存入${where} ${saved} 个文件`);
  if (dir === state.cwd) { await refresh(); if (lastPath) applySelection(lastPath); }
}
// 拖入 app 内/外部的图片（预览里的图等都是 <img>，拖动带的是图片 URL 而非系统文件）：
// 取 URL → fetch 出字节 → 存进目标目录。只收图片，非图片忽略。
async function dropUrlInto(url, dir) {
  if (!window.codexboxDrop || !dir) { toast('该环境不支持拖入保存', true); return; }
  url = (String(url || '').split(/[\r\n]/).find((l) => l && !l.trim().startsWith('#')) || '').trim(); // uri-list 可能多行/含 # 注释
  if (!url) return;
  let blob;
  try { const r = await fetch(url); if (!r.ok) throw 0; blob = await r.blob(); }
  catch { toast('读不到拖入的图片', true); return; }
  if (!/^image\//.test(blob.type)) { toast('目前只支持拖入图片', true); return; }
  const e = ((blob.type.split('/')[1] || 'png').toLowerCase().replace('jpeg', 'jpg').replace(/[^a-z0-9]/g, '')) || 'png';
  let name = '';
  try { name = baseOf(decodeURIComponent(new URL(url, location.href).pathname)); } catch { /* blob:/data: 无 pathname */ }
  if (!name || !/\.[a-z0-9]+$/i.test(name)) name = `image-${Date.now()}.${e}`;
  const r = await window.codexboxDrop.saveInto(dir, name, await blob.arrayBuffer()).catch(() => null);
  if (!r || !r.ok) { toast('存入失败', true); return; }
  const where = dir === state.cwd ? '' : '「' + baseOf(dir) + '」';
  toast(`已存入${where} ${baseOf(r.path)}`);
  if (dir === state.cwd) { await refresh(); if (r.path) applySelection(r.path); }
}
// 让任意元素可拖拽出一个路径（侧栏目录/收藏 → 终端）
function makeDraggablePath(el, p) {
  el.draggable = true;
  el.addEventListener('dragstart', (ev) => {
    ev.dataTransfer.setData('text/plain', p);
    ev.dataTransfer.setData('application/x-codexbox-path', p);
    ev.dataTransfer.effectAllowed = 'copy';
  });
}
// 只切换选中态的 class，绝不重建整个网格（重建会把所有缩略图重新解码 → 点击卡顿元凶）
function applySelection(path) {
  state.selected = path;
  fileList.setSelection(path);
}
function onItemClick(e) {
  if (follow.on) setFileFollow(false, '手动接管，文件跟随已停'); // 目录分支由 navigate 内统一处理，这里管点文件
  if (e.isDir) { state.selected = e.path; navigate(e.path); return; }
  applySelection(e.path);
  openPreview(e);
  recordRecent(e.path);
}
function onItemOpen(e) {
  if (e.isDir) return navigate(e.path);
  // 文本/代码、图片、视频双击 =「正经看这文件」→ 全屏预览；pdf/压缩包/二进制仍交系统默认 App 打开。
  // 单击已经预览过同一文件，这里只负责放大，避免重复加载编辑器。
  const k = e.kind || kindFromName(e.name);
  if (k === 'text' || k === 'image' || k === 'video') {
    if (state.selected !== e.path) { applySelection(e.path); openPreview(e); recordRecent(e.path); }
    setPreviewMax(true);
  } else { openWith(e.path, 'default'); }
}

// ---------- 主区键盘导航 ----------
function highlightCursor() {
  fileList.setCursor(state.cursor);
  if (state.cursor < 0) return;
  const el = $('#file-area').querySelector(`[data-idx="${state.cursor}"]`);
  if (el) { el.classList.add('cursor'); el.scrollIntoView({ block: 'nearest' }); }
}
function moveCursor(d) {
  if (!state.visible.length) return;
  if (state.cursor < 0) state.cursor = 0;
  else state.cursor = Math.min(state.visible.length - 1, Math.max(0, state.cursor + d));
  highlightCursor();
}
function cursorEnter(editor) {
  const e = state.visible[state.cursor];
  if (!e) return;
  if (follow.on) setFileFollow(false, '手动接管，文件跟随已停');
  if (editor && !e.isDir) { openWith(e.path, 'editor'); return; }
  if (e.isDir) { state.selected = e.path; navigate(e.path); }
  else { applySelection(e.path); openPreview(e); recordRecent(e.path); }
}


  return { navigate, updateWatches, shQuote, goBack, goUp, render, renderBreadcrumb, visibleEntries, renderStatusbar, renderFiles, makeDraggablePath, applySelection, moveCursor, cursorEnter, dropFilesInto, dropUrlInto };
}
