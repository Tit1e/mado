/**
 * [INPUT]: 依赖 Node.js 临时目录与 server/developer-tools.js 发版准备服务
 * [OUTPUT]: 验证版本号边界、package/package-lock 同步与 CHANGELOG 升格行为
 * [POS]: tests/server 的发版入口回归测试，防止发布元数据分裂
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
'use strict';

const assert = require('node:assert/strict');
const { mkdtemp, readFile, rm, symlink, writeFile } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createDeveloperTools } = require('../../server/developer-tools');

async function fixture() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'codexbox-release-'));
  await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'demo', version: '2.8.1' }, null, 2) + '\n');
  await writeFile(path.join(dir, 'package-lock.json'), JSON.stringify({
    name: 'demo', version: '2.8.1', lockfileVersion: 3, packages: { '': { name: 'demo', version: '2.8.1' } },
  }, null, 2) + '\n');
  await writeFile(path.join(dir, 'CHANGELOG.md'), '# 更新日志\n\n## [Unreleased]\n\n## [2.8.1] - 2026-07-20\n');
  const tools = createDeveloperTools({ configDir: dir, resolvePath: (value) => value, shellQuote: (value) => `'${value}'` });
  return { dir, tools };
}

test('发版准备同步 package 与锁文件版本并升格 CHANGELOG', async () => {
  const { dir, tools } = await fixture();
  try {
    const result = await tools.releasePrepare({ path: dir, version: '2.8.2', notes: '### Fixed\n- 修复终端标签关闭。' });
    assert.equal(result.ok, true);
    const pkg = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8'));
    const lock = JSON.parse(await readFile(path.join(dir, 'package-lock.json'), 'utf8'));
    const changelog = await readFile(path.join(dir, 'CHANGELOG.md'), 'utf8');
    assert.equal(pkg.version, '2.8.2');
    assert.equal(lock.version, '2.8.2');
    assert.equal(lock.packages[''].version, '2.8.2');
    assert.match(changelog, /## \[Unreleased\]\s+## \[2\.8\.2\]/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('发版准备拒绝带后缀的伪语义化版本号', async () => {
  const { dir, tools } = await fixture();
  try {
    const result = await tools.releasePrepare({ path: dir, version: '2.8.2beta', notes: '' });
    assert.equal(result.ok, false);
    const pkg = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8'));
    assert.equal(pkg.version, '2.8.1');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('发版准备拒绝符号链接锁文件且不改动外部目标', async () => {
  const { dir, tools } = await fixture();
  const outside = `${dir}-outside.json`;
  try {
    const original = JSON.stringify({ version: 'outside', packages: { '': { version: 'outside' } } }, null, 2) + '\n';
    await writeFile(outside, original);
    await rm(path.join(dir, 'package-lock.json'));
    await symlink(outside, path.join(dir, 'package-lock.json'));

    const result = await tools.releasePrepare({ path: dir, version: '2.8.2', notes: '' });

    assert.equal(result.ok, false);
    assert.match(result.error, /不是普通文件/);
    assert.equal(await readFile(outside, 'utf8'), original);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(outside, { force: true });
  }
});
