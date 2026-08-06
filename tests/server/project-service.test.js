/**
 * [INPUT]: 依赖 node:test、临时目录、配置仓储与 server/project-service
 * [OUTPUT]: 验证手动项目添加、去重、上限、失效保留和仅配置移除
 * [POS]: tests/server 的用户项目领域服务回归测试，不读取 Agent 会话
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { createConfigStore } = require('../../server/config-store');
const { createPathService } = require('../../server/path-service');
const { MAX_PROJECTS, createProjectService } = require('../../server/project-service');

async function harness(t) {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'mado-projects-'));
  t.after(() => fsp.rm(home, { recursive: true, force: true }));
  const config = createConfigStore(path.join(home, '.mado', 'config.json'));
  const { resolvePath } = createPathService(home);
  return { home, config, service: createProjectService({ resolvePath, ...config }) };
}

test('手动项目添加后持久化，重复添加保持单条记录', async (t) => {
  const { home, config, service } = await harness(t);
  const project = path.join(home, 'demo');
  await fsp.mkdir(project);

  const added = await service.addProject(project);
  assert.equal(added.ok, true);
  assert.equal(added.added, true);
  assert.deepEqual(added.projects.map(({ path: value, name, available }) => ({ path: value, name, available })), [
    { path: project, name: 'demo', available: true },
  ]);
  const duplicate = await service.addProject(project);
  assert.equal(duplicate.added, false);
  assert.equal(duplicate.projects.length, 1);

  const newer = path.join(home, 'newer');
  await fsp.mkdir(newer);
  const reordered = await service.addProject(newer);
  assert.deepEqual(reordered.projects.map((item) => item.path), [newer, project]);
  assert.equal((await config.readConfig()).projects[0].path, newer);
});

test('添加拒绝文件与不存在目录，目录失效后保留记录', async (t) => {
  const { home, service } = await harness(t);
  const file = path.join(home, 'file.txt');
  const project = path.join(home, 'offline');
  await fsp.writeFile(file, 'x');
  await fsp.mkdir(project);

  assert.equal((await service.addProject(file)).ok, false);
  assert.equal((await service.addProject(path.join(home, 'missing'))).ok, false);
  await service.addProject(project);
  await fsp.rm(project, { recursive: true });
  const listed = await service.listProjects();
  assert.equal(listed.projects[0].path, project);
  assert.equal(listed.projects[0].available, false);
});

test('移除项目只改配置，不删除真实目录', async (t) => {
  const { home, config, service } = await harness(t);
  const project = path.join(home, 'keep-me');
  await fsp.mkdir(project);
  await service.addProject(project);

  const removed = await service.removeProject(project);
  assert.equal(removed.ok, true);
  assert.equal(removed.removed, true);
  assert.deepEqual(removed.projects, []);
  assert.equal((await fsp.stat(project)).isDirectory(), true);
  assert.deepEqual((await config.readConfig()).projects, []);
});

test('项目数量达到上限时拒绝静默挤掉旧项目', async (t) => {
  const { home, config, service } = await harness(t);
  const candidate = path.join(home, 'candidate');
  await fsp.mkdir(candidate);
  await config.updateConfig((value) => {
    value.projects = Array.from({ length: MAX_PROJECTS }, (_, index) => ({ path: path.join(home, `old-${index}`), addedAt: index }));
  });
  const result = await service.addProject(candidate);
  assert.equal(result.ok, false);
  assert.match(result.error, /最多添加/);
  assert.equal((await config.readConfig()).projects.length, MAX_PROJECTS);
});
