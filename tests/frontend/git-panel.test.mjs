/**
 * [INPUT]: 依赖 happy-dom 与 public/generated/ui.mjs Svelte 构建产物
 * [OUTPUT]: 验证常驻分支名、按需变更汇总、尾随刷新、静默轮询并发保护、跨目录竞态、非仓库提示和 Diff 跳转
 * [POS]: tests/frontend 的 Git 状态栏与弹层交互回归测试
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { installDom } from './dom-environment.mjs';
const previewCss = await readFile(new URL('../../public/styles/preview.css', import.meta.url), 'utf8');

async function setup(api, calls = []) {
  const moduleUrl = new URL(`../../public/generated/ui.mjs?test=${Date.now()}-${Math.random()}`, import.meta.url);
  const { createGitPanel } = await import(moduleUrl);
  return createGitPanel({
    $: (selector) => document.querySelector(selector),
    api,
    ic: () => '',
    kindFromName: () => 'text',
    showDiff: (entry) => calls.push(entry),
    toast: (message) => calls.push(message),
  });
}

async function clickAndSettle(element) {
  element.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

test('Git 状态栏展示分支与汇总并从文件列表打开 Diff', async () => {
  const dom = installDom(`<style>${previewCss}</style><div id="git-status-slot"></div>`);
  try {
    const calls = [];
    const panel = await setup(async () => ({
      available: true,
      isRepo: true,
      root: '/repo',
      branch: 'main',
      detached: false,
      summary: { files: 2, additions: 12, deletions: 3, binary: 0 },
      files: [
        { code: ' M', path: '/repo/a.js', relativePath: 'a.js', name: 'a.js', additions: 10, deletions: 3, binary: false, deleted: false },
        { code: '??', path: '/repo/新 文件.js', relativePath: '新 文件.js', name: '新 文件.js', additions: 2, deletions: 0, binary: false, deleted: false },
      ],
    }), calls);
    await panel.load('/repo');
    assert.match(document.querySelector('#git-summary').textContent, /main · 2 个文件 \+12 −3/);
    assert.equal(document.querySelector('#git-summary b').textContent, '+12');
    assert.equal(document.querySelector('#git-summary i').textContent, '−3');
    await clickAndSettle(document.querySelector('#git-summary'));
    assert.equal(document.querySelectorAll('.git-file').length, 2);
    assert.equal(document.querySelector('#git-popover').parentElement, document.body);
    assert.equal(getComputedStyle(document.querySelector('#git-popover')).display, 'flex');
    await clickAndSettle(document.querySelector('#git-summary'));
    assert.equal(getComputedStyle(document.querySelector('#git-popover')).display, 'none');
    await clickAndSettle(document.querySelector('#git-summary'));
    await clickAndSettle(document.body);
    assert.equal(getComputedStyle(document.querySelector('#git-popover')).display, 'none');
    await clickAndSettle(document.querySelector('#git-summary'));
    await clickAndSettle(document.querySelector('.git-file'));
    assert.equal(calls[0].path, '/repo/a.js');
    assert.equal(document.querySelector('#git-popover').classList.contains('hidden'), true);
    assert.equal(getComputedStyle(document.querySelector('#git-popover')).display, 'none');
  } finally {
    dom.cleanup();
  }
});

test('普通目录明确显示不是 Git 仓库', async () => {
  const dom = installDom(`<style>${previewCss}</style><div id="git-status-slot"></div>`);
  try {
    const panel = await setup(async () => ({ available: true, isRepo: false }));
    await panel.load('/tmp');
    assert.equal(document.querySelector('#git-status-slot').textContent, '当前目录不是 Git 仓库');
    assert.equal(document.querySelector('#git-summary'), null);
  } finally {
    dom.cleanup();
  }
});

test('干净仓库始终显示分支但隐藏零值变更汇总', async () => {
  const dom = installDom(`<style>${previewCss}</style><div id="git-status-slot"></div>`);
  try {
    const panel = await setup(async () => ({
      available: true,
      isRepo: true,
      branch: 'master',
      detached: false,
      summary: { files: 0, additions: 0, deletions: 0, binary: 0 },
      files: [],
    }));
    await panel.load('/repo');
    assert.equal(document.querySelector('.git-branch-name').textContent, 'master');
    assert.equal(document.querySelector('.git-file-count'), null);
    assert.equal(document.querySelector('#git-summary b'), null);
    assert.equal(document.querySelector('#git-summary i'), null);
  } finally {
    dom.cleanup();
  }
});

test('同目录静默轮询未完成时不会发起重叠或尾随请求', async () => {
  const dom = installDom('<div id="git-status-slot"></div>');
  try {
    let calls = 0;
    let resolveRequest;
    const pending = new Promise((resolve) => { resolveRequest = resolve; });
    const panel = await setup(() => { calls++; return pending; });
    const first = panel.refresh('/repo');
    const second = panel.refresh('/repo');
    assert.equal(calls, 1);
    resolveRequest({ available: true, isRepo: false });
    await Promise.all([first, second]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(calls, 1);
  } finally {
    dom.cleanup();
  }
});

test('请求期间的同目录加载会合并为一次尾随刷新', async () => {
  const dom = installDom('<div id="git-status-slot"></div>');
  try {
    const requests = [];
    const panel = await setup(() => new Promise((resolve) => requests.push(resolve)));
    const first = panel.refresh('/repo');
    const queued = [panel.load('/repo'), panel.load('/repo'), panel.load('/repo')];
    assert.equal(requests.length, 1);

    requests[0]({
      available: true,
      isRepo: true,
      branch: 'stale',
      detached: false,
      summary: { files: 0, additions: 0, deletions: 0, binary: 0 },
      files: [],
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(requests.length, 2);

    requests[1]({
      available: true,
      isRepo: true,
      branch: 'fresh',
      detached: false,
      summary: { files: 1, additions: 2, deletions: 0, binary: 0 },
      files: [],
    });
    await Promise.all([first, ...queued]);
    assert.equal(requests.length, 2);
    assert.match(document.querySelector('#git-summary').textContent, /fresh · 1 个文件 \+2/);
  } finally {
    dom.cleanup();
  }
});

test('同目录重新加载保留已有状态直到新结果返回', async () => {
  const dom = installDom('<div id="git-status-slot"></div>');
  try {
    let resolveReload;
    let calls = 0;
    const panel = await setup(() => {
      calls++;
      if (calls === 1) return Promise.resolve({
        available: true,
        isRepo: true,
        branch: 'main',
        detached: false,
        summary: { files: 1, additions: 1, deletions: 0, binary: 0 },
        files: [],
      });
      return new Promise((resolve) => { resolveReload = resolve; });
    });
    await panel.load('/repo');
    const reload = panel.load('/repo');
    assert.match(document.querySelector('#git-summary').textContent, /main · 1 个文件 \+1/);
    resolveReload({
      available: true,
      isRepo: true,
      branch: 'main',
      detached: false,
      summary: { files: 2, additions: 3, deletions: 1, binary: 0 },
      files: [],
    });
    await reload;
    assert.match(document.querySelector('#git-summary').textContent, /main · 2 个文件 \+3 −1/);
  } finally {
    dom.cleanup();
  }
});

test('旧目录请求晚返回不会覆盖当前目录', async () => {
  const dom = installDom('<div id="git-status-slot"></div>');
  try {
    const requests = new Map();
    const panel = await setup((url) => new Promise((resolve) => requests.set(new URL(url, 'http://mado.local').searchParams.get('path'), resolve)));
    const oldLoad = panel.load('/repo-a');
    const currentLoad = panel.load('/repo-b');
    requests.get('/repo-b')({
      available: true,
      isRepo: true,
      branch: 'repo-b',
      detached: false,
      summary: { files: 1, additions: 1, deletions: 0, binary: 0 },
      files: [],
    });
    await currentLoad;
    requests.get('/repo-a')({
      available: true,
      isRepo: true,
      branch: 'repo-a',
      detached: false,
      summary: { files: 4, additions: 4, deletions: 0, binary: 0 },
      files: [],
    });
    await oldLoad;
    assert.match(document.querySelector('#git-summary').textContent, /repo-b · 1 个文件/);
  } finally {
    dom.cleanup();
  }
});
