/**
 * [INPUT]: 依赖 node-pty、Node.js 文件/进程/随机数能力、shell-integration.js 与 ipc-validation.js 安全契约
 * [OUTPUT]: 对外提供 createPtyService，统一管理终端、带规则标识的服务会话、认证命令追踪、安全重启、运行任务快照和销毁
 * [POS]: electron 模块的终端领域服务，由 main.js 装配并被 IPC 处理器调用
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');
const { randomBytes } = require('crypto');
const { exec, execFile } = require('child_process');
const { validPtyId, validServiceKey, normalizeTerminalSize, validPtyInput, validDirectory } = require('./ipc-validation');
const { consumeShellMarkers } = require('./shell-integration');

function decodeLsofPath(value) {
  if (!/\\x[0-9a-fA-F]{2}/.test(value)) return value;
  const bytes = [];
  for (let i = 0; i < value.length; i++) {
    if (value[i] === '\\' && value[i + 1] === 'x' && /^[0-9a-fA-F]{2}$/.test(value.slice(i + 2, i + 4))) {
      bytes.push(parseInt(value.slice(i + 2, i + 4), 16));
      i += 3;
    } else bytes.push(...Buffer.from(value[i], 'utf8'));
  }
  return Buffer.from(bytes).toString('utf8');
}

function termCwdByPid(pid, run = exec) {
  return new Promise((resolve) => {
    if (!pid) return resolve('');
    run(`lsof -a -p ${pid} -d cwd -Fn`, { env: { ...process.env, LC_ALL: 'en_US.UTF-8' }, timeout: 3000 }, (err, stdout) => {
      if (err) return resolve('');
      const line = (stdout || '').split('\n').find((item) => item.startsWith('n'));
      resolve(line ? decodeLsofPath(line.slice(1)) : '');
    });
  });
}

function foregroundProcessByPid(pid, run = execFile) {
  return new Promise((resolve) => {
    if (!pid || process.platform === 'win32') return resolve({ ok: false, running: false });
    run('/bin/ps', ['-o', 'pgid=', '-o', 'tpgid=', '-p', String(pid)], { timeout: 3000 }, (err, stdout) => {
      if (err) return resolve({ ok: false, running: false });
      const values = String(stdout || '').trim().split(/\s+/).map(Number);
      const [shellGroup, foregroundGroup] = values;
      if (!Number.isInteger(shellGroup) || !Number.isInteger(foregroundGroup) || foregroundGroup <= 0) {
        return resolve({ ok: false, running: false });
      }
      resolve({ ok: true, running: foregroundGroup !== shellGroup });
    });
  });
}

function createPtyService({ pty, send = () => {}, onCountChange = () => {}, foregroundProcess = foregroundProcessByPid, cwdLookup = termCwdByPid, zshIntegration = null, restartTimeoutMs = 8000, createShellToken = () => randomBytes(24).toString('hex') }) {
  const terminals = new Map();
  const notifyCount = () => onCountChange(terminals.size);

  function finishRestart(record, result) {
    const pending = record && record.restart;
    if (!pending) return;
    record.restart = null;
    clearTimeout(pending.timer);
    pending.resolve(result);
  }

  function spawn({ id, cwd, cols, rows, kind, serviceKey }) {
    if (!pty) return { ok: false, error: 'node-pty 未编译，跑：npm run rebuild' };
    if (!validPtyId(id)) return { ok: false, error: '终端 ID 非法' };
    if (terminals.has(id)) return { ok: false, error: '终端 ID 已存在' };
    const isService = kind === 'service';
    if (isService && !validServiceKey(serviceKey)) return { ok: false, error: '运行服务标识非法' };
    const shellPath = process.env.SHELL || (process.platform === 'win32' ? 'powershell.exe' : '/bin/zsh');
    const startCwd = validDirectory(cwd, fs) ? path.resolve(cwd) : os.homedir();
    const size = normalizeTerminalSize(cols, rows);
    const env = { ...process.env, TERM: 'xterm-256color', MADO: '1' };
    const markerToken = createShellToken();
    delete env.MADO_SHELL_TOKEN;
    if (zshIntegration && path.basename(shellPath) === 'zsh') {
      env.ZDOTDIR = zshIntegration.dir;
      env.MADO_ORIGINAL_ZDOTDIR = zshIntegration.originalZdotdir;
      env.MADO_SHELL_TOKEN = markerToken;
    }
    delete env.MADO_PORT;
    delete env.MADO_DEV_PORT;
    delete env.MADO_NO_OPEN;
    if (!/UTF-8/i.test(env.LC_ALL || env.LC_CTYPE || env.LANG || '')) env.LANG = 'zh_CN.UTF-8';
    let terminal;
    try {
      terminal = pty.spawn(shellPath, process.platform === 'win32' ? [] : ['-l'], {
        name: 'xterm-256color', cols: size.cols, rows: size.rows, cwd: startCwd, env,
      });
    } catch (err) { return { ok: false, error: err.message }; }
    const record = { terminal, startCwd, command: '', kind: isService ? 'service' : 'terminal', serviceKey: isService ? serviceKey : '', markerToken, markerState: { carry: '' }, restart: null };
    terminals.set(id, record);
    notifyCount();
    terminal.onData((data) => {
      const visible = consumeShellMarkers(record.markerState, data, record.markerToken, (marker) => {
        record.command = marker.type === 'start' && !/^\s/.test(marker.command) ? marker.command : '';
        const pending = record.restart;
        if (!pending) return;
        if (marker.type === 'end' && pending.phase === 'interrupting') {
          pending.phase = 'starting';
          try { record.terminal.write(pending.command + '\r'); }
          catch { finishRestart(record, { ok: false, error: '重新执行命令失败' }); }
        } else if (marker.type === 'start' && pending.phase === 'starting') {
          finishRestart(record, marker.command === pending.command
            ? { ok: true }
            : { ok: false, error: '终端命令状态已变化，已取消重新运行' });
        }
      });
      if (visible) send('pty:data', { id, data: visible });
    });
    terminal.onExit(({ exitCode }) => {
      finishRestart(record, { ok: false, error: '终端已退出，无法重新运行命令' });
      terminals.delete(id);
      notifyCount();
      send('pty:exit', { id, exitCode });
    });
    return { ok: true, cwd: startCwd };
  }

  function input({ id, data }) {
    if (!validPtyId(id) || !validPtyInput(data)) return;
    const record = terminals.get(id);
    if (!record) return;
    if (record.restart) finishRestart(record, { ok: false, error: '检测到新的终端输入，已取消重新运行' });
    record.terminal.write(data);
  }

  function resize({ id, cols, rows }) {
    if (!validPtyId(id)) return;
    const record = terminals.get(id);
    if (!record) return;
    const size = normalizeTerminalSize(cols, rows);
    try { record.terminal.resize(size.cols, size.rows); } catch { /* 终端可能刚退出 */ }
  }

  function kill({ id }) {
    if (!validPtyId(id)) return;
    const record = terminals.get(id);
    if (!record) return;
    finishRestart(record, { ok: false, error: '终端已关闭，无法重新运行命令' });
    try { record.terminal.kill(); } catch { /* 终端可能刚退出 */ }
    terminals.delete(id);
    notifyCount();
  }

  async function cwd({ id }) {
    if (!validPtyId(id)) return { ok: false };
    const record = terminals.get(id);
    if (!record || !record.terminal.pid) return { ok: false };
    const value = await cwdLookup(record.terminal.pid);
    return value ? { ok: true, cwd: value } : { ok: false };
  }

  async function hasForegroundProcess({ id }) {
    if (!validPtyId(id)) return { ok: false, running: false };
    const record = terminals.get(id);
    if (!record || !record.terminal.pid) return { ok: false, running: false };
    return foregroundProcess(record.terminal.pid);
  }

  async function restartCommand({ id }) {
    if (!validPtyId(id)) return { ok: false, error: '终端 ID 非法' };
    const record = terminals.get(id);
    if (!record || !record.terminal.pid) return { ok: false, error: '当前终端不可用' };
    if (record.restart) return { ok: false, error: '当前命令正在重新运行' };
    const command = record.command;
    if (!command) return { ok: false, error: '当前终端没有可重新运行的命令' };
    let foreground;
    try { foreground = await foregroundProcess(record.terminal.pid); }
    catch { foreground = { ok: false, running: false }; }
    if (terminals.get(id) !== record || record.command !== command) {
      return { ok: false, error: '终端命令状态已变化，请重试' };
    }
    if (record.restart) return { ok: false, error: '当前命令正在重新运行' };
    if (!foreground.ok) return { ok: false, error: '无法确认当前命令是否仍在运行' };
    if (!foreground.running) return { ok: false, error: '当前终端没有正在运行的命令' };
    return new Promise((resolve) => {
      const pending = { command, phase: 'interrupting', timer: null, resolve };
      record.restart = pending;
      pending.timer = setTimeout(() => {
        const seconds = Math.max(1, Math.ceil(restartTimeoutMs / 1000));
        finishRestart(record, { ok: false, error: `命令未在 ${seconds} 秒内停止，已取消重新运行` });
      }, restartTimeoutMs);
      try { record.terminal.write('\x03'); }
      catch { finishRestart(record, { ok: false, error: '无法中断当前命令' }); }
    });
  }

  async function countRunningTasks() {
    const checks = [...terminals.values()].map(async ({ terminal }) => {
      if (!terminal.pid) return false;
      try {
        const result = await foregroundProcess(terminal.pid);
        return result.ok === true && result.running === true;
      } catch { return false; }
    });
    const results = await Promise.all(checks);
    return results.filter(Boolean).length;
  }

  async function runningTaskSnapshots() {
    const snapshots = await Promise.all([...terminals.values()].map(async (record) => {
      if (!record.terminal.pid) return null;
      try {
        const result = await foregroundProcess(record.terminal.pid);
        if (!result.ok || !result.running) return null;
        const cwdValue = await cwdLookup(record.terminal.pid);
        return {
          running: true, cwd: cwdValue || record.startCwd, command: record.command,
          title: path.basename(cwdValue || record.startCwd) || 'shell',
          ...(record.kind === 'service' ? { kind: 'service', serviceKey: record.serviceKey } : {}),
        };
      } catch { return null; }
    }));
    return snapshots.filter(Boolean);
  }

  function killAll() {
    terminals.forEach((record) => {
      finishRestart(record, { ok: false, error: '终端已关闭，无法重新运行命令' });
      try { record.terminal.kill(); } catch { /* */ }
    });
    terminals.clear();
    notifyCount();
  }

  return { spawn, input, resize, kill, cwd, hasForegroundProcess, restartCommand, countRunningTasks, runningTaskSnapshots, killAll, count: () => terminals.size };
}

module.exports = { createPtyService, decodeLsofPath, termCwdByPid, foregroundProcessByPid };
