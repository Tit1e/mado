/**
 * [INPUT]: 依赖 happy-dom 与 public/modules/project-run.js
 * [OUTPUT]: 验证项目运行命令的顶栏状态、精确规则直接编辑和继承规则动作
 * [POS]: tests/frontend 的项目运行控制器回归测试，保护服务不占普通终端标签的入口状态
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { installDom, loadRendererModule } from './dom-environment.mjs';

const { createProjectRunController } = await loadRendererModule('project-run');
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup({ rule: initialRule, cwd = '/repo/src', states = [] } = {}) {
  const dom = installDom('<div id="project-run-actions"></div>');
  window.madoEnv = { isDesktopApp: true };
  let rule = initialRule;
  const calls = { api: [], apiPost: [], dialogs: [], menus: [], started: [], runningRoots: [] };
  const term = {
    available: () => true,
    projectRunStates: async () => states,
    startProjectRun: async (value) => { calls.started.push(value); return { ok: true }; },
    restartProjectRun: async () => ({ ok: true }),
    stopProjectRun: async () => ({ ok: true }),
    revealProjectRun: () => true,
  };
  const controller = createProjectRunController({
    $: (selector) => document.querySelector(selector),
    state: { cwd },
    api: async (url) => { calls.api.push(url); return { rule }; },
    apiPost: async (url, body) => {
      calls.apiPost.push([url, body]);
      if (url === '/api/run-rule/delete') rule = null;
      return { ok: true };
    },
    term,
    inputDialog: async (...args) => { calls.dialogs.push(args); return ''; },
    popupMenu: (_event, items) => calls.menus.push(items),
    toast: () => {},
    ic: (name) => `<i data-icon="${name}"></i>`,
    setRunningRoots: (roots) => calls.runningRoots.push(roots),
  });
  return { dom, controller, calls };
}

test('继承的项目命令在子目录显示运行按钮，并始终在规则目录启动', async () => {
  const rule = { id: 'rule_parent_1', cwd: '/repo', command: 'npm run dev', inherited: true };
  const { dom, controller, calls } = setup({ rule });
  try {
    controller.render();
    await settle();
    await settle();
    assert.ok(document.querySelector('.project-run-settings'));
    assert.ok(document.querySelector('.project-run-start'));
    assert.equal(document.querySelector('.project-run-start').title, '运行项目命令');

    document.querySelector('.project-run-settings').click();
    assert.deepEqual(calls.menus.at(-1).map((item) => item.label), ['编辑继承的命令', '在当前目录新建覆盖']);

    document.querySelector('.project-run-start').click();
    await settle();
    assert.deepEqual(calls.started, [rule]);
    assert.ok(document.querySelector('.project-run-status'));
    assert.ok(document.querySelector('.project-run-restart'));
    assert.ok(document.querySelector('.project-run-stop'));
    assert.equal(calls.runningRoots.at(-1).includes('/repo'), true);
  } finally { dom.cleanup(); }
});

test('精确规则的设置按钮直接打开编辑弹窗', async () => {
  const rule = { id: 'rule_exact_01', cwd: '/repo', command: 'pnpm dev', inherited: false };
  const { dom, controller, calls } = setup({ rule, cwd: '/repo' });
  try {
    controller.render();
    await settle();
    await settle();
    document.querySelector('.project-run-settings').click();
    await settle();
    assert.deepEqual(calls.dialogs, [['设置运行命令', 'pnpm dev', '例如 npm run dev']]);
    assert.equal(calls.menus.length, 0);
  } finally { dom.cleanup(); }
});
