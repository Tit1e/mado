/**
 * [INPUT]: 依赖 Node.js 临时目录、系统 Git 与 server/git-service.js
 * [OUTPUT]: 验证仓库识别、分支、修改文件和文本增删行汇总
 * [POS]: tests/server 的只读 Git 领域服务测试，使用隔离临时仓库
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
'use strict';

const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const test = require('node:test');
const { createGitService } = require('../../server/git-service');
const { createPathService, kindOf } = require('../../server/path-service');

function git(cwd, ...args) { execFileSync('git', args, { cwd, stdio: 'ignore' }); }

test('Git 状态返回分支、文件列表和完整增删行汇总', async () => {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'mado-git-'));
  const repo = path.join(home, '项目');
  await fsp.mkdir(repo);
  try {
    git(repo, 'init', '-b', 'test-branch');
    git(repo, 'config', 'user.name', 'Mado Test');
    git(repo, 'config', 'user.email', 'test@mado.local');
    await fsp.writeFile(path.join(repo, 'keep.txt'), 'a\nb\nc\n');
    await fsp.writeFile(path.join(repo, 'gone.txt'), 'gone\n');
    await fsp.writeFile(path.join(repo, 'rename me.txt'), 'old\n');
    git(repo, 'add', '.');
    git(repo, 'commit', '-m', 'base');
    await fsp.writeFile(path.join(repo, 'keep.txt'), 'a\nchanged\nc\nadded\n');
    await fsp.rm(path.join(repo, 'gone.txt'));
    git(repo, 'mv', 'rename me.txt', 'renamed.txt');
    await fsp.appendFile(path.join(repo, 'renamed.txt'), 'new\n');
    await fsp.writeFile(path.join(repo, '新 文件.txt'), 'one\ntwo');
    await fsp.writeFile(path.join(repo, 'README'), 'readme line\n');
    await fsp.writeFile(path.join(repo, 'image.png'), Buffer.from([0, 1, 2]));

    const { resolvePath } = createPathService(home);
    const service = createGitService({ resolvePath, kindOf });
    const status = await service.gitStatus(repo);
    assert.equal(status.isRepo, true);
    assert.equal(status.branch, 'test-branch');
    assert.equal(status.detached, false);
    assert.deepEqual(status.summary, { files: 6, additions: 6, deletions: 2, binary: 1 });
    assert.deepEqual(status.files.map((file) => file.relativePath).sort(), ['gone.txt', 'image.png', 'keep.txt', 'README', 'renamed.txt', '新 文件.txt'].sort());
    assert.match(status.files.find((file) => file.relativePath === 'renamed.txt').code, /R/);
    assert.equal(status.files.find((file) => file.relativePath === 'gone.txt').deleted, true);
    assert.equal(status.files.find((file) => file.relativePath === 'image.png').binary, true);
    const deletedDiff = await service.gitFileDiff(path.join(repo, 'gone.txt'));
    assert.equal(deletedDiff.original, 'gone\n');
    assert.equal(deletedDiff.modified, '');
  } finally {
    await fsp.rm(home, { recursive: true, force: true });
  }
});

test('普通目录明确返回不是 Git 仓库', async () => {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'mado-no-git-'));
  try {
    const { resolvePath } = createPathService(home);
    const status = await createGitService({ resolvePath, kindOf }).gitStatus(home);
    assert.deepEqual(status, { available: true, isRepo: false });
  } finally {
    await fsp.rm(home, { recursive: true, force: true });
  }
});
