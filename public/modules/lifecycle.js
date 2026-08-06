/**
 * [INPUT]: 依赖全部已装配控制器、Git 静默刷新、终端恢复选择弹窗、桌面桥接与共享 state
 * [OUTPUT]: 对外提供 startApplication，完成界面初始化、Git 五秒轮询、终端恢复和更新提示绑定
 * [POS]: public/modules 的应用生命周期模块，由 app.js 在完成依赖装配后调用
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
export function startApplication(deps) {
  const { $, state, applyTheme, applyLayout, term, bindEvents, bindSidebarResizer, bindSelectionToTerminal, enableTooltips, loadRoots, loadFavorites, loadCodexProjects, navigate, maybeShowGuide, escapeHtml, toast, recoveryDialog, refreshGitStatus } = deps;
// ---------- 启动 ----------
async function init() {
  // 桌面 app：标记 body，给顶部交通灯留位、顶部可拖拽
  if (window.madoEnv && window.madoEnv.isDesktopApp) document.documentElement.classList.add('desktop');
  try { window.madoWin?.trafficLights(true); } catch { /* 重载后兜底恢复系统按钮，防上次全屏藏了没显回来 */ }
  applyTheme(state.theme, false);
  if (state.sidebarCollapsed) { $('#app').classList.add('sidebar-collapsed'); $('#btn-sidebar')?.classList.add('on'); }
  applyLayout();
  term.applyDock(); // 初始就给 #main-body 设好 dock 类，决定预览/文件管理方向
  bindEvents();
  bindSidebarResizer();
  bindSelectionToTerminal();
  enableTooltips();
  // md 里直接引用本地文件路径的图片，按页面 URL 解析必 404：加载失败时解析成
  // 绝对路径走 /fs/ 镜像端点兜底显示。文档源码保持干净的文件路径，预览和 Crepe 里都能看图
  $('#preview-body').addEventListener('error', (ev) => {
    const img = ev.target;
    if (!(img instanceof HTMLImageElement) || img.dataset.fsTried) return;
    const src = decodeURI(img.getAttribute('src') || '');
    if (/^(https?:|data:|blob:)/.test(src) || src.startsWith('/api/') || src.startsWith('/fs/')) return;
    let abs = src;
    if (!abs.startsWith('/')) {
      const stack = (state.selected || '').split('/').slice(0, -1);
      for (const seg of abs.split('/')) {
        if (seg === '..') stack.pop(); else if (seg && seg !== '.') stack.push(seg);
      }
      abs = '/' + stack.filter(Boolean).join('/');
    }
    img.dataset.fsTried = '1';
    img.src = '/fs' + encodeURI(abs);
  }, true);
  await loadRoots();
  await loadFavorites();
  loadCodexProjects();
  setInterval(loadCodexProjects, 60000); // 每分钟刷新项目与相对时间；服务端同样缓存 60s
  await navigate(state.home, false);
  setInterval(() => { if (state.cwd) refreshGitStatus(state.cwd); }, 5000);
  if (window.madoRecovery && recoveryDialog) {
    try {
      const entries = await window.madoRecovery.list();
      if (entries.length) {
        const decision = await recoveryDialog(entries);
        if (decision?.action === 'clear') await window.madoRecovery.clear();
        else if (decision?.action === 'restore' && decision.ids.length) {
          const selected = await window.madoRecovery.take(decision.ids);
          const restored = await term.restoreCommands(selected);
          toast(restored ? `已恢复 ${restored} 个终端任务` : '没有可恢复的终端任务', !restored);
        }
      }
    } catch { toast('读取终端恢复记录失败', true); }
  }
  // 恢复上次终端开合状态（dock 方位已由 applyDock 自带记忆）
  if (localStorage.getItem('mado_term_open') === '1' && term.available()) term.open();
  maybeShowGuide();
  bindUpdateNotice();
}
// 新版本提示：主进程查到 GitHub 有新 Release 时右下角弹胶囊，引导去下载页（不强更不打扰）
function bindUpdateNotice() {
  if (!window.madoUpdate) return;
  const show = ({ version, url }) => {
    if (localStorage.getItem('mado_skip_ver') === version || document.querySelector('.update-pill')) return;
    const bar = document.createElement('div');
    bar.className = 'update-pill';
    const canDl = typeof window.madoUpdate.download === 'function'; // 老 preload 没这桥，降级只留发布页
    bar.innerHTML = `<span class="up-msg">新版本 v${escapeHtml(version)} 已发布</span>`
      + (canDl ? '<button class="up-go up-dl">下载更新</button><button class="up-page">发布页</button>' : '<button class="up-go">去下载</button>')
      + '<button class="up-x" title="这个版本不再提醒">✕</button>';
    document.body.appendChild(bar);
    // #26 一键下载：主进程按当前架构下对应 dmg 到 ~/Downloads 并打开挂载，拖一下完成更新
    const dl = bar.querySelector('.up-dl');
    if (dl) {
      dl.onclick = async () => {
        dl.disabled = true; dl.textContent = '下载中…';
        const r = await window.madoUpdate.download(version).catch(() => ({ ok: false }));
        if (r && r.ok) { bar.querySelector('.up-msg').textContent = '已下载并打开 dmg，拖进 Applications 完成更新'; dl.remove(); }
        else { dl.disabled = false; dl.textContent = '下载更新'; toast('下载失败，去发布页手动下吧', true); }
      };
      if (window.madoUpdate.onProgress) window.madoUpdate.onProgress((m) => {
        if (m.state === 'downloading' && dl.disabled) dl.textContent = m.pct >= 0 ? `下载中 ${m.pct}%` : '下载中…';
      });
      bar.querySelector('.up-page').onclick = () => window.madoUpdate.open(url);
    } else {
      bar.querySelector('.up-go').onclick = () => { window.madoUpdate.open(url); bar.remove(); };
    }
    bar.querySelector('.up-x').onclick = () => { localStorage.setItem('mado_skip_ver', version); bar.remove(); };
  };
  window.madoUpdate.onAvailable(show);
  // 主进程启动 6 秒就推送，init 加载大目录时这里可能还没注册监听——补拉一次，错过的推送不丢
  if (window.madoUpdate.get) window.madoUpdate.get().then((m) => { if (m) show(m); }).catch(() => {});
}


  return init();
}
