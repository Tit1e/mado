/**
 * [INPUT]: 依赖文件 API、Svelte 通用弹窗与上下文菜单、共享编辑运行态、终端代理以及导航和预览动作代理
 * [OUTPUT]: 对外提供 createFileActionsController，管理编辑、文件操作、工具面板和上下文菜单
 * [POS]: public/modules 的文件动作领域控制器，被预览、文件列表、侧边栏和事件层消费
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
export function createFileActionsController(deps) {
  const { $, state, api, apiPost, toast, inputDialog, confirmDialog, popupMenu, closeContextMenu, diskPanel, loadFavorites, renderFavs, renderFiles, navigate, openPreview, setFileFollow, follow, term, mona, crepe, runtime, guardDirty, dirOf, fmtSize, escapeHtml, ic, svgWrap, SVG, showPreviewPanel, renderPreviewFoot, renderPreviewActions, isFav, renderBreadcrumb, renderTextPreview, isMdName, closePreview, lightbox, enterImageEdit, refreshGitStatus } = deps;
// ---------- 操作 ----------
// macOS 打开文件时 LaunchServices 会写 com.apple.lastuseddate#PS 扩展属性，FSEvents 据此连发事件——
// 内容没动却会点亮「改」徽标。自己发起的打开记下路径，3 秒内该文件的变更事件按噪声丢弃
const selfOpened = new Map(); // 绝对路径 -> 时间戳
async function openWith(p, withApp) {
  selfOpened.set(p, Date.now());
  const r = await apiPost('/api/open', { path: p, with: withApp });
  if (r.ok) {
    const used = r.with;
    if (used === 'reveal') toast('已在文件管理器中显示');
    else if (used === 'terminal') toast('已在终端打开此目录');
    else if (used === 'editor') toast('已在编辑器打开');
    else if (withApp === 'editor' && used === 'default') toast('未找到 code 命令，已用默认应用打开');
    else toast('已打开');
    loadFavorites();
  } else toast('打开失败：' + (r.error || ''), true);
}
async function copyPath(p) {
  try { await navigator.clipboard.writeText(p); toast('已复制路径'); }
  catch { toast('复制失败（浏览器限制），路径：' + p, true); }
}
// 记录最近打开：内部预览/编辑也算「打开过」，本地即时置顶 + 异步落库
function recordRecent(p) {
  if (!p) return;
  state.recentOpened = [p, ...(state.recentOpened || []).filter((x) => x !== p)].slice(0, 30);
  apiPost('/api/recent-open', { path: p }).catch(() => {});
}
async function toggleFav(e) {
  const r = await apiPost('/api/favorites', { path: e.path, name: e.name, isDir: e.isDir });
  state.favorites = r.favorites;
  renderFavs();
  if (!$('#preview').classList.contains('hidden') && state.selected === e.path) renderPreviewActions(e);
  // 只更新该项的星标，不重建网格（避免重新解码所有缩略图）
  const on = isFav(e.path);
  const star = $('#file-area').querySelector(`[data-path="${CSS.escape(e.path)}"] .fav-btn`);
  if (star) { star.classList.toggle('on', on); star.innerHTML = svgWrap(SVG.star, 'currentColor', 15, on); }
  toast(on ? '已收藏' : '已取消收藏');
}

// ---------- 文件操作（编辑 / 重命名 / 废纸篓 / 新建）----------
// 重拉当前目录但保留筛选词，操作后刷新视图
async function refresh() {
  if (!state.cwd) return;
  const data = await api('/api/list?path=' + encodeURIComponent(state.cwd));
  if (data.error) return;
  state.entries = data.entries;
  state.project = data.project;
  state.breadcrumb = data.breadcrumb;
  renderBreadcrumb();
  renderFiles();
  refreshGitStatus(state.cwd);
}
// 文本原地编辑：md → Milkdown Crepe 所见即所得；其它 → Monaco；都失败回退 textarea
async function enterEditMode(e) {
  if (follow.on) setFileFollow(false, '手动接管，文件跟随已停'); // 编辑时绝不能被跟随抢屏
  if (!await guardDirty()) return;
  runtime.currentEditor = null; // 新编辑器接管前先清旧重载钩子；md 会在 mdEditor 里重新挂
  mona.disposeIfAny();
  crepe.disposeIfAny();
  showPreviewPanel();
  state.selected = e.path;
  $('#preview-title').textContent = e.name;
  renderPreviewActions(e);
  renderPreviewFoot(e);
  const body = $('#preview-body');
  body.innerHTML = '<div class="cmdk-loading">加载中…</div>';
  const data = await api('/api/read?path=' + encodeURIComponent(e.path));
  if (data.tooLarge) {
    toast('文件太大，暂不支持原地编辑', true);
    renderTextPreview(data); return; // 统一回退只读渲染；代码也默认进编辑态了，回 openPreview 会死循环
  }
  if (isMdName(e.name)) return mdEditor(e, data); // md：所见即所得 + 自动保存 + 源码切换
  const ex = (data.ext || '').toLowerCase();
  let baseMtime = data.mtime; // 并发覆盖保护基准
  let getValue = null, baseline = '';
  let timer = null, paused = false, saving = false, statusHeld = false, lastSavedAt = 0;
  let chain = Promise.resolve(); // 写盘串行化：防抖到点的保存和离开时的 flush 不互相踩
  const setStatus = (t) => { const el = $('#ed-status'); if (el) el.textContent = t; };
  // 「xx 之前已保存」：1 分钟内显秒、1 小时内显「分:秒」、再久直接给最后保存的钟点
  const savedAgo = (ts) => {
    const sec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (sec < 60) return `${sec}秒之前已保存`;
    if (sec < 3600) return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}秒之前已保存`;
    const d = new Date(ts), p = (x) => String(x).padStart(2, '0');
    return `最后保存于 ${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  const renderSaved = () => {
    const el = $('#ed-status');
    if (!el) { if (runtime.edStatusTimer) { clearInterval(runtime.edStatusTimer); runtime.edStatusTimer = null; } return; } // 编辑器已关：自清
    if (saving || statusHeld || !lastSavedAt) return;
    el.textContent = savedAgo(lastSavedAt);
  };
  const doSave = async (force) => {
    if (!getValue || paused) return;
    const content = getValue();
    if (content === baseline) return;
    saving = true; setStatus('保存中…');
    const r = await apiPost('/api/write', { path: e.path, content, expectedMtime: force ? 0 : baseMtime });
    if (r.conflict) {
      paused = true;
      const ok = await confirmDialog('文件已被外部修改（可能是 Codex 改的）。覆盖会丢掉外部改动，确定覆盖？');
      paused = false;
      if (ok) return doSave(true);
      saving = false; statusHeld = true; setStatus('未保存：文件被外部修改');
      return;
    }
    if (r.ok === false || r.error) { saving = false; statusHeld = true; setStatus('保存失败'); toast('保存失败：' + (r.error || ''), true); return; }
    baseMtime = r.mtime; baseline = content;
    lastSavedAt = Date.now(); saving = false; statusHeld = false; renderSaved();
  };
  const queue = () => { clearTimeout(timer); timer = setTimeout(() => { chain = chain.then(() => doSave()); }, 800); };
  const flush = () => { clearTimeout(timer); chain = chain.then(() => doSave()); return chain; };
  runtime.autosaveFlush = flush; // 离开（切文件/跳目录/关预览）时 guardDirty 把残余改动写掉，不弹确认框
  runtime.dirtyCheck = null;
  // 代码/文本编辑器顶部：撤销 / 重做两个小图标（按可用性灰显）+ 自动保存状态（和 md 一致，不再有「保存 / 完成」）
  const editorBar =
    `<div class="editor-bar"><button id="ed-undo" class="ghost-btn" title="撤销 ⌘Z" disabled>${ic('undo', 'currentColor', 15)}</button>` +
    `<button id="ed-redo" class="ghost-btn" title="重做 ⇧⌘Z" disabled>${ic('redo', 'currentColor', 15)}</button>` +
    `<span id="ed-status" class="editor-hint">自动保存</span></div>`;

  if (await mona.load()) {
    const monaco = window.monaco;
    body.innerHTML = editorBar + `<div id="ed-host" class="mona-host"></div>`;
    const ed = monaco.editor.create($('#ed-host'), {
      value: data.content || '', language: mona.lang(ex), theme: mona.themeName(),
      fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim() || 'monospace',
      fontSize: 13, lineHeight: 1.7, automaticLayout: true, minimap: { enabled: false },
      scrollBeyondLastLine: false, renderWhitespace: 'none', tabSize: 2, wordWrap: mona.wraps(ex) ? 'on' : 'off',
      smoothScrolling: true, padding: { top: 10, bottom: 10 }, fontLigatures: true,
    });
    mona.editor = ed;
    getValue = () => ed.getValue();
    const model = ed.getModel();
    const undoBtn = $('#ed-undo'), redoBtn = $('#ed-redo');
    const setUR = (u, r) => { undoBtn.disabled = !u; redoBtn.disabled = !r; };
    // 用 alternativeVersionId 跟踪撤销/重做栈：没改动时俩都灰，撤销后才放开重做，回到栈顶则重做又变灰
    const initialVersion = model.getAlternativeVersionId();
    let curVersion = initialVersion, topVersion = initialVersion;
    ed.onDidChangeModelContent(() => {
      queue();
      const v = model.getAlternativeVersionId();
      if (v < curVersion) setUR(v !== initialVersion, true);    // 撤销
      else if (v <= topVersion) setUR(true, v !== topVersion);  // 重做
      else { topVersion = v; setUR(true, false); }              // 新编辑
      curVersion = v;
    });
    ed.addCommand(monaco.KeyMod.CmdCtrl | monaco.KeyCode.KeyS, () => flush()); // ⌘S 立即保存
    undoBtn.onclick = () => { ed.focus(); ed.trigger('bar', 'undo'); };
    redoBtn.onclick = () => { ed.focus(); ed.trigger('bar', 'redo'); };
    setTimeout(() => ed.focus(), 0);
  } else {
    body.innerHTML = editorBar + `<textarea id="ed-host" class="editor-area" spellcheck="false"></textarea>`;
    const ta = $('#ed-host');
    ta.value = data.content || '';
    ta.focus();
    getValue = () => ta.value;
    const undoBtn = $('#ed-undo'), redoBtn = $('#ed-redo');
    // 兜底编辑器查不到撤销栈，改过即放开两个键（execCommand 自己会判断有没有可撤销/重做的）
    ta.addEventListener('input', () => { queue(); undoBtn.disabled = false; redoBtn.disabled = false; });
    ta.addEventListener('keydown', (ev) => {
      if ((ev.metaKey || ev.ctrlKey) && ev.key === 's') { ev.preventDefault(); flush(); }
      ev.stopPropagation(); // 别冒泡到主区键盘导航
    });
    undoBtn.onclick = () => { ta.focus(); document.execCommand('undo'); };
    redoBtn.onclick = () => { ta.focus(); document.execCommand('redo'); };
  }
  baseline = getValue ? getValue() : '';
  if (runtime.edStatusTimer) clearInterval(runtime.edStatusTimer);
  runtime.edStatusTimer = setInterval(renderSaved, 1000); // 每秒刷新「xx 之前已保存」
}
// md 预览即编辑：打开就是 Crepe 所见即所得，停笔 0.8s 自动落盘；「源码」按钮切 Monaco。
// 离开（切文件/跳目录/关预览）由 guardDirty 的 runtime.autosaveFlush 把残余改动写掉，不弹确认框。
async function mdEditor(e, data, mode = 'rich') {
  const body = $('#preview-body');
  // 拖图进编辑器时，浏览器常把卡片/预览缩略图的内部 URL（localhost/api-thumb、/fs 镜像）写进文档，
  // 而那是低清缩略图（w=160）链接，发出去就裂。这里统一还原成真实文件路径；外链 https/data: 不动。
  const cleanImgUrls = (md) => String(md)
    .replace(/(?:https?:\/\/localhost:\d+)?\/api\/(?:thumb|raw)\?path=([^)\s"'&]+)(?:&[^)\s"']*)?/g,
      (m, p) => { try { return decodeURIComponent(p); } catch { return m; } })
    .replace(/(?:https?:\/\/localhost:\d+)?\/fs\/([^)\s"']+)/g,
      (m, s) => { try { return '/' + s.split('?')[0].split('/').filter(Boolean).map(decodeURIComponent).join('/'); } catch { return m; } });
  let baseMtime = data.mtime;
  let content0 = cleanImgUrls(data.content || ''); // canonical：磁盘原始 markdown（顺手还原历史遗留的内部预览 URL）；唯一事实源，编辑器只从它初始化
  let getValue = null, baseline = '';
  let timer = null, paused = false;
  let forceCode = false; // 该文件 Milkdown 往返有损 → 锁源码模式，富文本按钮灰显（用户选「无损才用富文本」）
  let reloading = false; // 外部变更重载 in-flight 锁：fs.watch 同一文件会连发多个事件，去重防并发 render 互踩
  let chain = Promise.resolve(); // 写盘串行化：防抖到点的保存和离开时的 flush 不互相踩
  const setStatus = (t) => { const s = $('#md-status'); if (s) s.textContent = t; };
  // Milkdown 往返是否「语义无损」：所见即所得必然规范化语法（- → *、紧凑列表变松散、强调记号等），逐字节比会把干净文件也误判有损。
  // 改用渲染结果比对：两份 markdown 渲成 HTML（去掉 <p> 包裹消除松/紧列表假阳性 + 折叠空白）后相等 = 内容无损 → 放行富文本；
  // 不等 = 真丢了内容（如 <br/> 被吞、HTML 被删）→ 锁源码。marked 不可用时退回严格比对（保守锁源码，绝不误放行有损）。
  const semanticEqual = (a, b) => {
    if (!window.marked || window.__noMarked) return a === b;
    let ha, hb;
    try { ha = window.marked.parse(a || ''); hb = window.marked.parse(b || ''); } catch { return a === b; }
    const n = (s) => String(s).replace(/>\s+</g, '><').replace(/<\/?p>/g, '').replace(/\s+/g, ' ').trim();
    return n(ha) === n(hb);
  };
  const doSave = async (force) => {
    if (!getValue || paused) return;
    const content = cleanImgUrls(getValue()); // 落盘前把新拖入图片的内部预览 URL 还原成真实路径
    if (content === baseline) return;
    setStatus('保存中…');
    const r = await apiPost('/api/write', { path: e.path, content, expectedMtime: force ? 0 : baseMtime });
    if (r.conflict) {
      paused = true;
      const ok = await confirmDialog('文件已被外部修改（可能是 Codex 改的）。覆盖会丢掉外部改动，确定覆盖？');
      paused = false;
      if (ok) return doSave(true);
      setStatus('未保存：文件被外部修改');
      return;
    }
    if (r.ok === false || r.error) { setStatus('保存失败'); toast('保存失败：' + (r.error || ''), true); return; }
    baseMtime = r.mtime; baseline = content; content0 = content; // 落盘成功 → canonical 跟进，重载基准对齐
    setStatus('已保存');
  };
  const queue = () => { clearTimeout(timer); timer = setTimeout(() => { chain = chain.then(() => doSave()); }, 800); };
  const flush = () => { clearTimeout(timer); chain = chain.then(() => doSave()); return chain; };
  runtime.autosaveFlush = flush;
  runtime.dirtyCheck = null;
  const render = async (m) => {
    if (forceCode) m = 'code'; // 有损文件只允许源码，杜绝静默改写
    mode = m;
    mona.disposeIfAny(); crepe.disposeIfAny();
    const dis = forceCode; // 富文本按钮是否灰显
    body.innerHTML =
      `<div class="editor-bar"><button id="md-mode" class="ghost-btn"${dis ? ' disabled title="此文件含富文本无法无损保存的语法，已锁定源码模式"' : ''}>${m === 'rich' ? '源码' : '富文本'}</button><span id="md-status" class="editor-hint">${dis ? '源码模式（此文件富文本往返有损，已锁定）' : '自动保存 · ⌘S 立即保存'}</span></div>` +
      `<div id="ed-host" class="${m === 'rich' ? 'crepe-host' : 'mona-host'}"></div>`;
    const modeBtn = $('#md-mode');
    if (modeBtn && !dis) modeBtn.onclick = async () => {
      await flush();
      const cur = getValue ? getValue() : content0;
      if (cur !== baseline) content0 = cleanImgUrls(cur); // 只有真编辑过才采纳编辑器的值（顺手还原拖入图片的内部 URL）；没改就保留磁盘原文，不被 Milkdown 规范化
      render(m === 'rich' ? 'code' : 'rich');
    };
    const host = $('#ed-host');
    if (m === 'rich') {
      const C = await crepe.load();
      if (!C) { render('code'); return; } // Crepe 加载失败 → 源码模式兜底
      // 保护 YAML frontmatter：Crepe 不识别会丢掉，剥离后只把正文交给它，保存时再拼回
      const fm = /^(---\r?\n[\s\S]*?\r?\n---\r?\n)/.exec(content0);
      const front = fm ? fm[1] : '';
      const inst = new C.Crepe({ root: host, defaultValue: front ? content0.slice(front.length) : content0 });
      await inst.create();
      // 语义无损校验：Milkdown 序列化回来若渲染结果和磁盘原文不同（<br/> 被吞、HTML 被删等真丢内容）→ 锁源码，绝不让它静默落盘
      if (!semanticEqual(front + inst.getMarkdown(), content0)) {
        crepe.disposeIfAny();
        forceCode = true;
        toast('此文件含富文本无法无损表示的内容，已切到源码模式编辑');
        return render('code');
      }
      try { inst.on((l) => l.markdownUpdated(() => queue())); } catch { /* 旧版 Crepe 无 .on，靠下面的 input 兜底 */ }
      host.addEventListener('input', () => queue(), true); // 兜底：键入路径一定触发
      crepe.editor = inst;
      getValue = () => front + inst.getMarkdown();
      // ⌘S 立即保存：捕获阶段拦在 ProseMirror 与全局键盘导航之前
      host.addEventListener('keydown', (ev) => {
        if ((ev.metaKey || ev.ctrlKey) && ev.key === 's') { ev.preventDefault(); ev.stopPropagation(); flush(); }
      }, true);
    } else if (await mona.load()) {
      const monaco = window.monaco;
      const ed = monaco.editor.create(host, {
        value: content0, language: 'markdown', theme: mona.themeName(),
        fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim() || 'monospace',
        fontSize: 13, lineHeight: 1.7, automaticLayout: true, minimap: { enabled: false },
        scrollBeyondLastLine: false, renderWhitespace: 'none', tabSize: 2, wordWrap: 'on',
        smoothScrolling: true, padding: { top: 10, bottom: 10 }, fontLigatures: true,
      });
      mona.editor = ed;
      getValue = () => ed.getValue();
      ed.onDidChangeModelContent(() => queue());
      ed.addCommand(monaco.KeyMod.CmdCtrl | monaco.KeyCode.KeyS, () => flush());
    } else {
      const ta = document.createElement('textarea');
      ta.id = 'ed-host'; ta.className = 'editor-area'; ta.spellcheck = false;
      host.replaceWith(ta);
      ta.value = content0;
      getValue = () => ta.value;
      ta.addEventListener('input', () => queue());
      ta.addEventListener('keydown', (ev) => {
        if ((ev.metaKey || ev.ctrlKey) && ev.key === 's') { ev.preventDefault(); flush(); }
        ev.stopPropagation(); // 别冒泡到主区键盘导航
      });
    }
    baseline = getValue(); // 以编辑器规范化后的内容为基准：打开不编辑就不会触发写盘
  };
  // 外部变更重载钩子（option 4）：编辑器未脏 → 静默重载磁盘最新内容；脏 → 不动，靠保存时的 mtime 冲突保护兜底
  runtime.currentEditor = {
    path: e.path,
    // 防御：render 切换/重载途中旧编辑器已 dispose、新 getValue 未赋值，此刻被调到就当「未脏」放行重载
    isDirty: () => { try { return !!getValue && getValue() !== baseline; } catch { return false; } },
    reload: async () => {
      if (reloading) return; // 同一文件连发多个变更事件 → 只跑一次，避免并发 render 互相 dispose
      reloading = true;
      try {
        const fresh = await api('/api/read?path=' + encodeURIComponent(e.path));
        if (!fresh || fresh.error || fresh.tooLarge) return;
        if (Math.abs((fresh.mtime || 0) - baseMtime) <= 1) return; // 自己刚写的 / 无实质变化，不折腾（容差对齐 server 端冲突判定）
        const wasForced = forceCode; // 之前是被迫锁源码的吗？
        content0 = fresh.content || ''; baseMtime = fresh.mtime; forceCode = false; // 重新读盘 → 重做无损判定
        await render(wasForced ? 'rich' : mode); // 被迫锁源码过 → 重走富文本入口重判无损（锁定指示器才准）；否则保持当前模式
        toast('文件已被外部更新，编辑器已重新加载');
      } finally { reloading = false; }
    },
  };
  await render(mode);
}
async function doRename(e) {
  const name = await inputDialog('重命名', e.name, '输入新名称');
  if (!name || name === e.name) return;
  const r = await apiPost('/api/rename', { path: e.path, newName: name });
  if (r.error) { toast('重命名失败：' + r.error, true); return; }
  toast('已重命名');
  if (state.selected === e.path) state.selected = r.path;
  await refresh();
}
async function doTrash(e) {
  // 文件秒删（花叔的选择），但删整个文件夹给一次轻确认——误删项目目录代价高
  if (e.isDir) {
    const ok = await confirmDialog(`把文件夹「${e.name}」移到废纸篓？可从废纸篓恢复。`);
    if (!ok) return;
  }
  const r = await apiPost('/api/trash', { path: e.path });
  if (r.error) { toast('删除失败：' + r.error + '（首次需在弹窗里允许控制 Finder）', true); return; }
  toast('已移到废纸篓，可从废纸篓恢复');
  if (state.selected === e.path) closePreview();
  await refresh();
}
async function doCreate(type) {
  const name = await inputDialog(type === 'dir' ? '新建文件夹' : '新建文件', '', type === 'dir' ? '文件夹名称' : '文件名（带扩展名，如 note.md）');
  if (!name) return;
  const r = await apiPost('/api/create', { path: state.cwd, name, type });
  if (r.error) { toast('新建失败：' + r.error, true); return; }
  toast(type === 'dir' ? '已新建文件夹' : '已新建文件');
  await refresh();
  // 新建文件顺手打开编辑
  if (type === 'file') { const ne = state.entries.find((x) => x.path === r.path); if (ne && ne.kind === 'text') enterEditMode(ne); }
}
// ---------- 截图直通车：系统截屏落盘 → 右下角浮出直通卡，终端/素材/标注一步到位 ----------
const shotTray = {
  el: null, timer: null,
  init() {
    if (!window.codexboxShot) return; // 浏览器版没有截屏监听
    window.codexboxShot.onNew((m) => this.show(m));
  },
  show(m) {
    this.dismiss();
    const el = document.createElement('div');
    el.className = 'shot-card';
    el.innerHTML = `
      <img class="shot-thumb" draggable="true" src="/api/thumb?path=${encodeURIComponent(m.path)}&w=480&v=${m.size}" title="新截图 · 可拖进终端" data-retry="0">
      <div class="shot-info"><div class="shot-name">${escapeHtml(m.name)}</div>
      <div class="shot-acts">
        <button data-act="term" title="把路径喂给终端里的 Codex">→ 终端</button>
        <button data-act="save" title="移动到当前文件夹的 素材/ 子目录">收进素材</button>
        <button data-act="edit" title="圈重点再发">标注</button>
        <button data-act="close" title="不理它也会自己走">✕</button>
      </div></div>`;
    document.body.appendChild(el);
    this.el = el;
    const img = el.querySelector('.shot-thumb');
    // 缩略图首次加载偶尔失败（文件刚写完、缩略图还在生成）：重试几次再放弃，别一裂到底
    img.onerror = () => {
      const n = +(img.dataset.retry || 0);
      if (n >= 4) { img.style.visibility = 'hidden'; return; } // 实在不行就藏掉裂图，不难看
      img.dataset.retry = n + 1;
      setTimeout(() => { img.src = `/api/thumb?path=${encodeURIComponent(m.path)}&w=480&v=${m.size}&r=${n + 1}`; }, 400 * (n + 1));
    };
    img.ondragstart = (ev) => ev.dataTransfer.setData('text/plain', m.path);
    img.onclick = () => lightbox(m.path);
    el.querySelector('[data-act=term]').onclick = () => { term.insertPath(m.path); this.dismiss(); };
    el.querySelector('[data-act=save]').onclick = async () => {
      const r = await apiPost('/api/move', { src: m.path, dstDir: state.cwd + '/素材' });
      if (r.ok) toast('已收进 素材/'); else toast(r.error || '移动失败', true);
      this.dismiss();
    };
    el.querySelector('[data-act=edit]').onclick = () => {
      this.dismiss();
      enterImageEdit({ path: m.path, name: m.name, kind: 'image', size: m.size, mtime: Date.now() });
    };
    el.querySelector('[data-act=close]').onclick = () => this.dismiss();
    this.timer = setTimeout(() => this.dismiss(), 45000);
  },
  dismiss() { clearTimeout(this.timer); if (this.el) { this.el.remove(); this.el = null; } },
};

