/**
 * [INPUT]: 依赖 Svelte mount/flushSync、FileList.svelte 与文件图标/格式化能力
 * [OUTPUT]: 对外提供 createFileListService，暴露 render/setSelection/setCursor
 * [POS]: src-ui 的主文件列表适配层，连接文件浏览控制器与唯一的列表视图
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { flushSync, mount } from 'svelte';
import FileList from './FileList.svelte';

export function createFileListService({ target, iconSvg, formatTime, favoriteIcon, emptyIcon }) {
  const host = mount(FileList, { target, props: { iconSvg, formatTime, favoriteIcon, emptyIcon } });
  return {
    render(model, actions) { flushSync(() => host.render(model, actions)); },
    setSelection(path) { flushSync(() => host.setSelection(path)); },
    setCursor(index) { flushSync(() => host.setCursor(index)); },
  };
}
