/**
 * [INPUT]: 依赖 Node 内置测试、临时目录与 Discord 会话仓储
 * [OUTPUT]: 对外提供持久绑定、不可换绑和并发锁的回归验证
 * [POS]: tests/electron 的 Discord Session 仓储测试，保护 Thread 与 Pi session 的永久关系
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createDiscordSessionStore } = require('../../electron/discord-session-store');
function record(threadId = '1548650660356952115') { return { threadId, sessionId: `discord-${threadId}`, projectName: 'mado', projectPath: '/tmp/mado', sessionFile: '/tmp/session.jsonl', status: 'bound', createdAt: Date.now() }; }
test('Discord 子区绑定和重启后读取', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mado-session-'));
  const file = path.join(dir, 'sessions.json');
  await createDiscordSessionStore({ file }).put(record());
  assert.equal((await createDiscordSessionStore({ file }).get(record().threadId)).sessionFile, '/tmp/session.jsonl');
});
test('已绑定子区不允许换项目或换 Pi session', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mado-session-'));
  const store = createDiscordSessionStore({ file: path.join(dir, 'sessions.json') });
  await store.put(record());
  await assert.rejects(store.patch(record().threadId, { projectName: 'other' }), /固定绑定/);
  await assert.rejects(store.patch(record().threadId, { sessionFile: '/tmp/other.jsonl' }), /固定绑定/);
});
test('同一绑定不能同时取得两个锁', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mado-session-'));
  const store = createDiscordSessionStore({ file: path.join(dir, 'sessions.json') });
  const first = await store.lock(record().threadId);
  await assert.rejects(store.lock(record().threadId), /进程/);
  await first.release();
  const second = await store.lock(record().threadId);
  await second.release();
});
