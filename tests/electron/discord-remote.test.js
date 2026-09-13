/**
 * [INPUT]: 依赖 Node 内置测试、临时目录与 Discord 远程领域服务纯函数
 * [OUTPUT]: 对外提供 Discord 配置、诊断脱敏与 Pi RPC 会话关键错误路径的回归验证
 * [POS]: tests/electron 的 Discord 远程功能测试，保护单用户入口和错误收集契约
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadDiscordConfig } = require('../../electron/discord-config');
const { createDiscordDiagnostics } = require('../../electron/discord-diagnostics');

test('Discord 配置默认关闭且不要求密钥', () => {
  assert.deepEqual(loadDiscordConfig({ home: fs.mkdtempSync(path.join(os.tmpdir(), 'mado-discord-')), env: {} }), { enabled: false });
});

test('Discord 配置拒绝非绝对 pi 路径', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mado-discord-'));
  assert.throws(() => loadDiscordConfig({ home, env: {
    MADO_DISCORD_ENABLED: '1', DISCORD_BOT_TOKEN: 'secret', DISCORD_GUILD_ID: '123456789012345678',
    DISCORD_CHANNEL_ID: '123456789012345679', DISCORD_OWNER_USER_ID: '123456789012345680', MADO_DISCORD_PI_PATH: 'pi',
  } }), /绝对路径/);
});

test('诊断记录提供错误编号并脱敏凭据与主目录', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mado-discord-log-'));
  const diagnostics = createDiscordDiagnostics({ directory, secrets: ['bot-secret'], versions: { mado: 'test' } });
  const errorId = diagnostics.error('TEST_FAILURE', new Error(`token=bot-secret at ${os.homedir()}/private`));
  const report = diagnostics.report();
  assert.match(errorId, /^[0-9a-f]{8}$/);
  assert.doesNotMatch(report, /bot-secret/);
  assert.doesNotMatch(report, new RegExp(os.homedir().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(report, /TEST_FAILURE/);
  assert.match(fs.readFileSync(path.join(directory, 'events.jsonl'), 'utf8'), /TEST_FAILURE/);
});
