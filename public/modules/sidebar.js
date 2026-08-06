/**
 * [INPUT]: 依赖 API、共享 state、导航、通用弹层回调与 Svelte 根目录/收藏/手动项目列表服务
 * [OUTPUT]: 对外提供 createSidebarController，管理根目录、收藏和用户项目业务
 * [POS]: public/modules 的侧边栏领域控制器，三个列表渲染委托 Svelte 服务
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
export function createSidebarController(deps) {
  const { api, apiPost, state, dirOf, navigate, openPreview, renderFiles, toast, popupMenu, projects, favorites, roots } = deps;

  async function loadRoots() {
    const data = await api('/api/roots');
    state.home = data.home;
    state.platform = data.platform;
    state.sep = data.sep || '/';
    roots.render(data.roots, state.cwd);
  }
  function renderRootsActive() {
    // 快速入口 / 收藏 / 项目三个列表统一高亮当前所在目录
    roots.setActive(state.cwd);
    projects.setActive(state.cwd);
    favorites.setActive(state.cwd);
  }
  async function loadFavorites() {
    const data = await api('/api/favorites');
    state.favorites = data.favorites || [];
    state.recentOpened = data.recentOpened || [];
    renderFavs();
  }
  function renderFavs() {
    favorites.render(state.favorites, state.cwd);
  }
  async function openFavoriteFile(favorite) {
    await navigate(dirOf(favorite.path));
    const entry = state.entries.find((item) => item.path === favorite.path);
    if (entry) { state.selected = favorite.path; openPreview(entry); renderFiles(); }
  }

  // 用户项目：配置是唯一真源，Agent 会话不参与项目发现
  function renderProjects(list) {
    projects.render(Array.isArray(list) ? list : [], state.cwd);
  }
  async function loadProjects() {
    try {
      const data = await api('/api/projects');
      if (data.ok === false) { toast(data.error || '读取项目失败', true); return; }
      renderProjects(data.projects);
    } catch { toast('读取项目失败', true); }
  }

  let projectActionPending = false;
  async function addProject() {
    if (projectActionPending) return;
    if (!window.madoProjects?.chooseDirectory) {
      toast('请在 Mado 桌面版添加项目', true);
      return;
    }
    projectActionPending = true;
    try {
      const path = await window.madoProjects.chooseDirectory();
      if (!path) return;
      const result = await apiPost('/api/projects/add', { path });
      if (!result.ok) { toast(result.error || '添加项目失败', true); return; }
      renderProjects(result.projects);
      if (!result.added) toast('项目已存在');
      await navigate(path);
    } catch { toast('添加项目失败', true); }
    finally { projectActionPending = false; }
  }

  async function removeProject(project) {
    if (projectActionPending) return;
    projectActionPending = true;
    try {
      const result = await apiPost('/api/projects/remove', { path: project.path });
      if (!result.ok) { toast(result.error || '移除项目失败', true); return; }
      renderProjects(result.projects);
      toast(result.removed ? '已从项目列表移除' : '项目已不在列表中');
    } catch { toast('移除项目失败', true); }
    finally { projectActionPending = false; }
  }

  function showProjectMenu(event, project) {
    event.preventDefault();
    event.stopPropagation();
    popupMenu(event, [{ label: '移除项目', fn: () => removeProject(project) }]);
  }
  function showUnavailableProject(project) {
    toast(`项目目录不可用：${project.path}`, true);
  }

  return {
    loadRoots, renderRootsActive, loadFavorites, renderFavs, openFavoriteFile,
    loadProjects, addProject, showProjectMenu, showUnavailableProject,
  };
}
