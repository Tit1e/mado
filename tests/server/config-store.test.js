/**
 * [INPUT]: 依赖 node:test、临时目录和 server/config-store
 * [OUTPUT]: 验证配置缺省、损坏拒绝与并发原子写不丢更新
 * [POS]: tests/server 的配置存储回归测试
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { createConfigStore } = require('../../server/config-store');

test('配置不存在时返回安全默认值', async (t) => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mado-config-'));
  t.after(() => fsp.rm(dir, { recursive: true, force: true }));
  const store = createConfigStore(path.join(dir, 'config.json'));
  assert.deepEqual(await store.readConfig(), { favorites: [], recentOpened: [] });
});

test('损坏配置会报错而不是伪装成空配置', async (t) => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mado-config-'));
  t.after(() => fsp.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'config.json');
  await fsp.writeFile(file, '{broken', 'utf8');
  await assert.rejects(createConfigStore(file).readConfig(), SyntaxError);
});

test('并发读改写按顺序落盘且不丢字段', async (t) => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mado-config-'));
  t.after(() => fsp.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'config.json');
  const store = createConfigStore(file);
  await Promise.all([
    store.updateConfig((cfg) => { cfg.favorites = [{ path: '/a' }]; }),
    store.updateConfig((cfg) => { cfg.recentOpened = ['/b']; }),
  ]);
  assert.deepEqual(JSON.parse(await fsp.readFile(file, 'utf8')), { favorites: [{ path: '/a' }], recentOpened: ['/b'] });
});
