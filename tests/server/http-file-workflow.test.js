/**
 * [INPUT]: 依赖临时目录、真实 app-server/path/browser/file/config 服务与随机本机端口
 * [OUTPUT]: 验证文件操作、手动项目添加移除、废纸篓及配置重载的完整 HTTP 工作流
 * [POS]: tests/server 的端到端 HTTP 文件工作流测试，不触碰用户主目录或系统废纸篓
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createAppServer } = require('../../server/app-server');
const { createBrowserService } = require('../../server/browser-service');
const { createConfigStore } = require('../../server/config-store');
const { createFileService } = require('../../server/file-service');
const { createProjectService } = require('../../server/project-service');
const { hostAllowed, originAllowed, readBody, sendJSON } = require('../../server/http-security');
const { createPathService, IGNORE_DIRS, TEXT_EXT, ext, kindOf, projectOf } = require('../../server/path-service');

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}
function close(server) { return new Promise((resolve) => server.close(resolve)); }
function request(port, route, options = {}) {
  const body = options.body === undefined ? '' : JSON.stringify(options.body);
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: route, method: options.method || 'GET', headers: {
      Host: `127.0.0.1:${port}`,
      ...(body ? { Origin: `http://127.0.0.1:${port}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}),
    } }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode, data: text ? JSON.parse(text) : null });
      });
    });
    req.on('error', reject);
    req.end(body);
  });
}

function workflowServer(home, trashCommands) {
  const { resolvePath } = createPathService(home);
  const browser = createBrowserService({ platform: process.platform, resolvePath, kindOf, projectOf, ext, ignoreDirs: IGNORE_DIRS });
  const configFile = path.join(home, '.mado', 'config.json');
  const config = createConfigStore(configFile);
  const files = createFileService({
    home, platform: process.platform, resolvePath, textExt: TEXT_EXT, ext,
    searchFiles: browser.searchFiles, mdfind: async () => [],
    execCommand: (command, callback) => { trashCommands.push(command); callback(null); },
  });
  const projects = createProjectService({ resolvePath, readConfig: config.readConfig, updateConfig: config.updateConfig });
  const unavailable = async () => ({});
  const services = new Proxy({
    defaultRoots: files.defaultRoots, listDir: browser.listDir, readFile: browser.readFile,
    createEntry: files.createEntry, writeTextFile: files.writeTextFile, renamePath: files.renamePath,
    movePath: files.movePath, trashPath: files.trashPath,
    listProjects: projects.listProjects, addProject: projects.addProject, removeProject: projects.removeProject,
    readConfig: config.readConfig, updateConfig: config.updateConfig,
    serveStatic: (_req, res) => { res.writeHead(404); res.end('{}'); },
  }, { get(target, key) { return key in target ? target[key] : unavailable; } });
  return {
    server: createAppServer({ home, platform: process.platform, port: 0, resolvePath, ext, hostAllowed, originAllowed, readBody, sendJSON, services }),
    configFile,
  };
}

test('HTTP 文件工作流从创建到废纸篓保持数据和配置一致', async () => {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'mado-http-'));
  const trashCommands = [];
  const { server, configFile } = workflowServer(home, trashCommands);
  const port = await listen(server);
  try {
    const workspace = path.join(home, 'workspace');
    await fsp.mkdir(workspace);
    const created = await request(port, '/api/create', { method: 'POST', body: { path: workspace, name: '草稿.txt', type: 'file' } });
    assert.equal(created.data.ok, true);
    const file = created.data.path;
    assert.equal((await request(port, '/api/write', { method: 'POST', body: { path: file, content: 'Mado 工作流' } })).data.ok, true);
    assert.equal((await request(port, `/api/read?path=${encodeURIComponent(file)}`)).data.content, 'Mado 工作流');

    const renamed = await request(port, '/api/rename', { method: 'POST', body: { path: file, newName: '说明.txt' } });
    const targetDir = path.join(workspace, '归档');
    await request(port, '/api/create', { method: 'POST', body: { path: workspace, name: '归档', type: 'dir' } });
    const moved = await request(port, '/api/move', { method: 'POST', body: { src: renamed.data.path, dstDir: targetDir } });
    assert.equal(await fsp.readFile(moved.data.path, 'utf8'), 'Mado 工作流');
    const listed = await request(port, `/api/list?path=${encodeURIComponent(targetDir)}`);
    assert.ok(listed.data.entries.some((item) => item.name === '说明.txt'));

    await request(port, '/api/lang', { method: 'POST', body: { lang: 'en' } });
    await request(port, '/api/favorites', { method: 'POST', body: { path: targetDir, name: '归档', isDir: true } });
    await request(port, '/api/recent-open', { method: 'POST', body: { path: moved.data.path } });
    const addedProject = await request(port, '/api/projects/add', { method: 'POST', body: { path: targetDir } });
    assert.equal(addedProject.data.added, true);
    assert.equal((await request(port, '/api/projects')).data.projects[0].path, targetDir);
    const reloaded = await createConfigStore(configFile).readConfig();
    assert.equal(reloaded.lang, 'en');
    assert.equal(reloaded.favorites[0].path, targetDir);
    assert.equal(reloaded.recentOpened[0], moved.data.path);
    assert.equal(reloaded.projects[0].path, targetDir);
    const removedProject = await request(port, '/api/projects/remove', { method: 'POST', body: { path: targetDir } });
    assert.equal(removedProject.data.removed, true);
    assert.equal((await fsp.stat(targetDir)).isDirectory(), true);
    assert.equal((await request(port, '/api/codex-projects')).status, 404);

    assert.equal((await request(port, '/api/trash', { method: 'POST', body: { path: moved.data.path } })).data.ok, true);
    assert.equal(trashCommands.length, 1);
    assert.match(trashCommands[0], /说明\.txt/);
    const invalid = await request(port, '/api/create', { method: 'POST', body: { path: workspace, name: '../越界.txt', type: 'file' } });
    assert.equal(invalid.status, 500);
    assert.equal(fs.existsSync(path.join(home, '越界.txt')), false);
  } finally {
    await close(server);
    await fsp.rm(home, { recursive: true, force: true });
  }
});