// AI 整理：一键在内嵌终端拉起 Codex 对话式整理。
// CodexBox 只备料——把整理偏好、过往整理历史、工作约定写成 brief 文件，Codex 读完先摊方案，
// 你在终端里对话确认/调整后它才动手；每批移动写回滚日志，想撤销在对话里说一声就行
async function organizeLaunch(dirPath) {
  const r = await apiPost('/api/organize/launch', { path: dirPath });
  if (!r.ok) { toast(r.error || 'AI 整理启动失败', true); return; }
  term.runInDir(dirPath, r.cmd, 'Codex 已开聊——先摊方案，你点头它才动手');
}

// 右键上下文菜单：业务层只组装动作，渲染、定位和关闭生命周期交给 Svelte 服务。
function showContextMenu(ev, e) {
  ev.preventDefault();
  closeContextMenu();
  const items = [];
  if (e.isDir) items.push({ label: '打开', fn: () => navigate(e.path) });
  else items.push({ label: '预览', fn: () => { state.selected = e.path; openPreview(e); renderFiles(); } });
  if (e.isDir) items.push({ label: 'AI 整理…', fn: () => organizeLaunch(e.path) });
  if (e.isDir) items.push({ label: '磁盘占用透视', fn: () => diskPanel(e.path) });
  if (e.isDir) items.push({ label: '在终端打开', fn: () => term.openInDir(e.path) });
  else items.push({ label: '在所在目录开终端', fn: () => term.openInDir(dirOf(e.path)) });
  if (e.kind === 'text') items.push({ label: '编辑文本', fn: () => enterEditMode(e) });
  if (e.kind === 'image') items.push({ label: '编辑图片', fn: () => enterImageEdit(e) });
  items.push({ label: '在编辑器打开', fn: () => openWith(e.path, 'editor') });
  items.push({ label: '在 Finder 显示', fn: () => openWith(e.path, 'reveal') });
  items.push({ label: '复制路径', fn: () => copyPath(e.path) });
  items.push({ sep: true });
  items.push({ label: isFav(e.path) ? '取消收藏' : '收藏', fn: () => toggleFav(e) });
  items.push({ label: '重命名…', fn: () => doRename(e) });
  items.push({ label: '移到废纸篓', danger: true, fn: () => doTrash(e) });
  popupMenu(ev, items);
}
  return { selfOpened, openWith, copyPath, recordRecent, toggleFav, refresh, enterEditMode, mdEditor, doRename, doTrash, doCreate, inputDialog, confirmDialog, organizeLaunch, diskPanel, showContextMenu, popupMenu, shotTray };
}
