/**
 * [INPUT]: 依赖 Node.js 测试库、临时目录与 electron/shell-integration.js
 * [OUTPUT]: 验证 zsh 隔离配置生成、嵌套启动防递归、原配置复用、命令标记解析和分片处理
 * [POS]: tests/electron 的 Shell 顶层命令追踪单元测试
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { createZshIntegration, consumeShellMarkers } = require('../../electron/shell-integration');

const SHELL_TOKEN = 'test-shell-token';

test('生成隔离 zsh 配置并继续加载用户原配置', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mado-shell-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const result = createZshIntegration(root, { ZDOTDIR: '/tmp/my-zdotdir' });
  const rc = fs.readFileSync(path.join(result.dir, '.zshrc'), 'utf8');
  assert.equal(result.originalZdotdir, '/tmp/my-zdotdir');
  assert.match(rc, /MADO_ORIGINAL_ZDOTDIR\/\.zshrc/);
  assert.match(rc, /add-zsh-hook preexec/);
  assert.match(rc, /add-zsh-hook precmd/);
  assert.match(rc, /unset MADO_SHELL_TOKEN/);
  assert.match(rc, /_mado_shell_token/);
});

test('从 Mado 终端嵌套启动时沿用真正的用户配置目录', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mado-shell-nested-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const integrationDir = path.join(root, 'shell-integration', 'zsh');
  const result = createZshIntegration(root, {
    ZDOTDIR: integrationDir,
    MADO_ORIGINAL_ZDOTDIR: '/tmp/user-zdotdir',
  });
  assert.equal(result.originalZdotdir, '/tmp/user-zdotdir');
  assert.notEqual(path.resolve(result.originalZdotdir), path.resolve(result.dir));
});

test('继承的原始目录指向集成目录时回退主目录', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mado-shell-self-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const integrationDir = path.join(root, 'shell-integration', 'zsh');
  const result = createZshIntegration(root, {
    ZDOTDIR: integrationDir,
    MADO_ORIGINAL_ZDOTDIR: integrationDir,
  });
  assert.equal(result.originalZdotdir, os.homedir());
});

test('跨正式版与开发版嵌套时跳过另一实例的集成目录', (t) => {
  const parentRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mado-shell-parent-'));
  const childRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mado-shell-child-'));
  t.after(() => fs.rmSync(parentRoot, { recursive: true, force: true }));
  t.after(() => fs.rmSync(childRoot, { recursive: true, force: true }));
  const parent = createZshIntegration(parentRoot, { ZDOTDIR: os.homedir() });
  const child = createZshIntegration(childRoot, {
    ZDOTDIR: parent.dir,
    MADO_ORIGINAL_ZDOTDIR: parent.dir,
  });
  assert.equal(child.originalZdotdir, os.homedir());
});

test('命令标记跨数据块解析且不进入终端可见输出', () => {
  const state = { carry: '' };
  const markers = [];
  const command = 'npm run dev -- --host';
  const marker = `\x1b]777;mado;start;${SHELL_TOKEN};${Buffer.from(command).toString('base64')}\x07`;
  const first = consumeShellMarkers(state, `prompt${marker.slice(0, 18)}`, SHELL_TOKEN, (item) => markers.push(item));
  const second = consumeShellMarkers(state, `${marker.slice(18)}output\x1b]777;mado;end;${SHELL_TOKEN}\x07`, SHELL_TOKEN, (item) => markers.push(item));
  assert.equal(first + second, 'promptoutput');
  assert.deepEqual(markers, [{ type: 'start', command }, { type: 'end' }]);
});

test('令牌不匹配的命令标记不会进入生命周期回调', () => {
  const state = { carry: '' };
  const markers = [];
  const forged = `\x1b]777;mado;start;forged-token;${Buffer.from('printf PWNED').toString('base64')}\x07`;
  assert.equal(consumeShellMarkers(state, forged, SHELL_TOKEN, (item) => markers.push(item)), '');
  assert.deepEqual(markers, []);
});
