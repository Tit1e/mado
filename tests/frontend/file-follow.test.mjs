/**
 * [INPUT]: 依赖 happy-dom、file-follow 与 file-browser 控制器
 * [OUTPUT]: 验证文件跟随终端绑定、停用清理和手动导航接管
 * [POS]: tests/frontend 的文件跟随状态机回归测试
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { installDom, loadRendererModule } from './dom-environment.mjs';

const { createFileFollowController } = await loadRendererModule('file-follow');
const { createFileBrowserController } = await loadRendererModule('file-browser');
const noop = () => {};

function followHarness({ active = 'term-1', sessions } = {}) {
  const calls = [];
  const follow = {
    on: false, sid: null, label: '', path: null, pendingPath: null, lastContent: null,
    swapping: false, swapDirty: false, recentChanges: [], timers: {},
  };
  const termSessions = sessions || [{ id: 'term-1', cwd: '/work/demo', startDir: '/work/demo', title: 'Demo' }];
  const term = {
    active,
    sessions: termSessions,
    available: () => true,
    refreshCwd: async () => calls.push('refreshCwd'),
    renderTabs: () => calls.push('renderTabs'),
    tailText: () => '',
  };
  const deps = new Proxy({
    $: (selector) => document.querySelector(selector),
    state: { cwd: '/work/demo', entries: [] },
    follow,
    term,
    runtime: {},
    selfOpened: new Map(),
    toast: (message, error) => calls.push(['toast', message, !!error]),
    baseOf: (path) => path.split('/').filter(Boolean).at(-1) || '',
    dirOf: (path) => path.slice(0, path.lastIndexOf('/')),
    kindFromName: () => 'text',
    isMdName: () => false,
    isNoisyChange: () => false,
  }, {
    get(target, key) { return key in target ? target[key] : noop; },
  });
  return { controller: createFileFollowController(deps), follow, calls };
}

test('开启文件跟随时绑定当前终端，关闭时清理临时状态', () => {
  const dom = installDom('<button id="file-follow"></button><div id="preview-title"><span class="live-badge"></span></div><div id="follow-narration"></div>');
  try {
    const { controller, follow, calls } = followHarness();
    controller.setFileFollow(true);
    assert.equal(follow.on, true);
    assert.equal(follow.sid, 'term-1');
    assert.equal(follow.label, 'demo');
    assert.equal(document.querySelector('#file-follow').classList.contains('on'), true);

    follow.path = '/work/demo/output.html';
    follow.pendingPath = '/work/demo/other.js';
    controller.setFileFollow(false, '手动接管，文件跟随已停');
    assert.equal(follow.on, false);
    assert.equal(follow.sid, null);
    assert.equal(follow.path, null);
    assert.equal(follow.pendingPath, null);
    assert.equal(document.querySelector('.live-badge'), null);
    assert.equal(calls.some((call) => Array.isArray(call) && /手动接管/.test(call[1])), true);
  } finally {
    dom.cleanup();
  }
});

test('没有活动终端时拒绝开启文件跟随', () => {
  const dom = installDom('<button id="file-follow"></button>');
  try {
    const { controller, follow, calls } = followHarness({ active: null });
    controller.setFileFollow(true);
    assert.equal(follow.on, false);
    assert.equal(follow.sid, null);
    assert.equal(calls.some((call) => Array.isArray(call) && call[2] === true), true);
  } finally {
    dom.cleanup();
  }
});

test('用户主动导航时停止文件跟随，跟随内部导航不停止', async () => {
  const dom = installDom('<nav id="breadcrumb"></nav><div id="file-area"></div><div id="statusbar"></div>');
  try {
    const stopCalls = [];
    const follow = { on: true, navving: false };
    const state = { cwd: '/work/old', history: [], entries: [], favorites: [], showHidden: false, sort: 'name' };
    const controller = createFileBrowserController(new Proxy({
      $: (selector) => document.querySelector(selector),
      state,
      follow,
      guardDirty: async () => true,
      api: async () => ({
        path: '/work/new', entries: [], project: null, breadcrumb: [{ name: 'new', path: '/work/new' }], parent: '/work',
      }),
      setFileFollow: (...args) => { stopCalls.push(args); follow.on = false; },
      term: { sessions: [] },
      toast: noop,
      ic: () => '',
      restoreFileAreaIfHidden: noop,
      renderRootsActive: noop,
      fileList: { render: noop, setSelection: noop, setCursor: noop },
    }, {
      get(target, key) { return key in target ? target[key] : noop; },
    }));
    await controller.navigate('/work/new');
    assert.deepEqual(stopCalls, [[false, '手动接管，文件跟随已停']]);

    follow.on = true;
    follow.navving = true;
    await controller.navigate('/work/agent', false);
    assert.equal(stopCalls.length, 1);
  } finally {
    dom.cleanup();
  }
});
