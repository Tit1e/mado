/**
 * [INPUT]: 依赖 happy-dom 与 public/modules/effects.js
 * [OUTPUT]: 验证高频文件变化反馈会合并动画节点，避免同步布局和 DOM 动画堆积
 * [POS]: tests/frontend 的变化反馈性能回归测试
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { installDom, loadRendererModule } from './dom-environment.mjs';

const { createEffects } = await loadRendererModule('effects');

test('同一文件行的高频变化只保留一个进行中的涟漪', () => {
  const dom = installDom('<div id="file-area"><div class="row" data-path="/work/demo.txt"><div class="icon"></div></div></div>');
  try {
    const effects = createEffects({ cwd: '/work', sep: '/', muted: true }, (selector) => document.querySelector(selector));
    for (let count = 1; count <= 200; count++) effects.rippleFileRow('demo.txt', count);

    assert.equal(document.querySelectorAll('.edit-ripple').length, 1);
    assert.equal(document.querySelectorAll('.row.live-edit').length, 1);

    const row = document.querySelector('.row');
    const ripple = document.querySelector('.edit-ripple');
    const rowDone = new Event('animationend');
    Object.defineProperty(rowDone, 'animationName', { value: 'liveZapRow' });
    row.dispatchEvent(rowDone);
    ripple.dispatchEvent(new Event('animationend'));
    assert.equal(document.querySelectorAll('.edit-ripple').length, 0);
    assert.equal(row.classList.contains('live-edit'), false);

    effects.rippleFileRow('demo.txt', 201);
    assert.equal(document.querySelectorAll('.edit-ripple').length, 1);
    assert.equal(row.classList.contains('live-edit'), true);
  } finally {
    dom.cleanup();
  }
});
