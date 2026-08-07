/**
 * [INPUT]: 依赖 happy-dom 与侧边栏控制器
 * [OUTPUT]: 验证手动项目读取、目录选择与右键路径添加、重复/并发保护、浏览器降级和仅配置移除调用链
 * [POS]: tests/frontend 的用户项目侧边栏业务测试
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { installDom, loadRendererModule } from './dom-environment.mjs';

const { createSidebarController } = await loadRendererModule('sidebar');
const PROJECT = { name: 'Demo', path: '/workspace/demo', available: true };

function createHarness(responses = {}) {
  const calls = [];
  let menuItems = [];
  const state = { cwd: '/workspace', favorites: [], entries: [] };
  const controller = createSidebarController({
    api: async (route) => {
      calls.push(['api', route]);
      return responses.list || { ok: true, projects: [PROJECT] };
    },
    apiPost: async (route, body) => {
      calls.push(['post', route, body]);
      if (route.endsWith('/add')) return responses.add || { ok: true, added: true, projects: [PROJECT] };
      return responses.remove || { ok: true, removed: true, projects: [] };
    },
    state,
    dirOf: () => '/workspace',
    navigate: async (path) => calls.push(['navigate', path]),
    openPreview: () => {}, renderFiles: () => {},
    toast: (message, error) => calls.push(['toast', message, !!error]),
    popupMenu: (_event, items) => { menuItems = items; },
    projects: {
      render: (items, active) => calls.push(['render', items, active]),
      setActive: (path) => calls.push(['active', path]),
    },
    favorites: { render: () => {}, setActive: () => {} },
    roots: { render: () => {}, setActive: () => {} },
  });
  return { controller, calls, getMenuItems: () => menuItems };
}

test('启动时从配置项目 API 加载列表', async () => {
  const dom = installDom('');
  try {
    const harness = createHarness();
    await harness.controller.loadProjects();
    assert.deepEqual(harness.calls[0], ['api', '/api/projects']);
    assert.deepEqual(harness.calls.find((call) => call[0] === 'render'), ['render', [PROJECT], '/workspace']);
  } finally { dom.cleanup(); }
});

test('原生目录选择成功后添加项目并导航，取消时不调用 API', async () => {
  const dom = installDom('');
  try {
    const harness = createHarness();
    window.madoProjects = { chooseDirectory: async () => '/workspace/demo' };
    await harness.controller.addProject();
    assert.deepEqual(harness.calls.find((call) => call[0] === 'post'), ['post', '/api/projects/add', { path: '/workspace/demo' }]);
    assert.deepEqual(harness.calls.find((call) => call[0] === 'navigate'), ['navigate', '/workspace/demo']);

    const duplicate = createHarness({ add: { ok: true, added: false, projects: [PROJECT] } });
    window.madoProjects = { chooseDirectory: async () => '/workspace/demo' };
    await duplicate.controller.addProject();
    assert.deepEqual(duplicate.calls.find((call) => call[0] === 'toast'), ['toast', '项目已存在', false]);

    const canceled = createHarness();
    window.madoProjects = { chooseDirectory: async () => null };
    await canceled.controller.addProject();
    assert.equal(canceled.calls.some((call) => call[0] === 'post'), false);
  } finally { dom.cleanup(); }
});

test('右键路径添加立即刷新项目列表且不改变当前目录', async () => {
  const dom = installDom('');
  try {
    window.madoProjects = { chooseDirectory: async () => null };
    const harness = createHarness();
    await harness.controller.addProjectPath('/workspace/folder');
    assert.deepEqual(harness.calls.find((call) => call[0] === 'post'), ['post', '/api/projects/add', { path: '/workspace/folder' }]);
    assert.deepEqual(harness.calls.find((call) => call[0] === 'render'), ['render', [PROJECT], '/workspace']);
    assert.deepEqual(harness.calls.find((call) => call[0] === 'toast'), ['toast', '已添加到项目', false]);
    assert.equal(harness.calls.some((call) => call[0] === 'navigate'), false);

    const duplicate = createHarness({ add: { ok: true, added: false, projects: [PROJECT] } });
    await duplicate.controller.addProjectPath('/workspace/demo');
    assert.deepEqual(duplicate.calls.find((call) => call[0] === 'toast'), ['toast', '项目已存在', false]);

    const failed = createHarness({ add: { ok: false, error: '最多添加 50 个项目' } });
    await failed.controller.addProjectPath('/workspace/overflow');
    assert.deepEqual(failed.calls.find((call) => call[0] === 'toast'), ['toast', '最多添加 50 个项目', true]);
    assert.equal(failed.calls.some((call) => call[0] === 'render' || call[0] === 'navigate'), false);
  } finally { dom.cleanup(); }
});

test('快速重复添加同一路径只发送一次请求', async () => {
  const dom = installDom('');
  try {
    window.madoProjects = { chooseDirectory: async () => null };
    let resolveAdd;
    const pending = new Promise((resolve) => { resolveAdd = resolve; });
    const harness = createHarness({ add: pending });
    const first = harness.controller.addProjectPath('/workspace/demo');
    const second = harness.controller.addProjectPath('/workspace/demo');
    assert.equal(harness.calls.filter((call) => call[0] === 'post').length, 1);
    resolveAdd({ ok: true, added: true, projects: [PROJECT] });
    await Promise.all([first, second]);
  } finally { dom.cleanup(); }
});

test('浏览器模式明确提示必须使用桌面版', async () => {
  const dom = installDom('');
  try {
    const harness = createHarness();
    delete window.madoProjects;
    await harness.controller.addProject();
    await harness.controller.addProjectPath('/workspace/demo');
    assert.deepEqual(harness.calls.filter((call) => call[0] === 'toast'), [
      ['toast', '请在 Mado 桌面版添加项目', true],
      ['toast', '请在 Mado 桌面版添加项目', true],
    ]);
    assert.equal(harness.calls.some((call) => call[0] === 'post'), false);
  } finally { dom.cleanup(); }
});

test('右键移除只调用项目配置端点', async () => {
  const dom = installDom('');
  try {
    const harness = createHarness();
    harness.controller.showProjectMenu(new window.MouseEvent('contextmenu', { cancelable: true }), PROJECT);
    const items = harness.getMenuItems();
    assert.deepEqual(items.map((item) => item.label), ['移除项目']);
    await items[0].fn();
    assert.deepEqual(harness.calls.find((call) => call[0] === 'post'), ['post', '/api/projects/remove', { path: PROJECT.path }]);
    assert.equal(harness.calls.some((call) => call[0] === 'confirm'), false);
  } finally { dom.cleanup(); }
});
