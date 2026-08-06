/**
 * [INPUT]: 依赖 happy-dom、edit-session 与 preview 控制器
 * [OUTPUT]: 验证自动保存、未保存确认、预览关闭和编辑器资源释放
 * [POS]: tests/frontend 的编辑数据安全回归测试
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { installDom, loadRendererModule } from './dom-environment.mjs';

const { guardEditExit } = await loadRendererModule('edit-session');
const { createPreviewController } = await loadRendererModule('preview');

test('存在自动保存任务时先落盘并清理编辑会话', async () => {
  const calls = [];
  const runtime = {
    dirtyCheck: () => true,
    currentEditor: { path: '/work/note.md' },
    autosaveFlush: async () => calls.push('flush'),
  };
  const result = await guardEditExit(runtime, async () => {
    calls.push('confirm');
    return false;
  });
  assert.equal(result, true);
  assert.deepEqual(calls, ['flush']);
  assert.equal(runtime.autosaveFlush, null);
  assert.equal(runtime.dirtyCheck, null);
  assert.equal(runtime.currentEditor, null);
});

test('用户取消放弃修改时保留编辑状态', async () => {
  const dirtyCheck = () => true;
  const runtime = { dirtyCheck, currentEditor: { path: '/work/note.md' }, autosaveFlush: null };
  const result = await guardEditExit(runtime, async () => false);
  assert.equal(result, false);
  assert.equal(runtime.dirtyCheck, dirtyCheck);
  assert.deepEqual(runtime.currentEditor, { path: '/work/note.md' });
});

test('用户确认放弃修改后允许离开并清除 dirty 守卫', async () => {
  const runtime = { dirtyCheck: () => true, currentEditor: {}, autosaveFlush: null };
  const result = await guardEditExit(runtime, async (message) => {
    assert.match(message, /未保存/);
    return true;
  });
  assert.equal(result, true);
  assert.equal(runtime.dirtyCheck, null);
});

test('关闭预览会释放 Monaco、Crepe 和图片编辑状态', async () => {
  const dom = installDom('<section id="terminal-panel"><section id="preview"></section></section>');
  try {
    const calls = [];
    const runtime = { imgEditState: { dirty: false } };
    const controller = createPreviewController(new Proxy({
      $: (selector) => document.querySelector(selector),
      state: {},
      runtime,
      guardDirty: async () => true,
      mona: { disposeIfAny: () => calls.push('mona') },
      crepe: { disposeIfAny: () => calls.push('crepe') },
      follow: { on: false },
      term: { fitActive: () => calls.push('fit') },
      applySelection: (path) => calls.push(['selection', path]),
    }, {
      get(target, key) { return key in target ? target[key] : () => {}; },
    }));
    await controller.closePreview();
    assert.equal(runtime.imgEditState, null);
    assert.deepEqual(calls, ['mona', 'crepe', ['selection', null], 'fit']);
    assert.equal(document.querySelector('#preview').classList.contains('hidden'), true);
  } finally {
    dom.cleanup();
  }
});
