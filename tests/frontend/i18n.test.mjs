/**
 * [INPUT]: 依赖 happy-dom、public/i18n-dict.js 与 public/i18n.js 的浏览器全局运行时
 * [OUTPUT]: 验证界面文案双向原地切换、动态节点翻译、用户内容隔离和 Electron 菜单同步
 * [POS]: tests/frontend 的国际化回归测试，防止语言切换重新加载页面而中断终端会话
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { installDom } from './dom-environment.mjs';

const root = new URL('../../', import.meta.url);
const [dictSource, i18nSource] = await Promise.all([
  readFile(new URL('public/i18n-dict.js', root), 'utf8'),
  readFile(new URL('public/i18n.js', root), 'utf8'),
]);

function flushMutations() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function boot({ lang = 'zh', fetchImpl = async () => ({ ok: true, json: async () => ({ ok: true }) }) } = {}) {
  const dom = installDom(`
    <div id="ui-copy" title="搜索全部文件">本地运行 · 数据不出本机</div>
    <div id="terminal-shell" class="xterm">本地运行 · 数据不出本机</div>
    <a id="lang-toggle"></a>
  `);
  localStorage.setItem('mado_lang', lang);
  window.fetch = fetchImpl;
  vm.runInThisContext(dictSource);
  vm.runInThisContext(i18nSource);
  return dom;
}

test('语言切换原地重绘界面并保留终端 DOM', async () => {
  const dom = boot({ lang: 'en' });
  try {
    const terminal = document.querySelector('#terminal-shell');
    const ui = document.querySelector('#ui-copy');
    assert.equal(ui.textContent, 'Runs locally · data never leaves this Mac');
    assert.equal(ui.title, 'Search all files');
    assert.equal(terminal.textContent, '本地运行 · 数据不出本机');
    assert.equal(document.documentElement.lang, 'en');
    assert.equal(document.querySelector('#lang-toggle').hasAttribute('data-tip'), false);
    assert.equal(document.querySelector('#lang-toggle').hasAttribute('title'), false);

    await window.madoSetLang('zh');
    assert.equal(document.querySelector('#ui-copy'), ui);
    assert.equal(document.querySelector('#terminal-shell'), terminal);
    assert.equal(ui.textContent, '本地运行 · 数据不出本机');
    assert.equal(ui.title, '搜索全部文件');
    assert.equal(terminal.textContent, '本地运行 · 数据不出本机');
    assert.equal(document.documentElement.lang, 'zh');
    assert.equal(document.querySelector('#lang-toggle').hasAttribute('data-tip'), false);
    assert.equal(document.querySelector('#lang-toggle').hasAttribute('title'), false);
  } finally { dom.cleanup(); }
});

test('英文模式会翻译动态界面更新，并在切回中文时还原最新原文', async () => {
  const dom = boot({ lang: 'en' });
  try {
    const dynamic = document.createElement('div');
    dynamic.textContent = '本地运行 · 数据不出本机';
    document.body.appendChild(dynamic);
    await flushMutations();
    assert.equal(dynamic.textContent, 'Runs locally · data never leaves this Mac');

    dynamic.textContent = '搜索全部文件';
    await flushMutations();
    assert.equal(dynamic.textContent, 'Search all files');

    dynamic.title = '本地运行 · 数据不出本机';
    document.body.appendChild(dynamic);
    await flushMutations();
    assert.equal(dynamic.title, 'Runs locally · data never leaves this Mac');

    const projectRun = document.createElement('button');
    projectRun.title = '运行项目命令';
    document.body.appendChild(projectRun);
    await flushMutations();
    assert.equal(projectRun.title, 'Run project command');

    await window.madoSetLang('zh');
    assert.equal(dynamic.textContent, '搜索全部文件');
    assert.equal(dynamic.title, '本地运行 · 数据不出本机');
    assert.equal(projectRun.title, '运行项目命令');
  } finally { dom.cleanup(); }
});

test('保存语言后同步 Electron 原生菜单，且国际化层不重载页面', async () => {
  let posted;
  let refreshed = 0;
  const dom = boot({
    lang: 'zh',
    fetchImpl: async (_url, options) => {
      posted = JSON.parse(options.body);
      return { ok: true, json: async () => ({ ok: true }) };
    },
  });
  try {
    window.madoLocale = { refreshMenu: async () => { refreshed++; } };
    await window.madoSetLang('en');
    assert.deepEqual(posted, { lang: 'en' });
    assert.equal(refreshed, 1);
    assert.equal(localStorage.getItem('mado_lang'), 'en');
    assert.equal(document.querySelector('#ui-copy').textContent, 'Runs locally · data never leaves this Mac');
    assert.doesNotMatch(i18nSource, /location\.reload/);
  } finally { dom.cleanup(); }
});
