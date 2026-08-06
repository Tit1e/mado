/**
 * [INPUT]: 依赖 Node.js 测试库、临时目录与 electron/terminal-recovery-store.js
 * [OUTPUT]: 验证恢复记录原子持久化、去重、隐私过滤、目录状态和一次性取出
 * [POS]: tests/electron 的终端命令恢复仓储单元测试
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { createTerminalRecoveryStore } = require('../../electron/terminal-recovery-store');

test('合并记录时去重并跳过以空格开头的隐私命令', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mado-recovery-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cwd = fs.mkdtempSync(path.join(root, 'project-'));
  const store = createTerminalRecoveryStore(root);
  store.merge([{ cwd, command: 'npm run dev' }, { cwd, command: 'npm run dev' }, { cwd, command: ' deploy --token secret' }]);
  const entries = store.list();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].command, 'npm run dev');
  assert.equal(entries[0].available, true);
});

test('选择恢复后只移除有效且被选中的记录', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mado-recovery-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cwd = fs.mkdtempSync(path.join(root, 'project-'));
  const missing = path.join(root, 'missing');
  const store = createTerminalRecoveryStore(root);
  store.merge([{ cwd, command: 'codex' }, { cwd: missing, command: 'npm test' }]);
  const entries = store.list();
  assert.equal(entries.find((entry) => entry.cwd === missing).available, false);
  const taken = store.take(entries.map((entry) => entry.id));
  assert.deepEqual(taken.map((entry) => entry.command), ['codex']);
  assert.equal(store.list().length, 1);
});

test('运行服务恢复记录保留规则标识', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mado-recovery-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cwd = fs.mkdtempSync(path.join(root, 'project-'));
  const store = createTerminalRecoveryStore(root);
  store.merge([{ cwd, command: 'npm run dev', kind: 'service', serviceKey: 'rule_12345678' }]);
  const [entry] = store.list();
  assert.equal(entry.kind, 'service');
  assert.equal(entry.serviceKey, 'rule_12345678');
});
