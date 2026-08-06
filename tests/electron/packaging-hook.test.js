/**
 * [INPUT]: 依赖 Node.js 临时目录、package.json、npm 安装脚本白名单与 build/after-pack.js
 * [OUTPUT]: 验证二进制依赖安装许可、macOS 打包权限恢复与缺失产物阻断
 * [POS]: tests/electron 的二进制依赖安装与发布包权限回归测试，防止 Electron 缺失和终端 posix_spawnp failed
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ensureNodePtyHelpersExecutable } = require('../../build/after-pack');
const packageJson = require('../../package.json');

test('打包钩子恢复所有 macOS spawn-helper 可执行位', async () => {
  const out = await fsp.mkdtemp(path.join(os.tmpdir(), 'mado-pack-'));
  const prebuilds = path.join(out, 'Mado.app', 'Contents', 'Resources', 'app.asar.unpacked', 'node_modules', 'node-pty', 'prebuilds');
  try {
    for (const arch of ['darwin-arm64', 'darwin-x64']) {
      const dir = path.join(prebuilds, arch);
      await fsp.mkdir(dir, { recursive: true });
      await fsp.writeFile(path.join(dir, 'spawn-helper'), 'binary', { mode: 0o644 });
    }
    const helpers = ensureNodePtyHelpersExecutable(out, 'Mado');
    assert.equal(helpers.length, 2);
    helpers.forEach((file) => assert.equal(fs.statSync(file).mode & 0o111, 0o111));
  } finally {
    await fsp.rm(out, { recursive: true, force: true });
  }
});

test('打包与本地安装配置均启用权限修复且缺少辅助程序时立即失败', async () => {
  assert.equal(packageJson.build.afterPack, 'build/after-pack.js');
  assert.equal(packageJson.scripts.postinstall, 'node build/prepare-electron.mjs && node build/prepare-node-pty.js');
  const out = await fsp.mkdtemp(path.join(os.tmpdir(), 'mado-pack-empty-'));
  const prebuilds = path.join(out, 'Mado.app', 'Contents', 'Resources', 'app.asar.unpacked', 'node_modules', 'node-pty', 'prebuilds');
  try {
    await fsp.mkdir(prebuilds, { recursive: true });
    assert.throws(() => ensureNodePtyHelpersExecutable(out, 'Mado'), /spawn-helper 不存在/);
  } finally {
    await fsp.rm(out, { recursive: true, force: true });
  }
});

test('npm 仅允许已审查的二进制依赖执行安装脚本', () => {
  assert.deepEqual(packageJson.allowScripts, {
    'electron@33.4.11': true,
    'esbuild@0.28.0': true,
    'node-pty@1.1.0': true,
  });
});
