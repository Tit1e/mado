<!--
  [INPUT]: 依赖文件列表模型、图标/格式化函数以及选择、打开、收藏、菜单和拖拽回调
  [OUTPUT]: 对外提供 render/setSelection/setCursor 接口，声明式渲染唯一的列表视图
  [POS]: src-ui 的主文件列表界面岛，只负责文件行呈现与事件转发
  [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
-->
<script>
  let { iconSvg, formatSize, formatTime, favoriteIcon, emptyIcon } = $props();
  let entries = $state([]), selected = $state(''), cursor = $state(-1), changed = $state(null), favorites = $state([]), actions = $state({});
  const projectLabels = { node: 'node', web: 'web', python: 'py', rust: 'rs', go: 'go', git: 'git' };

  export function render(model, nextActions) {
    entries = model.entries; selected = model.selected; cursor = model.cursor;
    changed = model.changed; favorites = model.favorites; actions = nextActions;
  }
  export function setSelection(path) { selected = path; }
  export function setCursor(index) { cursor = index; }

  const isFavorite = (path) => favorites.includes(path);
  const changeFor = (entry) => changed?.get(entry.name);
  const changeTitle = (change) => change?.files?.size ? `刚变更：\n${[...change.files].join('\n')}` : undefined;
  const heat = (change) => change ? Math.min(1, 0.4 + change.count * 0.12).toFixed(2) : undefined;
  const changeText = (change) => change ? (change.count > 1 ? `改·${change.count}` : '改') : undefined;
  const sizeText = (entry) => entry.isDir ? '' : formatSize(entry.size);
  function project(entry) { return entry.isDir && projectLabels[entry.project] ? projectLabels[entry.project] : ''; }
  function activate(event, entry, index) {
    if (event.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ') return;
    if (event.type === 'keydown') event.preventDefault();
    actions.click(entry, index);
  }
  function removeBrokenThumb(event, entry) {
    const fallback = document.createElement('span');
    fallback.className = 'svg-icon'; fallback.innerHTML = iconSvg(entry, 18);
    event.currentTarget.replaceWith(fallback);
  }
</script>

{#if !entries.length}
  <div class="empty-state"><div class="big">{@html emptyIcon}</div>这个文件夹是空的</div>
{:else}
  <div class="list">
    <div class="row list-head"><div></div><div>名称</div><div>修改时间</div><div></div></div>
    {#each entries as entry, index (entry.path)}
      {@const change = changeFor(entry)}
      <div
        class="row"
        class:is-dir={entry.isDir} class:is-file={!entry.isDir} class:hidden-file={entry.hidden}
        class:selected={selected === entry.path} class:cursor={cursor === index} class:changed={!!change}
        data-idx={index} data-path={entry.path} data-changed={changeText(change)}
        style:--heat={heat(change)} title={changeTitle(change)} role="button" tabindex="-1" draggable="true"
        onclick={(event) => activate(event, entry, index)} onkeydown={(event) => activate(event, entry, index)}
        ondblclick={(event) => actions.open(event, entry)} oncontextmenu={(event) => actions.menu(event, entry, index)}
        ondragstart={(event) => actions.drag(event, entry)}
      >
        <div class="icon">
          {#if entry.kind === 'image' || entry.kind === 'video'}
            <img class="thumb-sm" loading="lazy" decoding="async" src={`/api/thumb?path=${encodeURIComponent(entry.path)}&w=96&v=${entry.mtime || 0}`} alt="" onerror={(event) => removeBrokenThumb(event, entry)} />
          {:else}<span class="svg-icon">{@html iconSvg(entry, 18)}</span>{/if}
        </div>
        <div class="fname">{entry.name}{#if sizeText(entry)}{' · '}{sizeText(entry)}{/if}{#if project(entry)}<span class={`proj-tag proj-${entry.project}`}>{project(entry)}</span>{/if}</div>
        <div class="meta">{formatTime(entry.mtime)}</div>
        <span class:on={isFavorite(entry.path)} class="fav-btn" title="收藏" role="button" tabindex="0" onclick={(event) => { event.stopPropagation(); actions.favorite(entry); }} onkeydown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); actions.favorite(entry); } }}>{@html favoriteIcon(isFavorite(entry.path))}</span>
      </div>
    {/each}
  </div>
{/if}
