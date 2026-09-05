/**
 * [INPUT]: 依赖 public/index.html、sidebar.css 与 happy-dom 的 DOM/CSS 解析能力
 * [OUTPUT]: 验证侧栏固定区域、项目区剩余高度分配与列表独立滚动的样式契约，不验证实际几何尺寸
 * [POS]: tests/frontend 的侧栏布局回归测试，与 sidebar.test.mjs 的项目业务测试互补
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Window } from 'happy-dom';

const html = await readFile(new URL('../../public/index.html', import.meta.url), 'utf8');
const css = await readFile(new URL('../../public/styles/sidebar.css', import.meta.url), 'utf8');

test('项目列表独占滚动区域，项目标题和侧栏其他区域不收缩', () => {
  const window = new Window();
  try {
    const document = window.document;
    // 只载入侧栏骨架与本地样式，不执行页面脚本或加载外部资源。
    document.body.innerHTML = html.match(/<aside id="sidebar">[\s\S]*?<\/aside>/)[0];
    const style = document.createElement('style');
    style.textContent = css;
    document.head.append(style);
    const computed = (selector) => window.getComputedStyle(document.querySelector(selector));
    assert.equal(computed('#sidebar').overflow, 'hidden');
    assert.equal(computed('#sidebar').minHeight, '0');
    const section = document.querySelector('#projects-list').parentElement;
    assert.ok(section.matches('#sidebar > .projects-section'));
    assert.equal(computed('.projects-section').display, 'flex');
    assert.equal(computed('.projects-section').flexDirection, 'column');
    assert.equal(computed('.projects-section').flex, '1 1 0px');
    assert.equal(computed('.projects-section').minHeight, '0');
    assert.equal(computed('#projects-list').flex, '1 1 0px');
    assert.equal(computed('#projects-list').minHeight, '0');
    assert.equal(computed('#projects-list').overflowY, 'auto');
    assert.equal(computed('#projects-list').overflowX, 'hidden');
    for (const selector of ['.brand', '#cmdk-trigger', '.nav-section:not(.projects-section)', '.projects-section > .nav-title', '.theme-switch', '.sidebar-foot']) {
      assert.equal(computed(selector).flexShrink, '0', selector);
    }
  } finally {
    window.happyDOM.abort();
  }
});
