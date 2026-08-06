/**
 * [INPUT]: 依赖 happy-dom 与 public/generated/ui.mjs 中的 Svelte 手动项目列表服务
 * [OUTPUT]: 验证项目渲染、不可用状态、活动高亮、目录展开、导航与菜单转发
 * [POS]: tests/frontend 的 Svelte ProjectsList 回归测试，保护侧边栏项目交互
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { installDom } from './dom-environment.mjs';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test('手动项目列表支持可用状态、展开、导航和菜单', async () => {
  const dom = installDom('<ul id="projects-list" class="nav-list"></ul>');
  try {
    const calls = [];
    const { createProjectsService } = await import(new URL(`../../public/generated/ui.mjs?projects=${Date.now()}`, import.meta.url));
    const service = createProjectsService({
      target: document.querySelector('#projects-list'),
      api: async (url) => {
        calls.push(['api', url]);
        return { entries: [{ name: 'src', path: '/repo/src', isDir: true, hidden: false }, { name: '.git', path: '/repo/.git', isDir: true, hidden: true }] };
      },
      navigate: (path) => calls.push(['navigate', path]),
      makeDraggable: (_node, path) => calls.push(['drag', path]),
      openMenu: (_event, project) => calls.push(['menu', project.path]),
      onUnavailable: (project) => calls.push(['unavailable', project.path]),
      folderIcon: '<svg data-folder></svg>',
    });
    service.render([
      { name: 'Repo', path: '/repo', available: true },
      { name: 'Offline', path: '/offline', available: false },
    ], '/repo');
    await settle();

    const project = document.querySelector('li[data-path="/repo"]');
    assert.equal(project.classList.contains('active'), true);
    project.querySelector('.twirl').click();
    await settle();
    assert.match(calls.find((call) => call[0] === 'api')[1], /path=%2Frepo/);
    assert.equal(document.querySelectorAll('li[data-path="/repo/src"]').length, 1);
    project.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    assert.deepEqual(calls.find((call) => call[0] === 'menu'), ['menu', '/repo']);
    project.click();
    assert.deepEqual(calls.find((call) => call[0] === 'navigate'), ['navigate', '/repo']);

    const offline = document.querySelector('li[data-path="/offline"]');
    assert.equal(offline.classList.contains('unavailable'), true);
    assert.equal(offline.getAttribute('aria-disabled'), 'true');
    offline.click();
    assert.deepEqual(calls.find((call) => call[0] === 'unavailable'), ['unavailable', '/offline']);
    assert.equal(calls.some((call) => call[0] === 'navigate' && call[1] === '/offline'), false);

    service.setActive('/repo/src');
    service.setRunningRoots(['/repo/src']);
    await settle();
    assert.equal(document.querySelector('li[data-path="/repo/src"]').classList.contains('active'), true);
    assert.ok(project.querySelector('.project-run-indicator'));
    assert.equal(document.querySelector('li[data-path="/repo/src"] .project-run-indicator'), null);
  } finally { dom.cleanup(); }
});

test('没有手动项目时显示添加指引', async () => {
  const dom = installDom('<ul id="projects-list" class="nav-list"></ul>');
  try {
    const { createProjectsService } = await import(new URL(`../../public/generated/ui.mjs?empty-projects=${Date.now()}`, import.meta.url));
    const service = createProjectsService({
      target: document.querySelector('#projects-list'), api: async () => ({}), navigate: () => {},
      makeDraggable: () => {}, openMenu: () => {}, onUnavailable: () => {}, folderIcon: '',
    });
    service.render([], '');
    await settle();
    assert.match(document.querySelector('.nav-empty').textContent, /添加项目/);
  } finally { dom.cleanup(); }
});
