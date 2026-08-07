<!--
  [INPUT]: 依赖手动项目数据、共享名称排序、当前目录、目录读取以及导航/拖拽/菜单回调
  [OUTPUT]: 对外提供 render/setActive/setRunningRoots 接口，按文件区同一规则排序并渲染用户项目与顶层服务状态
  [POS]: src-ui 的手动项目列表界面岛，不读取或修改任何 Agent 会话
  [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
-->
<script>
  import { compareNames } from '../public/modules/name-sort.js';
  import ProjectDirectory from './ProjectDirectory.svelte';

  let { listDirectories, navigate, makeDraggable, openMenu, onUnavailable, folderIcon } = $props();
  let projects = $state([]), activePath = $state(''), runningRoots = $state([]);

  export function render(list, currentPath) {
    projects = [...list].sort((a, b) => compareNames(a.name, b.name));
    activePath = currentPath;
  }
  export function setActive(path) { activePath = path; }
  export function setRunningRoots(roots) { runningRoots = Array.isArray(roots) ? roots : []; }

  function hasRunningService(projectPath) {
    const prefix = projectPath.endsWith('/') ? projectPath : `${projectPath}/`;
    return runningRoots.some((root) => root === projectPath || root.startsWith(prefix));
  }
</script>

{#if !projects.length}
  <div class="nav-empty">点击右上角 ＋ 添加项目</div>
{:else}
  {#each projects as project (project.path)}
    <ProjectDirectory
      item={project}
      {activePath}
      {listDirectories}
      {navigate}
      {makeDraggable}
      {folderIcon}
      {onUnavailable}
      runningService={project.available && hasRunningService(project.path)}
      title={project.available ? project.path : `${project.path}\n目录不存在或无法访问`}
      onMenu={(event) => openMenu(event, project)}
    />
  {/each}
{/if}
