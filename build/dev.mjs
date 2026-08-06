/**
 * [INPUT]: 依赖 esbuild Svelte 构建配置、Electron 可执行文件和项目源码目录
 * [OUTPUT]: 对外提供 npm run dev 的构建监听、渲染层刷新与 Electron 安全重启编排
 * [POS]: build 模块的开发监督入口，通过父子进程 IPC 连接源码变化与 Electron 开发控制消息
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { watch } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';
import { svelteBuildOptions } from './svelte-ui.mjs';

const require = createRequire(import.meta.url);
const electronBinary = require('electron');
const { DEV_RESTART_EXIT_CODE } = require('../electron/dev-reload-service');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const watchers = [];
let electron = null;
let stopping = false;
let pendingMode = null;
let changeTimer = null;
let svelteTimer = null;
let svelteBuilding = false;
let sveltePending = false;

function log(message) {
  console.log(`[dev] ${message}`);
}

function startElectron() {
  log('启动 Electron');
  electron = spawn(electronBinary, ['.'], {
    cwd: ROOT,
    env: { ...process.env, MADO_DEV_WATCH: '1' },
    stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
  });
  electron.on('close', (code) => {
    electron = null;
    if (stopping) return;
    if (code === DEV_RESTART_EXIT_CODE) {
      log('主进程源码已更新，重新启动 Electron');
      startElectron();
      return;
    }
    log(`Electron 已退出${code === null ? '' : `（状态 ${code}）`}`);
    shutdown(code || 0);
  });
}

function queue(mode, file) {
  if (mode === 'restart' || !pendingMode) pendingMode = mode;
  clearTimeout(changeTimer);
  changeTimer = setTimeout(() => {
    const next = pendingMode;
    pendingMode = null;
    if (!electron || electron.killed || !electron.connected) return;
    log(`${file || '源码'} 已更新，请求${next === 'restart' ? '重启应用' : '刷新界面'}`);
    electron.send({ type: 'mado-dev', action: next });
  }, 180);
}

function watchTree(relative, mode, ignore = () => false) {
  const absolute = path.join(ROOT, relative);
  const watcher = watch(absolute, { recursive: true }, (_event, filename) => {
    const changed = filename ? String(filename) : relative;
    if (!ignore(changed)) queue(mode, path.join(relative, changed));
  });
  watcher.on('error', (error) => console.error(`[dev] 监听 ${relative} 失败:`, error.message));
  watchers.push(watcher);
}

function watchRootFiles() {
  const files = new Set(['server.js', 'port-config.js']);
  const watcher = watch(ROOT, (_event, filename) => {
    const changed = filename && String(filename);
    if (files.has(changed)) queue('restart', changed);
  });
  watchers.push(watcher);
}

function watchSvelte() {
  const rebuild = async () => {
    if (svelteBuilding) { sveltePending = true; return; }
    svelteBuilding = true;
    try {
      await svelteContext.rebuild();
      queue('reload', 'src-ui');
    } catch (error) {
      console.error('[dev] Svelte 构建失败:', error.message);
    } finally {
      svelteBuilding = false;
      if (sveltePending) {
        sveltePending = false;
        rebuild();
      }
    }
  };
  const watcher = watch(path.join(ROOT, 'src-ui'), { recursive: true }, () => {
    clearTimeout(svelteTimer);
    svelteTimer = setTimeout(rebuild, 100);
  });
  watchers.push(watcher);
}

async function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  clearTimeout(changeTimer);
  clearTimeout(svelteTimer);
  watchers.forEach((watcher) => watcher.close());
  await svelteContext.dispose();
  if (electron && !electron.killed) electron.kill('SIGTERM');
  process.exitCode = code;
}

const svelteContext = await esbuild.context(svelteBuildOptions);

await svelteContext.rebuild();
startElectron();
watchSvelte();
watchTree('public', 'reload', (file) => file === 'generated' || file.startsWith(`generated${path.sep}`));
watchTree('server', 'restart');
watchTree('electron', 'restart');
watchRootFiles();
log('监听中：src-ui/public 刷新界面，server/electron 重启应用');

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
