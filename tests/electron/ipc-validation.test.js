/**
 * [INPUT]: 依赖 node:test、临时目录与 electron/ipc-validation
 * [OUTPUT]: 验证 PTY、监听、拖入文件和更新 IPC 参数边界
 * [POS]: tests/electron 的 IPC 纯安全契约测试
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const validation = require('../../electron/ipc-validation');

test('PTY ID、输入与尺寸受到明确边界约束', () => {
  assert.equal(validation.validPtyId('term_1-abc'), true);
  assert.equal(validation.validPtyId('../term'), false);
  assert.equal(validation.validPtyId('x'.repeat(65)), false);
  assert.equal(validation.validServiceKey('rule_12345678'), true);
  assert.equal(validation.validServiceKey('../rule'), false);
  assert.equal(validation.validPtyInput('hello'), true);
  assert.equal(validation.validPtyInput('x'.repeat(validation.MAX_PTY_INPUT + 1)), false);
  assert.deepEqual(validation.normalizeTerminalSize(0, 9999), { cols: 2, rows: 300 });
  assert.deepEqual(validation.normalizeTerminalSize('bad', null), { cols: 80, rows: 24 });
});

test('监听目录只保留存在目录、去重并限制数量', async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'mado-ipc-watch-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const dirs = [];
  for (let i = 0; i < validation.MAX_WATCH_DIRS + 3; i++) {
    const dir = path.join(root, String(i));
    await fsp.mkdir(dir);
    dirs.push(dir);
  }
  dirs.unshift(path.join(root, 'missing'), dirs[0]);
  const result = validation.normalizeWatchDirs(dirs, fs);
  assert.equal(result.length, validation.MAX_WATCH_DIRS);
  assert.equal(new Set(result).size, result.length);
  assert.equal(result.some((dir) => dir.endsWith('missing')), false);
});

test('拖入文件名不能穿越路径且内容大小有限制', () => {
  assert.equal(validation.safeDropName('../secret:shot.png'), '.._secret_shot.png');
  assert.equal(validation.safeDropName('..'), '拖入文件');
  assert.deepEqual(validation.safeBuffer(new Uint8Array([1, 2, 3])), Buffer.from([1, 2, 3]));
  assert.equal(validation.safeBuffer(Buffer.alloc(validation.MAX_DROP_BYTES + 1)), null);
});

test('更新 IPC 只接受三段版本和 github.com HTTPS 地址', () => {
  assert.equal(validation.validVersion('v2.7.0'), '2.7.0');
  assert.equal(validation.validVersion('2.7'), null);
  assert.equal(validation.validVersion('../2.7.0'), null);
  assert.equal(validation.validGithubUrl('https://github.com/Tit1e/mado/releases'), true);
  assert.equal(validation.validGithubUrl('http://github.com/Tit1e/mado'), false);
  assert.equal(validation.validGithubUrl('https://github.com.evil.example/release'), false);
});
