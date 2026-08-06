/**
 * [INPUT]: 依赖 happy-dom、public/generated/ui.mjs、图标工厂与基础主题样式
 * [OUTPUT]: 验证唯一列表视图、选择游标、媒体缩略图回退、索引主题对比度、收藏和文件动作转发
 * [POS]: tests/frontend 的 Svelte FileList 回归测试，保护主工作区文件列表交互
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { installDom } from './dom-environment.mjs';
import { loadRendererModule } from './dom-environment.mjs';

const { createFileBrowserController } = await loadRendererModule('file-browser');
const { createIcons } = await loadRendererModule('icons');

function createListService(target, suffix) {
  return import(new URL(`../../public/generated/ui.mjs?${suffix}=${Date.now()}`, import.meta.url)).then(({ createFileListService }) => createFileListService({
    target,
    iconSvg: (entry, size) => `<svg data-name="${entry.name}" data-size="${size}"></svg>`,
    formatTime: () => '刚刚',
    favoriteIcon: (on) => `<svg data-favorite="${on}"></svg>`, emptyIcon: '<svg data-empty></svg>',
  }));
}

test('索引主题的选中文件夹图标使用反色保持可见', async () => {
  const dom = installDom();
  try {
    const folderIcon = createIcons({ theme: 'editorial' }).iconSvg({
      name: 'build', isDir: true, kind: 'dir',
    }, 18);
    const css = await readFile(new URL('../../public/styles/base.css', import.meta.url), 'utf8');

    assert.match(folderIcon, /class="rich-glyph"[^>]*fill="none">[\s\S]*fill="currentColor"/);
    assert.match(css, /\[data-theme="editorial"\] \.list \.row\.selected \.icon \{ color: var\(--bg\); \}/);
    assert.doesNotMatch(css, /\.grid \.item/);
  } finally {
    dom.cleanup();
  }
});

test('文件列表始终渲染列表并转发选择、收藏和菜单动作', async () => {
  const dom = installDom('<div id="file-area"></div>');
  try {
    const calls = [];
    const service = await createListService(document.querySelector('#file-area'), 'files');
    const entries = [
      { name: 'src', path: '/repo/src', isDir: true, kind: 'dir', project: 'node' },
      { name: 'note.md', path: '/repo/note.md', isDir: false, kind: 'text', size: 12, mtime: 1 },
      { name: 'photo.png', path: '/repo/photo.png', isDir: false, kind: 'image', size: 20, mtime: 2 },
    ];
    const actions = {
      click: (entry, index) => calls.push(['click', entry.path, index]),
      open: (_event, entry) => calls.push(['open', entry.path]),
      menu: (_event, entry, index) => calls.push(['menu', entry.path, index]),
      favorite: (entry) => calls.push(['favorite', entry.path]), drag: () => {},
    };
    service.render({
      entries, selected: '/repo/note.md', cursor: 1,
      favorites: ['/repo/note.md'], changed: new Map([['note.md', { count: 2, files: new Set(['note.md']) }]]),
    }, actions);

    assert.equal(document.querySelectorAll('.list .row[data-idx]').length, 3);
    assert.equal(document.querySelector('.grid'), null);
    assert.equal(document.querySelector('[data-path="/repo/src"] .proj-tag').textContent, 'node');
    // 文件名后不再显示大小，目录不显示大小
    assert.equal(document.querySelector('[data-path="/repo/note.md"] .fname').textContent, 'note.md');
    assert.equal(document.querySelector('[data-path="/repo/photo.png"] .fname').textContent, 'photo.png');
    assert.equal(document.querySelector('[data-path="/repo/src"] .fname').textContent, 'srcnode');
    assert.equal(document.querySelectorAll('.list .row[data-idx] .meta').length, 3); // 只剩修改时间一列 meta
    const workspaceCss = await readFile(new URL('../../public/styles/workspace.css', import.meta.url), 'utf8');
    assert.doesNotMatch(workspaceCss, /\.fname-size/); // 大小样式已移除
    const note = document.querySelector('[data-path="/repo/note.md"]');
    assert.equal(note.classList.contains('selected'), true);
    assert.equal(note.classList.contains('cursor'), true);
    assert.equal(note.dataset.changed, '改·2');
    assert.equal(note.querySelector('.fav-btn').classList.contains('on'), true);
    note.click();
    note.querySelector('.fav-btn').click();
    note.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    assert.deepEqual(calls, [
      ['click', '/repo/note.md', 1], ['favorite', '/repo/note.md'], ['menu', '/repo/note.md', 1],
    ]);

    const photo = document.querySelector('[data-path="/repo/photo.png"] .thumb-sm');
    assert.match(photo.src, /\/api\/thumb\?.*w=96/);
    photo.dispatchEvent(new window.Event('error'));
    assert.equal(document.querySelector('[data-path="/repo/photo.png"] svg').dataset.size, '18');

    service.setSelection('/repo/src'); service.setCursor(0);
    assert.equal(document.querySelector('[data-path="/repo/src"]').classList.contains('selected'), true);
    assert.equal(document.querySelector('[data-path="/repo/src"]').classList.contains('cursor'), true);
  } finally { dom.cleanup(); }
});

test('文件列表支持空目录状态和同一组件内导航重渲染', async () => {
  const dom = installDom('<nav id="breadcrumb"></nav><div id="file-area"></div><div id="statusbar"></div>');
  try {
    const toasts = [];
    const service = await createListService(document.querySelector('#file-area'), 'navigation');
    const actions = { click() {}, open() {}, menu() {}, favorite() {}, drag() {} };
    service.render({ entries: [], selected: '', cursor: -1, favorites: [], changed: null }, actions);
    assert.match(document.querySelector('.empty-state').textContent, /这个文件夹是空的/);

    const state = {
      cwd: '/root', history: [], entries: [{ name: 'child', path: '/root/child', isDir: true, kind: 'dir' }],
      favorites: [], visible: [], breadcrumb: [], showHidden: false, sort: 'name', cursor: -1,
    };
    const noop = () => {};
    const controller = createFileBrowserController(new Proxy({
      $: (selector) => document.querySelector(selector), state, fileList: service,
      follow: { on: false, navving: false }, term: { sessions: [] }, guardDirty: async () => true,
      api: async () => ({ path: '/root/child', entries: [], project: null, breadcrumb: [{ name: '/', path: '/' }, { name: 'child', path: '/root/child' }], parent: '/root' }),
      toast: (...args) => toasts.push(args), restoreFileAreaIfHidden: noop, renderRootsActive: noop,
      ic: () => '<svg data-root></svg>',
    }, { get(target, key) { return key in target ? target[key] : noop; } }));
    controller.renderFiles();
    document.querySelector('[data-path="/root/child"]').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(state.cwd, '/root/child');
    assert.equal(document.querySelector('.empty-state')?.textContent, '这个文件夹是空的');
    assert.equal(toasts.some(([message]) => message === '打开失败'), false);
  } finally { dom.cleanup(); }
});
