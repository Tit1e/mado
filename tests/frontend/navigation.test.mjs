/**
 * [INPUT]: 依赖 happy-dom、共享名称排序、文件浏览控制器与命令面板控制器
 * [OUTPUT]: 验证目录排序过滤、文件选择、编辑器快捷打开和预览导航
 * [POS]: tests/frontend 的核心导航行为回归测试
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { installDom, loadRendererModule } from './dom-environment.mjs';

const { createCommandPalette } = await loadRendererModule('command-palette');
const { createFileBrowserController } = await loadRendererModule('file-browser');
const { compareNames } = await loadRendererModule('name-sort');

const noop = () => {};

function browserDeps(state) {
  return new Proxy({
    state,
    follow: { on: false },
    term: { sessions: [] },
    $: (selector) => document.querySelector(selector),
    guardDirty: async () => true,
    compareNames,
  }, {
    get(target, key) { return key in target ? target[key] : noop; },
  });
}

test('文件列表隐藏隐藏项、目录优先并按数字名称排序', () => {
  const state = {
    entries: [
      { name: 'file10.txt', isDir: false },
      { name: '.secret', isDir: false, hidden: true },
      { name: 'folder2', isDir: true },
      { name: 'file2.txt', isDir: false },
      { name: 'folder10', isDir: true },
    ],
    showHidden: false,
    sort: 'name',
  };
  const controller = createFileBrowserController(browserDeps(state));
  assert.deepEqual(controller.visibleEntries().map((entry) => entry.name), [
    'folder2', 'folder10', 'file2.txt', 'file10.txt',
  ]);
});

test('命令面板选择文件后记录最近项、导航到父目录并打开预览', async () => {
  const dom = installDom('<div id="cmdk"></div>');
  try {
    const calls = [];
    const state = {
      home: '/home/test',
      cwd: '/home/test',
      entries: [{ name: 'note.md', path: '/home/test/docs/note.md', isDir: false }],
    };
    const cmdk = createCommandPalette({
      $: (selector) => document.querySelector(selector),
      api: async () => ({}),
      state,
      tilde: (path) => path,
      iconSvg: () => '',
      escapeHtml: (value) => String(value),
      openWith: (...args) => calls.push(['openWith', ...args]),
      navigate: async (path) => calls.push(['navigate', path]),
      recordRecent: (path) => calls.push(['recent', path]),
      dirOf: (path) => path.slice(0, path.lastIndexOf('/')),
      openPreview: (entry) => calls.push(['preview', entry.path]),
      renderFiles: () => calls.push(['render']),
    });
    cmdk.results = [state.entries[0]];
    cmdk.choose(0, false);
    await Promise.resolve();
    assert.deepEqual(calls, [
      ['recent', '/home/test/docs/note.md'],
      ['navigate', '/home/test/docs'],
      ['preview', '/home/test/docs/note.md'],
      ['render'],
    ]);
    assert.equal(state.selected, '/home/test/docs/note.md');
  } finally {
    dom.cleanup();
  }
});

test('命令面板的编辑器快捷操作不触发目录导航', () => {
  const dom = installDom('<div id="cmdk"></div>');
  try {
    const calls = [];
    const cmdk = createCommandPalette({
      $: (selector) => document.querySelector(selector),
      api: async () => ({}),
      state: { home: '/home/test', cwd: '/home/test', entries: [] },
      tilde: (path) => path,
      iconSvg: () => '',
      escapeHtml: (value) => String(value),
      openWith: (...args) => calls.push(args),
      navigate: () => assert.fail('不应导航'),
      recordRecent: noop,
      dirOf: noop,
      openPreview: noop,
      renderFiles: noop,
    });
    cmdk.results = [{ path: '/home/test/project', isDir: true }];
    cmdk.choose(0, true);
    assert.deepEqual(calls, [['/home/test/project', 'editor']]);
  } finally {
    dom.cleanup();
  }
});
