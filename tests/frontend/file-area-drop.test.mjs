/**
 * [INPUT]: 依赖 happy-dom 与 public/modules/ui-controller.js 的文件区事件编排
 * [OUTPUT]: 验证项目添加按钮绑定、目录行拖放路径和列表键盘单行导航
 * [POS]: tests/frontend 的文件区列表交互回归测试，保护列表成为唯一视图后的拖放与键盘行为
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { installDom, loadRendererModule } from './dom-environment.mjs';

const { createUiController } = await loadRendererModule('ui-controller');
const noop = () => {};

function elementShell() {
  return `
    <header id="topbar"></header>
    <button id="preview-close"></button><button id="cmdk-trigger"></button><button id="btn-guide"></button><button id="project-add"></button>
    <button id="btn-terminal"></button><button id="term-codex"></button><button id="term-settings"></button>
    <button id="term-newtab"></button><button id="term-max"></button><button id="term-dock"></button>
    <button id="btn-sidebar"></button><button id="file-follow"></button>
    <div id="main-body"><div id="terminal-resizer"></div><div id="terminal-panel"></div></div>
    <div class="term-head"></div><div id="term-tabs"></div><div id="xterm-host"></div>
    <div id="content"><div id="file-area"><div class="list">
      <div class="row list-head"></div>
      <div class="row is-dir" data-idx="0"><span class="row-target">folder</span></div>
      <div class="row is-file" data-idx="1">file</div>
    </div></div></div>
    <button id="scope-toggle"></button><input id="toggle-hidden" type="checkbox">
    <input id="cmdk-input"><div id="cmdk" class="hidden"></div><section id="preview" class="hidden"></section>
  `;
}

function dataTransfer(files = []) {
  return { types: ['Files'], files, dropEffect: 'none', getData: () => '' };
}

function dispatchTransfer(window, target, type, transfer) {
  const event = new window.Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: transfer });
  target.dispatchEvent(event);
}

test('项目添加按钮已绑定，列表目录行接收拖放且键盘每次只移动一行', async () => {
  const dom = installDom(elementShell());
  try {
    const drops = [], moves = [], adds = [];
    const state = {
      cwd: '/root', showHidden: false, muted: false,
      visible: [{ path: '/root/folder', isDir: true }, { path: '/root/file.txt', isDir: false }],
    };
    const term = new Proxy({ sessions: [], dock: 'bottom', active: null }, {
      get(target, key) { return key in target ? target[key] : noop; },
    });
    const deps = new Proxy({
      $: (selector) => document.querySelector(selector), state, term,
      cmdk: new Proxy({ active: 0 }, { get(target, key) { return key in target ? target[key] : noop; } }),
      follow: { on: false }, runtime: { imgEditState: null }, mona: {},
      shotTray: { init: noop }, SVG: { box: '' }, svgWrap: () => '',
      moveCursor: (amount) => moves.push(amount), addProject: () => adds.push('add'),
      dropFilesInto: async (files, dir) => drops.push([files.map((file) => file.name), dir]),
    }, { get(target, key) { return key in target ? target[key] : noop; } });

    createUiController(deps).bindEvents();
    document.querySelector('#project-add').click();
    assert.deepEqual(adds, ['add']);
    const file = { name: 'note.txt' };
    const rowTarget = document.querySelector('.row-target');
    dispatchTransfer(dom.window, rowTarget, 'dragover', dataTransfer([file]));
    assert.equal(document.querySelector('.row.is-dir').classList.contains('drop-into'), true);
    assert.equal(document.querySelector('#file-area').classList.contains('area-drop'), false);

    dispatchTransfer(dom.window, rowTarget, 'drop', dataTransfer([file]));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(drops[0], [['note.txt'], '/root/folder']);

    dispatchTransfer(dom.window, document.querySelector('#file-area'), 'drop', dataTransfer([file]));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(drops[1], [['note.txt'], '/root']);

    document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    assert.deepEqual(moves, [1, -1]);
  } finally { dom.cleanup(); }
});
