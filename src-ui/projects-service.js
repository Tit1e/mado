/**
 * [INPUT]: 依赖 Svelte mount、ProjectsList.svelte、目录 API 与侧边栏交互回调
 * [OUTPUT]: 对外提供 createProjectsService，暴露 render/setActive/setRunningRoots
 * [POS]: src-ui 的手动项目列表适配层，连接原生侧边栏控制器与 Svelte 组件
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { mount } from 'svelte';
import ProjectsList from './ProjectsList.svelte';

export function createProjectsService({ target, api, navigate, makeDraggable, openMenu, onUnavailable, folderIcon }) {
  let host = null;
  const ensure = () => host ||= mount(ProjectsList, { target, props: {
    navigate,
    makeDraggable,
    openMenu,
    onUnavailable,
    folderIcon,
    listDirectories: async (path) => {
      const data = await api('/api/list?path=' + encodeURIComponent(path));
      return (data.entries || []).filter((entry) => entry.isDir && !entry.hidden);
    },
  } });
  return {
    render: (projects, activePath) => ensure().render(projects, activePath),
    setActive: (path) => ensure().setActive(path),
    setRunningRoots: (roots) => ensure().setRunningRoots(roots),
  };
}
