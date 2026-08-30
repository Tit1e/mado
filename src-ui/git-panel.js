/**
 * [INPUT]: 依赖 Svelte mount/unmount、GitPanel.svelte、Git HTTP API 与现有 Diff 打开能力
 * [OUTPUT]: 对外提供 createGitPanel，维持 Git 前台加载、静默轮询、同目录尾随刷新、跨目录竞态保护和文件动作边界
 * [POS]: src-ui 的 Git 面板适配器，连接现有原生控制器体系与 Svelte 界面岛
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { mount, unmount } from 'svelte';
import GitPanel from './GitPanel.svelte';

export function createGitPanel({ $, api, ic, kindFromName, showDiff, toast }) {
  let data = null;
  let dataDirectory = null;
  let loading = false;
  let requestId = 0;
  let pendingDirectory = null;
  let activePromise = null;
  let reloadQueued = false;
  let component = null;
  let mountedTarget = null;

  function ensureMounted() {
    const target = $('#git-status-slot');
    if (!target) return null;
    if (component && mountedTarget !== target) {
      unmount(component);
      component = null;
    }
    if (!component) {
      mountedTarget = target;
      component = mount(GitPanel, {
        target,
        props: {
          icon: ic('gitbranch', 'currentColor', 12),
          onFile: openFile,
        },
      });
    }
    return component;
  }

  function render() {
    ensureMounted()?.update({ data, loading });
  }

  async function openFile(file) {
    if (file.binary) { toast('二进制文件不支持内容比较'); return; }
    close();
    await showDiff({
      path: file.path,
      name: file.name,
      kind: kindFromName(file.name),
      deleted: file.deleted,
      size: 0,
      mtime: 0,
    });
  }

  function open() { ensureMounted()?.open(); }
  function close() { component?.close(); }

  async function load(directory, { queueIfBusy = true } = {}) {
    if (!directory) return;
    if (loading && pendingDirectory === directory) {
      if (queueIfBusy) reloadQueued = true;
      return activePromise;
    }

    const id = ++requestId;
    pendingDirectory = directory;
    reloadQueued = false;
    loading = true;
    if (dataDirectory !== directory) { data = null; close(); }
    render();

    activePromise = (async () => {
      try {
        while (id === requestId) {
          reloadQueued = false;
          let result;
          try {
            result = await api('/api/git?path=' + encodeURIComponent(directory));
          } catch {
            result = { available: false, isRepo: false };
          }
          if (id !== requestId) return;
          if (reloadQueued) continue;
          data = result;
          dataDirectory = directory;
          return;
        }
      } finally {
        if (id === requestId) {
          loading = false;
          pendingDirectory = null;
          activePromise = null;
          render();
        }
      }
    })();
    return activePromise;
  }

  return {
    load,
    refresh: (directory) => load(directory, { queueIfBusy: false }),
    render,
    open,
    close,
    current: () => data,
  };
}
