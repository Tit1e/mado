/**
 * [INPUT]: 依赖 node:test、临时 Codex 会话目录和 server/codex-sessions
 * [OUTPUT]: 验证新旧会话发现、项目聚合、检查快照和变更拒绝
 * [POS]: tests/server 的 Codex 会话安全回归测试，不执行真实 CLI 变更
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { createPathService } = require('../../server/path-service');
const { createCodexSessions } = require('../../server/codex-sessions');

test('发现新旧格式会话并拒绝过期快照', async (t) => {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'mado-sessions-'));
  t.after(() => fsp.rm(home, { recursive: true, force: true }));
  const project = path.join(home, 'project');
  const sessions = path.join(home, '.codex', 'sessions', '2026', '07', '11');
  await fsp.mkdir(project, { recursive: true });
  await fsp.mkdir(sessions, { recursive: true });
  const oldId = '11111111-1111-4111-8111-111111111111';
  const newId = '22222222-2222-4222-8222-222222222222';
  await fsp.writeFile(path.join(sessions, 'old.jsonl'), JSON.stringify({ timestamp: '', type: 'session_meta', payload: { id: oldId, cwd: project } }) + '\n');
  await fsp.writeFile(path.join(sessions, 'new.jsonl'), JSON.stringify({ timestamp: '', type: 'session_meta', payload: { session_id: newId, cwd: project } }) + '\n');
  const { resolvePath } = createPathService(home);
  const service = createCodexSessions({ home, platform: 'linux', resolvePath, findCodexBin: async () => null });

  const found = await service.codexProjects(true);
  assert.equal(found.projects[0].path, project);
  const inspected = await service.inspectCodexProjectSessions(project, 'archive');
  assert.equal(inspected.total, 2);
  assert.equal(inspected.running, 0);
  assert.match(inspected.snapshot, /^[0-9a-f]{64}$/);
  assert.deepEqual(await service.mutateCodexProjectSessions(project, 'archive', 'stale'), { ok: false, error: '会话列表已经变化，请重新操作并确认' });
  assert.deepEqual(await service.mutateCodexProjectSessions(project, 'archive', inspected.snapshot), { ok: false, error: '没找到 codex 命令' });
});
