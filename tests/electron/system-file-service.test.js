/**
 * [INPUT]: 依赖 Node.js 临时目录与 electron/system-file-service.js 的注入式系统文件服务
 * [OUTPUT]: 验证拖入内容落盘、同名避让、目录边界和图片剪贴板契约
 * [POS]: tests/electron 的系统文件服务单元测试，不访问真实剪贴板或 Finder
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
'use strict';

const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createSystemFileService } = require('../../electron/system-file-service');

test('拖入文件安全落盘且同名目标不覆盖', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'mado-drop-'));
  const copiedImages = [];
  const service = createSystemFileService({
    app: { getPath: () => root },
    nativeImage: { createFromPath: (value) => ({ isEmpty: () => value === 'bad' }) },
    clipboard: { writeImage: (image) => copiedImages.push(image) },
  });
  try {
    const first = service.saveInto({ dir: root, name: '../说明.txt', buf: Buffer.from('first') });
    const second = service.saveInto({ dir: root, name: '../说明.txt', buf: Buffer.from('second') });
    assert.equal(path.basename(first.path), '.._说明.txt');
    assert.equal(path.basename(second.path), '.._说明 2.txt');
    assert.equal(await fsp.readFile(first.path, 'utf8'), 'first');
    assert.equal(await fsp.readFile(second.path, 'utf8'), 'second');
    assert.deepEqual(service.saveInto({ dir: path.join(root, 'missing'), name: 'x', buf: Buffer.from('x') }), { ok: false, error: '目标目录无效' });
    assert.deepEqual(service.copyImage({ path: 'bad' }), { ok: false, error: '不是可读图片' });
    assert.deepEqual(service.copyImage({ path: 'good' }), { ok: true });
    assert.equal(copiedImages.length, 1);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});
