<!--
  [INPUT]: 依赖单个目录、活动路径、目录读取及导航/拖拽回调，可递归渲染自身
  [OUTPUT]: 渲染一个可展开目录行及其懒加载子目录，可显示项目运行或不可用状态
  [POS]: ProjectsList、RootsList 与 FavoritesList 共用的递归目录节点，只负责目录树局部交互
  [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
-->
<script>
  import ProjectDirectory from './ProjectDirectory.svelte';

  let { item, activePath, listDirectories, navigate, makeDraggable, folderIcon, runningService = false, title = item.path, onMenu = null, onRemove = null, onUnavailable = null } = $props();
  let expanded = $state(false), loading = $state(false), loaded = $state(false), children = $state([]);

  function drag(node) { if (item.available !== false) return makeDraggable(node, item.path); }
  async function toggle(event) {
    event.stopPropagation();
    if (item.available === false) { onUnavailable?.(item); return; }
    if (expanded) { expanded = false; return; }
    expanded = true;
    if (loaded || loading) return;
    loading = true;
    try { children = await listDirectories(item.path); loaded = true; }
    catch { expanded = false; }
    finally { loading = false; }
  }
  function activate(event) {
    if (event.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ') return;
    if (event.type === 'keydown') event.preventDefault();
    if (item.available === false) { onUnavailable?.(item); return; }
    navigate(item.path);
  }
  function toggleByKey(event) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    toggle(event);
  }
</script>

<li
  data-path={item.path}
  class:active={item.path === activePath}
  class:running-service={runningService}
  class:unavailable={item.available === false}
  use:drag
  role="treeitem"
  aria-selected={item.path === activePath}
  aria-disabled={item.available === false}
  aria-label={item.available === false ? `${item.name}，目录不可用` : runningService ? `${item.name}，开发服务运行中` : item.name}
  tabindex="0"
  onclick={activate}
  onkeydown={activate}
  oncontextmenu={onMenu || undefined}
>
  <span class="twirl" role="button" tabindex="0" title="展开子文件夹" onclick={toggle} onkeydown={toggleByKey}>{expanded ? '▾' : '▸'}</span>
  <span class="ico">{@html folderIcon}</span>
  <span class="label" {title}>{item.name}</span>
  {#if runningService}<span class="project-run-indicator" aria-hidden="true"></span>{/if}
  {#if onRemove}<span class="unfav" role="button" tabindex="0" title="移除" onclick={(event) => { event.stopPropagation(); onRemove(item); }} onkeydown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); onRemove(item); } }}>✕</span>{/if}
</li>
{#if expanded}
  <ul class="nav-list nav-sub">
    {#if loading}<div class="nav-empty">读取中…</div>
    {:else if !children.length}<div class="nav-empty">没有子文件夹</div>
    {:else}
      {#each children as child (child.path)}
        <ProjectDirectory item={child} {activePath} {listDirectories} {navigate} {makeDraggable} {folderIcon} />
      {/each}
    {/if}
  </ul>
{/if}
