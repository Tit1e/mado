/**
 * [INPUT]: 依赖 Node.js 临时目录与 electron/file-watch-service.js
 * [OUTPUT]: 验证监听集合去重、切换、非法目录拒绝和资源清理
 * [POS]: tests/electron 的真实 FSWatcher 生命周期测试，不启动 Electron
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
'use strict';

const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createFileWatchService } = require('../../electron/file-watch-service');

test('文件监听服务维护目录集合并可靠清理', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'mado-watch-'));
  const first = path.join(root, 'first');
  const second = path.join(root, 'second');
  await Promise.all([fsp.mkdir(first), fsp.mkdir(second)]);
  const service = createFileWatchService();
  try {
    assert.deepEqual(service.set({ dirs: [first, first, second] }), { ok: true, count: 2 });
    assert.equal(service.count(), 2);
    assert.deepEqual(service.watch({ dir: first }), { ok: true });
    assert.equal(service.count(), 1);
    assert.deepEqual(service.watch({ dir: path.join(root, 'missing') }), { ok: false, error: '监听目录无效' });
  } finally {
    service.closeAll();
    assert.equal(service.count(), 0);
    await fsp.rm(root, { recursive: true, force: true });
  }
});
