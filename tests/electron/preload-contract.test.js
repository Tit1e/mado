/**
 * [INPUT]: 依赖 Node.js 文件读取与 electron/main.js、preload.js IPC 字符串
 * [OUTPUT]: 验证 preload 与主进程 IPC 频道一致，并校验项目目录选择、Codex 新会话与命令重启链路
 * [POS]: tests/electron 的跨文件 IPC 与菜单快捷键契约测试，防止桥接改名漂移
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
'use strict';

const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');

test('preload 发出的 IPC 频道全部由主进程注册', async () => {
  const root = path.resolve(__dirname, '..', '..');
  const preload = await fsp.readFile(path.join(root, 'electron', 'preload.js'), 'utf8');
  const main = await fsp.readFile(path.join(root, 'electron', 'main.js'), 'utf8');
  const sent = [...preload.matchAll(/ipcRenderer\.(?:invoke|send)\('([^']+)'/g)].map((match) => match[1]);
  const registered = new Set([...main.matchAll(/ipcMain\.(?:handle|on)\('([^']+)'/g)].map((match) => match[1]));
  assert.ok(sent.length > 0);
  assert.deepEqual(sent.filter((channel) => !registered.has(channel)), []);
});

test('项目目录选择桥接使用主进程原生目录选择器', async () => {
  const root = path.resolve(__dirname, '..', '..');
  const preload = await fsp.readFile(path.join(root, 'electron', 'preload.js'), 'utf8');
  const main = await fsp.readFile(path.join(root, 'electron', 'main.js'), 'utf8');
  assert.match(preload, /madoProjects[\s\S]*chooseDirectory:\s*\(\) => ipcRenderer\.invoke\('projects:choose-directory'\)/);
  assert.match(main, /ipcMain\.handle\('projects:choose-directory'[\s\S]*showOpenDialog[\s\S]*properties:\s*\['openDirectory'\]/);
});

test('preload 事件订阅都提供 removeListener 清理函数', async () => {
  const preload = await fsp.readFile(path.resolve(__dirname, '..', '..', 'electron', 'preload.js'), 'utf8');
  const subscribed = [...preload.matchAll(/ipcRenderer\.on\('([^']+)'/g)].map((match) => match[1]);
  const removed = new Set([...preload.matchAll(/ipcRenderer\.removeListener\('([^']+)'/g)].map((match) => match[1]));
  assert.ok(subscribed.length > 0);
  assert.deepEqual(subscribed.filter((channel) => !removed.has(channel)), []);
});

test('语言切换可通过受控桥接即时重建原生菜单', async () => {
  const root = path.resolve(__dirname, '..', '..');
  const main = await fsp.readFile(path.join(root, 'electron', 'main.js'), 'utf8');
  const preload = await fsp.readFile(path.join(root, 'electron', 'preload.js'), 'utf8');
  assert.match(preload, /madoLocale[\s\S]*refreshMenu:\s*\(\) => ipcRenderer\.invoke\('locale:refresh-menu'\)/);
  assert.match(main, /ipcMain\.handle\('locale:refresh-menu', \(\) => \{\s*buildMenu\(\)/);
});

test('Cmd/Ctrl+Shift+N 菜单事件贯通 Codex 新会话桥接', async () => {
  const root = path.resolve(__dirname, '..', '..');
  const main = await fsp.readFile(path.join(root, 'electron', 'main.js'), 'utf8');
  const preload = await fsp.readFile(path.join(root, 'electron', 'preload.js'), 'utf8');
  assert.match(main, /accelerator:\s*'CmdOrCtrl\+Shift\+N'/);
  assert.match(main, /send\('terminal:launch-codex-new'\)/);
  assert.match(preload, /onLaunchNewCodex:[\s\S]*ipcRenderer\.on\('terminal:launch-codex-new'/);
});

test('Cmd/Ctrl+Shift+R 菜单事件贯通当前命令重启桥接', async () => {
  const root = path.resolve(__dirname, '..', '..');
  const main = await fsp.readFile(path.join(root, 'electron', 'main.js'), 'utf8');
  const preload = await fsp.readFile(path.join(root, 'electron', 'preload.js'), 'utf8');
  assert.match(main, /accelerator:\s*'CmdOrCtrl\+Shift\+R'/);
  assert.match(main, /send\('terminal:restart-active'\)/);
  assert.match(main, /ipcMain\.handle\('pty:restart-command'/);
  assert.match(preload, /restartCommand:[\s\S]*ipcRenderer\.invoke\('pty:restart-command'/);
  assert.match(preload, /onRestartActiveCommand:[\s\S]*ipcRenderer\.on\('terminal:restart-active'/);
});
