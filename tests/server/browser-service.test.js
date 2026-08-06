/**
 * [INPUT]: 依赖 Node.js 临时目录、server/browser-service 与 path-service
 * [OUTPUT]: 验证大文本读取限制和非文本文件只返回元数据
 * [POS]: tests/server 的只读文件浏览回归测试，防止预览接口无界读取
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
'use strict';

const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createBrowserService } = require('../../server/browser-service');
const { createPathService } = require('../../server/path-service');

async function serviceFixture(t) {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'mado-browser-service-'));
  t.after(() => fsp.rm(home, { recursive: true, force: true }));
  const { resolvePath } = createPathService(home);
  const ext = (file) => path.extname(file).slice(1).toLowerCase();
  const service = createBrowserService({
    platform: 'darwin',
    resolvePath,
    kindOf: (name) => ['txt', 'md'].includes(ext(name)) ? 'text' : 'other',
    projectOf: () => null,
    ext,
    ignoreDirs: new Set(),
  });
  return { home, service };
}

test('大文本只读取前 256KB并标记 tooLarge', async (t) => {
  const { home, service } = await serviceFixture(t);
  const file = path.join(home, 'large.txt');
  await fsp.writeFile(file, 'a'.repeat(2 * 1024 * 1024 + 1));
  const result = await service.readFile(file);
  assert.equal(result.tooLarge, true);
  assert.match(result.content, /仅显示前 256KB/);
  assert.ok(Buffer.byteLength(result.content, 'utf8') < 270 * 1024);
});

test('非文本文件不加载内容，只返回元数据', async (t) => {
  const { home, service } = await serviceFixture(t);
  const file = path.join(home, 'binary.bin');
  await fsp.writeFile(file, Buffer.from([0, 1, 2, 3]));
  const result = await service.readFile(file);
  assert.equal(result.kind, 'other');
  assert.equal(result.size, 4);
  assert.equal('content' in result, false);
});
