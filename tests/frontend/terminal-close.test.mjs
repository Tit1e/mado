/**
 * [INPUT]: 依赖 happy-dom 测试环境与 public/modules/terminal.js 终端控制器
 * [OUTPUT]: 验证桌面快捷键新建终端、新建无参数 Codex 会话、重启当前命令、关闭活动终端及隐藏服务相邻标签行为
 * [POS]: tests/frontend 的终端快捷键与关闭回归测试，保证 Cmd/Ctrl+T、Shift+N、Shift+R、W 复用终端控制器并保护运行中任务
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { installDom, loadRendererModule } from './dom-environment.mjs';

const { createTerminalController } = await loadRendererModule('terminal');
const { createTerminalShortcutActions } = await loadRendererModule('terminal-shortcuts');

function createController({ confirm = async () => true, foreground = async () => ({ ok: true, running: false }), restart = async () => ({ ok: true }), query = () => null } = {}) {
  const killed = [];
  const restarted = [];
  const toasts = [];
  window.codexboxPty = {
    kill: (id) => killed.push(id),
    hasForegroundProcess: foreground,
    restartCommand: (id) => { restarted.push(id); return restart(id); },
  };
  const noop = () => {};
  const deps = new Proxy({
    $: query,
    state: {},
    follow: {},
    confirmDialog: confirm,
    createTerminalShortcutActions,
    toast: (...args) => toasts.push(args),
    updateWatches: noop,
  }, {
    get(target, key) { return key in target ? target[key] : noop; },
  });
  return { term: createTerminalController(deps), killed, restarted, toasts };
}

function session(id, status = 'idle') {
  return {
    id,
    status,
    xterm: { dispose() {} },
    host: { remove() {} },
  };
}

test('关闭空闲活动终端时直接复用标签关闭逻辑', async () => {
  const dom = installDom();
  try {
    const { term, killed } = createController();
    term.sessions = [session('t1'), session('t2')];
    term.active = 't2';
    term.activate = (id) => { term.active = id; };

    assert.equal(await term.closeActive(), true);
    assert.deepEqual(killed, ['t2']);
    assert.deepEqual(term.sessions.map((item) => item.id), ['t1']);
    assert.equal(term.active, 't1');
  } finally { dom.cleanup(); }
});

test('存在真实前台进程时要求确认，取消后保留任务', async () => {
  const dom = installDom();
  try {
    let prompted = 0;
    const { term, killed } = createController({
      confirm: async () => { prompted++; return false; },
      foreground: async () => ({ ok: true, running: true }),
    });
    term.sessions = [session('t1')];
    term.active = 't1';

    assert.equal(await term.closeActive(), false);
    assert.equal(prompted, 1);
    assert.deepEqual(killed, []);
    assert.equal(term.sessions.length, 1);
  } finally { dom.cleanup(); }
});

test('前台进程确认期间忽略重复关闭请求', async () => {
  const dom = installDom();
  try {
    let prompted = 0;
    let resolveConfirm;
    const pendingConfirm = new Promise((resolve) => { resolveConfirm = resolve; });
    const { term } = createController({
      confirm: () => { prompted++; return pendingConfirm; },
      foreground: async () => ({ ok: true, running: true }),
    });
    term.sessions = [session('t1')];
    term.active = 't1';

    const first = term.closeActive();
    assert.equal(await term.closeActive(), false);
    assert.equal(prompted, 1);
    resolveConfirm(false);
    assert.equal(await first, false);
  } finally { dom.cleanup(); }
});

test('界面状态仍为 busy 但 Shell 没有前台任务时直接关闭', async () => {
  const dom = installDom();
  try {
    let prompted = 0;
    const { term, killed } = createController({ confirm: async () => { prompted++; return true; } });
    term.sessions = [session('t1', 'busy'), session('t2')];
    term.active = 't1';
    term.activate = (id) => { term.active = id; };

    assert.equal(await term.closeActive(), true);
    assert.equal(prompted, 0);
    assert.deepEqual(killed, ['t1']);
  } finally { dom.cleanup(); }
});

test('桌面新建、启动 Codex、新建 Codex 会话、重启与关闭事件各绑定一次', () => {
  const dom = installDom();
  try {
    let subscribed = 0;
    let newHandler;
    let codexHandler;
    let newCodexHandler;
    let restartHandler;
    let closeHandler;
    window.codexboxWin = {
      onNewTerminal(cb) { subscribed++; newHandler = cb; return () => {}; },
      onLaunchCodex(cb) { subscribed++; codexHandler = cb; return () => {}; },
      onLaunchNewCodex(cb) { subscribed++; newCodexHandler = cb; return () => {}; },
      onRestartActiveCommand(cb) { subscribed++; restartHandler = cb; return () => {}; },
      onCloseActiveTerminal(cb) { subscribed++; closeHandler = cb; return () => {}; },
    };
    const { term } = createController();
    let created = 0;
    const launches = [];
    let closed = 0;
    let restarted = 0;
    term.newTerminal = () => { created++; };
    term.launchCodex = (options) => { launches.push(options); };
    term.closeActive = () => { closed++; };
    term.restartActive = () => { restarted++; };

    term.bindDesktopEvents();
    term.bindDesktopEvents();
    newHandler();
    codexHandler();
    newCodexHandler();
    restartHandler();
    closeHandler();

    assert.equal(subscribed, 5);
    assert.equal(created, 1);
    assert.deepEqual(launches, [undefined, { resume: false }]);
    assert.equal(closed, 1);
    assert.equal(restarted, 1);
  } finally { dom.cleanup(); }
});

test('重新运行只作用于当前活动终端并反馈成功', async () => {
  const dom = installDom();
  try {
    const { term, restarted, toasts } = createController();
    term.sessions = [session('t1'), session('t2')];
    term.active = 't2';

    assert.equal(await term.restartActive(), true);
    assert.deepEqual(restarted, ['t2']);
    assert.deepEqual(toasts, [['已重新运行当前命令', false]]);
  } finally { dom.cleanup(); }
});

test('重新运行期间忽略当前标签的重复请求', async () => {
  const dom = installDom();
  try {
    let resolveRestart;
    const pending = new Promise((resolve) => { resolveRestart = resolve; });
    const { term, restarted, toasts } = createController({ restart: () => pending });
    term.sessions = [session('t1')];
    term.active = 't1';

    const first = term.restartActive();
    assert.equal(await term.restartActive(), false);
    assert.deepEqual(restarted, ['t1']);
    assert.deepEqual(toasts, [['当前命令正在重新运行']]);
    resolveRestart({ ok: true });
    assert.equal(await first, true);
  } finally { dom.cleanup(); }
});

test('没有活动终端时不会调用 PTY 重启', async () => {
  const dom = installDom();
  try {
    const { term, restarted, toasts } = createController();
    assert.equal(await term.restartActive(), false);
    assert.deepEqual(restarted, []);
    assert.deepEqual(toasts, [['当前没有可重新运行的终端', true]]);
  } finally { dom.cleanup(); }
});

test('新建 Codex 会话快捷键只执行不带参数的 codex', async () => {
  const dom = installDom();
  try {
    const { term } = createController();
    const writes = [];
    let focused = 0;
    term.available = () => true;
    term.openInDir = async () => ({ id: 'fresh', dead: false, xterm: { focus: () => { focused++; } } });
    term.input = (id, data) => writes.push([id, data]);

    await term.launchCodex({ resume: false });

    assert.deepEqual(writes, [['fresh', 'codex\r']]);
    assert.equal(focused, 1);
  } finally { dom.cleanup(); }
});

test('项目运行命令按规则目录创建隐藏服务会话，并以规则 ID 隔离同目录后续命令', async () => {
  const dom = installDom();
  try {
    const { term } = createController();
    const created = [];
    const writes = [];
    term.available = () => true;
    term.newTab = async (cwd, options) => {
      created.push([cwd, options]);
      const session = {
        id: 'service_1', dead: false, kind: 'service', projectRoot: cwd,
        projectRuleId: options.projectRuleId, projectCommand: options.projectCommand,
      };
      term.sessions.push(session);
      return session;
    };
    term.input = (id, value) => writes.push([id, value]);

    const rule = { id: 'rule_child_01', cwd: '/repo/apps/web', command: 'pnpm dev' };
    assert.deepEqual(await term.startProjectRun(rule), { ok: true, id: 'service_1', running: true });
    assert.equal(created[0][0], '/repo/apps/web');
    assert.equal(created[0][1].kind, 'service');
    assert.equal(created[0][1].projectRoot, '/repo/apps/web');
    assert.equal(created[0][1].projectCommand, 'pnpm dev');
    assert.equal(created[0][1].projectRuleId, 'rule_child_01');
    assert.deepEqual(writes, [['service_1', 'pnpm dev\r']]);
    assert.equal(term.serviceSession({ ...rule, id: 'rule_other_01' }), undefined);
    assert.equal(term.serviceSession(rule).id, 'service_1');
  } finally { dom.cleanup(); }
});

test('隐藏的项目服务不占终端标签，查看输出后才显示', () => {
  const dom = installDom('<div id="term-tabs"></div>');
  try {
    const { term } = createController({ query: (selector) => document.querySelector(selector) });
    term.sessions = [{ ...session('service_1'), kind: 'service', revealed: false, title: 'web', cwd: '/repo' }];

    term.renderTabs();
    assert.equal(document.querySelectorAll('.term-tab').length, 0);

    term.sessions[0].revealed = true;
    term.renderTabs();
    assert.equal(document.querySelectorAll('.term-tab').length, 1);
  } finally { dom.cleanup(); }
});

test('关闭隐藏服务旁边的活动终端后立即移除标签并切换到可见终端', () => {
  const dom = installDom('<div id="term-tabs"></div>');
  try {
    const { term } = createController({ query: (selector) => document.querySelector(selector) });
    const hiddenService = {
      ...session('service_1'), kind: 'service', revealed: false, title: 'web', cwd: '/repo', host: document.createElement('div'),
    };
    const first = { ...session('t1'), title: 'repo', cwd: '/repo', host: document.createElement('div') };
    const second = { ...session('t2'), title: 'repo', cwd: '/repo', host: document.createElement('div') };
    first.xterm.focus = () => {};
    second.xterm.focus = () => {};
    term.sessions = [hiddenService, first, second];
    term.active = 't1';
    term.refreshCwd = () => {};

    term.renderTabs();
    assert.equal(document.querySelectorAll('.term-tab').length, 2);

    term.closeTab('t1');

    assert.deepEqual(term.sessions.map((item) => item.id), ['service_1', 't2']);
    assert.equal(term.active, 't2');
    assert.equal(document.querySelectorAll('.term-tab').length, 1);
    assert.equal(document.querySelector('.term-tab').classList.contains('active'), true);
  } finally { dom.cleanup(); }
});

test('新建终端快捷键会先展开已收起的终端面板', () => {
  const dom = installDom();
  try {
    const panel = { classList: { contains: (name) => name === 'hidden' } };
    const { term } = createController({ query: (selector) => selector === '#terminal-panel' ? panel : null });
    term.sessions = [session('t1')];
    term.available = () => true;
    let opened = 0;
    let created = 0;
    term.open = () => { opened++; };
    term.newTab = () => { created++; };

    term.newTerminal();

    assert.equal(opened, 1);
    assert.equal(created, 1);
  } finally { dom.cleanup(); }
});
