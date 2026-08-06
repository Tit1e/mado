/**
 * [INPUT]: 依赖 Node.js 临时目录、server/file-service 与 path-service
 * [OUTPUT]: 验证原子写入冲突、创建移动重命名、图片保存和废纸篓命令安全
 * [POS]: tests/server 的可变文件操作回归测试，所有真实写入仅发生在临时目录
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
'use strict';

const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createFileService } = require('../../server/file-service');
const { createPathService } = require('../../server/path-service');

async function fixture(t, overrides = {}) {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'mado-file-service-'));
  t.after(() => fsp.rm(home, { recursive: true, force: true }));
  const { resolvePath } = createPathService(home);
  const service = createFileService({
    home,
    platform: 'darwin',
    resolvePath,
    textExt: new Set(['txt', 'md', 'js']),
    ext: (file) => path.extname(file).slice(1).toLowerCase(),
    searchFiles: async () => ({ results: [] }),
    mdfind: async () => [],
    ...overrides,
  });
  return { home, service };
}

test('文本写入原子落盘并拒绝覆盖外部修改', async (t) => {
  const { home, service } = await fixture(t);
  const file = path.join(home, 'note.txt');
  await fsp.writeFile(file, 'old');
  const before = await fsp.stat(file);
  const result = await service.writeTextFile(file, 'new', before.mtimeMs);
  assert.equal(result.ok, true);
  assert.equal(await fsp.readFile(file, 'utf8'), 'new');
  assert.equal((await fsp.readdir(home)).some((name) => name.includes('.mado-tmp-')), false);

  const future = new Date(Date.now() + 10_000);
  await fsp.utimes(file, future, future);
  await assert.rejects(
    service.writeTextFile(file, 'stale overwrite', result.mtime),
    (error) => error.conflict === true && /外部修改/.test(error.message),
  );
  assert.equal(await fsp.readFile(file, 'utf8'), 'new');
});

test('创建、重命名和移动保持数据并为同名目标自动编号', async (t) => {
  const { home, service } = await fixture(t);
  const sourceDir = path.join(home, 'source');
  const targetDir = path.join(home, 'target');
  await fsp.mkdir(sourceDir);
  await fsp.mkdir(targetDir);
  const created = await service.createEntry(sourceDir, 'draft.txt', 'file');
  await fsp.writeFile(created.path, 'content');
  const renamed = await service.renamePath(created.path, 'final.txt');
  await fsp.writeFile(path.join(targetDir, 'final.txt'), 'existing');
  const moved = await service.movePath(renamed.path, targetDir);
  assert.equal(path.basename(moved.path), 'final-2.txt');
  assert.equal(await fsp.readFile(moved.path, 'utf8'), 'content');
  await assert.rejects(fsp.stat(renamed.path), { code: 'ENOENT' });
});

test('文件名校验拒绝路径穿越、分隔符、空名称和同名覆盖', async (t) => {
  const { home, service } = await fixture(t);
  await fsp.mkdir(path.join(home, 'dir'));
  await service.createEntry(home, 'exists.txt', 'file');
  for (const name of ['', '..', '../escape.txt', 'nested/file.txt', 'bad\\file.txt']) {
    await assert.rejects(service.createEntry(home, name, 'file'), /名称不合法/);
  }
  await assert.rejects(service.createEntry(home, 'exists.txt', 'file'), /同名/);
  await assert.rejects(service.renamePath(path.join(home, 'exists.txt'), '../escape.txt'), /名称不合法/);
});

test('图片另存为写入解码内容且不覆盖同名文件', async (t) => {
  const { home, service } = await fixture(t);
  const source = path.join(home, 'source.png');
  await fsp.writeFile(source, 'old');
  const dataUrl = 'data:image/png;base64,' + Buffer.from('image-bytes').toString('base64');
  const saved = await service.saveImage({ path: source, dataUrl, newName: 'copy.png' });
  assert.equal(await fsp.readFile(saved.path, 'utf8'), 'image-bytes');
  await assert.rejects(service.saveImage({ path: source, dataUrl, newName: 'copy.png' }), /同名/);
  assert.equal(await fsp.readFile(source, 'utf8'), 'old');
});

test('废纸篓操作调用系统回收站命令且非法路径不会执行命令', async (t) => {
  const commands = [];
  const { home, service } = await fixture(t, {
    execCommand: (command, callback) => { commands.push(command); callback(null); },
  });
  const file = path.join(home, "quote's file.txt");
  await fsp.writeFile(file, 'data');
  assert.deepEqual(await service.trashPath(file), { ok: true });
  assert.equal(commands.length, 1);
  assert.match(commands[0], /Finder.*delete/);
  assert.doesNotMatch(commands[0], /\brm\b/);

  const missing = await service.trashPath(path.join(home, 'missing.txt'));
  assert.equal(missing.ok, false);
  assert.equal(commands.length, 1);
});
