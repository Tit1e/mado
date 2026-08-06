/**
 * [INPUT]: 依赖 Node.js 测试库与 electron/pty-service.js 的注入式终端服务
 * [OUTPUT]: 验证 PTY 生命周期、事件转发、顶层命令标记、安全重启、前台进程与运行任务快照
 * [POS]: tests/electron 的终端领域服务单元测试，不启动 Electron 或真实 shell
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createPtyService, decodeLsofPath, foregroundProcessByPid } = require('../../electron/pty-service');

const SHELL_TOKEN = 'test-shell-token';
const commandStart = (command, token = SHELL_TOKEN) => `\x1b]777;mado;start;${token};${Buffer.from(command).toString('base64')}\x07`;
const commandEnd = (token = SHELL_TOKEN) => `\x1b]777;mado;end;${token}\x07`;

test('PTY 服务管理完整生命周期并转发数据与退出事件', async () => {
  const sent = [];
  const counts = [];
  let terminal;
  const pty = { spawn(shell, args, options) {
    terminal = {
      pid: 42,
      writes: [],
      sizes: [],
      write(value) { this.writes.push(value); },
      resize(cols, rows) { this.sizes.push([cols, rows]); },
      kill() { this.killed = true; },
      onData(handler) { this.dataHandler = handler; },
      onExit(handler) { this.exitHandler = handler; },
    };
    terminal.options = options;
    return terminal;
  } };
  const foregroundPids = [];
  const service = createPtyService({
    pty,
    send: (...args) => sent.push(args),
    onCountChange: (count) => counts.push(count),
    foregroundProcess: async (pid) => { foregroundPids.push(pid); return { ok: true, running: true }; },
  });
  assert.equal(service.spawn({ id: 'term_1', cwd: process.cwd(), cols: 90, rows: 30 }).ok, true);
  assert.deepEqual(service.spawn({ id: 'term_1', cwd: process.cwd() }), { ok: false, error: '终端 ID 已存在' });
  service.input({ id: 'term_1', data: 'pwd\n' });
  service.resize({ id: 'term_1', cols: 120, rows: 40 });
  terminal.dataHandler('hello');
  assert.deepEqual(terminal.writes, ['pwd\n']);
  assert.deepEqual(terminal.sizes, [[120, 40]]);
  assert.deepEqual(sent[0], ['pty:data', { id: 'term_1', data: 'hello' }]);
  assert.deepEqual(await service.hasForegroundProcess({ id: 'term_1' }), { ok: true, running: true });
  assert.deepEqual(foregroundPids, [42]);
  terminal.exitHandler({ exitCode: 0 });
  assert.deepEqual(counts, [1, 0]);
  assert.deepEqual(sent[1], ['pty:exit', { id: 'term_1', exitCode: 0 }]);
});

test('前台进程查询拒绝非法或不存在的终端', async () => {
  const service = createPtyService({ pty: null });
  assert.deepEqual(await service.hasForegroundProcess({ id: '../bad' }), { ok: false, running: false });
  assert.deepEqual(await service.hasForegroundProcess({ id: 'missing' }), { ok: false, running: false });
});

test('运行任务统计只计算确认存在前台进程的终端', async () => {
  let nextPid = 40;
  const pty = { spawn() {
    const terminal = {
      pid: ++nextPid,
      write() {}, resize() {}, kill() {}, onData() {}, onExit() {},
    };
    return terminal;
  } };
  const service = createPtyService({
    pty,
    foregroundProcess: async (pid) => {
      if (pid === 42) return { ok: true, running: true };
      if (pid === 43) return { ok: false, running: false };
      if (pid === 44) throw new Error('ps failed');
      return { ok: true, running: false };
    },
  });
  for (let index = 1; index <= 4; index++) {
    assert.equal(service.spawn({ id: `term_${index}`, cwd: process.cwd() }).ok, true);
  }
  assert.equal(await service.countRunningTasks(), 1);
  service.killAll();
  assert.equal(await service.countRunningTasks(), 0);
});

test('运行任务快照包含 Shell 集成捕获的原始顶层命令', async () => {
  let terminal;
  const pty = { spawn() {
    terminal = { pid: 71, write() {}, resize() {}, kill() {}, onData(handler) { this.dataHandler = handler; }, onExit() {} };
    return terminal;
  } };
  const service = createPtyService({
    pty,
    foregroundProcess: async () => ({ ok: true, running: true }),
    cwdLookup: async () => '/tmp/mado-project',
    createShellToken: () => SHELL_TOKEN,
  });
  service.spawn({ id: 'tracked', cwd: process.cwd() });
  terminal.dataHandler(commandStart('npm run dev'));
  assert.deepEqual(await service.runningTaskSnapshots(), [{ running: true, cwd: '/tmp/mado-project', command: 'npm run dev', title: 'mado-project' }]);
  terminal.dataHandler(commandEnd());
  assert.equal((await service.runningTaskSnapshots())[0].command, '');
});

test('运行服务快照保留规则标识，恢复时不会与同目录其他命令混淆', async () => {
  let terminal;
  const pty = { spawn() {
    terminal = { pid: 72, write() {}, resize() {}, kill() {}, onData(handler) { this.dataHandler = handler; }, onExit() {} };
    return terminal;
  } };
  const service = createPtyService({
    pty,
    foregroundProcess: async () => ({ ok: true, running: true }),
    cwdLookup: async () => '/tmp/mado-project',
    createShellToken: () => SHELL_TOKEN,
  });
  assert.equal(service.spawn({ id: 'service_1', cwd: process.cwd(), kind: 'service', serviceKey: 'rule_12345678' }).ok, true);
  terminal.dataHandler(commandStart('pnpm dev'));
  assert.deepEqual(await service.runningTaskSnapshots(), [{
    running: true, cwd: '/tmp/mado-project', command: 'pnpm dev', title: 'mado-project', kind: 'service', serviceKey: 'rule_12345678',
  }]);
  assert.deepEqual(service.spawn({ id: 'service_2', cwd: process.cwd(), kind: 'service', serviceKey: '../bad' }), { ok: false, error: '运行服务标识非法' });
});

test('重新运行会先中断前台命令，等待 Shell 空闲后再执行原命令', async () => {
  let terminal;
  const pty = { spawn() {
    terminal = {
      pid: 81, writes: [], write(value) { this.writes.push(value); }, resize() {}, kill() {},
      onData(handler) { this.dataHandler = handler; }, onExit(handler) { this.exitHandler = handler; },
    };
    return terminal;
  } };
  const service = createPtyService({
    pty,
    foregroundProcess: async () => ({ ok: true, running: true }),
    restartTimeoutMs: 1000,
    createShellToken: () => SHELL_TOKEN,
  });
  service.spawn({ id: 'restartable', cwd: process.cwd() });
  terminal.dataHandler(commandStart('pnpm dev'));

  const restarting = service.restartCommand({ id: 'restartable' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(terminal.writes, ['\x03']);
  terminal.dataHandler(commandEnd());
  assert.deepEqual(terminal.writes, ['\x03', 'pnpm dev\r']);
  terminal.dataHandler(commandStart('pnpm dev'));
  assert.deepEqual(await restarting, { ok: true });
});

test('重新运行期间拒绝重复请求', async () => {
  let terminal;
  const pty = { spawn() {
    terminal = {
      pid: 82, write() {}, resize() {}, kill() {},
      onData(handler) { this.dataHandler = handler; }, onExit() {},
    };
    return terminal;
  } };
  const service = createPtyService({
    pty,
    foregroundProcess: async () => ({ ok: true, running: true }),
    restartTimeoutMs: 1000,
    createShellToken: () => SHELL_TOKEN,
  });
  service.spawn({ id: 'duplicate', cwd: process.cwd() });
  terminal.dataHandler(commandStart('npm run dev'));
  const first = service.restartCommand({ id: 'duplicate' });
  const second = service.restartCommand({ id: 'duplicate' });
  assert.deepEqual(await second, { ok: false, error: '当前命令正在重新运行' });
  terminal.dataHandler(commandEnd());
  terminal.dataHandler(commandStart('npm run dev'));
  assert.deepEqual(await first, { ok: true });
});

test('没有已记录前台命令时不会猜测 Shell 历史', async () => {
  let terminal;
  const pty = { spawn() {
    terminal = { pid: 83, writes: [], write(value) { this.writes.push(value); }, resize() {}, kill() {}, onData() {}, onExit() {} };
    return terminal;
  } };
  const service = createPtyService({ pty, foregroundProcess: async () => ({ ok: true, running: true }) });
  service.spawn({ id: 'untracked', cwd: process.cwd() });
  assert.deepEqual(await service.restartCommand({ id: 'untracked' }), { ok: false, error: '当前终端没有可重新运行的命令' });
  assert.deepEqual(terminal.writes, []);
});

test('已记录命令但没有前台进程时不会重新运行', async () => {
  let terminal;
  const pty = { spawn() {
    terminal = {
      pid: 84, writes: [], write(value) { this.writes.push(value); }, resize() {}, kill() {},
      onData(handler) { this.dataHandler = handler; }, onExit() {},
    };
    return terminal;
  } };
  const service = createPtyService({
    pty,
    foregroundProcess: async () => ({ ok: true, running: false }),
    createShellToken: () => SHELL_TOKEN,
  });
  service.spawn({ id: 'idle', cwd: process.cwd() });
  terminal.dataHandler(commandStart('pnpm dev'));
  assert.deepEqual(await service.restartCommand({ id: 'idle' }), { ok: false, error: '当前终端没有正在运行的命令' });
  assert.deepEqual(terminal.writes, []);
});

test('未认证的终端输出不能覆盖或重放本机 Shell 命令', async () => {
  let terminal;
  const pty = { spawn() {
    terminal = {
      pid: 85, writes: [], write(value) { this.writes.push(value); }, resize() {}, kill() {},
      onData(handler) { this.dataHandler = handler; }, onExit() {},
    };
    return terminal;
  } };
  const service = createPtyService({
    pty,
    foregroundProcess: async () => ({ ok: true, running: true }),
    createShellToken: () => SHELL_TOKEN,
  });
  service.spawn({ id: 'forged', cwd: process.cwd() });
  terminal.dataHandler(commandStart('printf PWNED_FROM_REMOTE', 'forged-token'));
  assert.deepEqual(await service.restartCommand({ id: 'forged' }), { ok: false, error: '当前终端没有可重新运行的命令' });
  assert.deepEqual(terminal.writes, []);
});

test('重启等待期间收到新输入会取消自动重放', async () => {
  let terminal;
  const pty = { spawn() {
    terminal = {
      pid: 86, writes: [], write(value) { this.writes.push(value); }, resize() {}, kill() {},
      onData(handler) { this.dataHandler = handler; }, onExit() {},
    };
    return terminal;
  } };
  const service = createPtyService({
    pty,
    foregroundProcess: async () => ({ ok: true, running: true }),
    restartTimeoutMs: 1000,
    createShellToken: () => SHELL_TOKEN,
  });
  service.spawn({ id: 'interleaved', cwd: process.cwd() });
  terminal.dataHandler(commandStart('pnpm dev'));
  const restarting = service.restartCommand({ id: 'interleaved' });
  await new Promise((resolve) => setImmediate(resolve));
  service.input({ id: 'interleaved', data: 'echo INTERLEAVED' });
  assert.deepEqual(await restarting, { ok: false, error: '检测到新的终端输入，已取消重新运行' });
  terminal.dataHandler(commandEnd());
  assert.deepEqual(terminal.writes, ['\x03', 'echo INTERLEAVED']);
});

test('命令没有及时停止时取消重跑，终端退出也会结束等待', async () => {
  const terminals = [];
  const pty = { spawn() {
    const terminal = {
      pid: 90 + terminals.length, writes: [], write(value) { this.writes.push(value); }, resize() {}, kill() {},
      onData(handler) { this.dataHandler = handler; }, onExit(handler) { this.exitHandler = handler; },
    };
    terminals.push(terminal);
    return terminal;
  } };
  const service = createPtyService({
    pty,
    foregroundProcess: async () => ({ ok: true, running: true }),
    restartTimeoutMs: 10,
    createShellToken: () => SHELL_TOKEN,
  });
  service.spawn({ id: 'timeout', cwd: process.cwd() });
  terminals[0].dataHandler(commandStart('pnpm dev'));
  assert.deepEqual(await service.restartCommand({ id: 'timeout' }), { ok: false, error: '命令未在 1 秒内停止，已取消重新运行' });
  assert.deepEqual(terminals[0].writes, ['\x03']);

  service.spawn({ id: 'exiting', cwd: process.cwd() });
  terminals[1].dataHandler(commandStart('vite'));
  const exiting = service.restartCommand({ id: 'exiting' });
  await new Promise((resolve) => setImmediate(resolve));
  terminals[1].exitHandler({ exitCode: 130 });
  assert.deepEqual(await exiting, { ok: false, error: '终端已退出，无法重新运行命令' });
});

test('前台进程组区别于 Shell 进程组时识别为运行中', async () => {
  const idle = await foregroundProcessByPid(42, (file, args, options, cb) => cb(null, ' 42 42\n'));
  const running = await foregroundProcessByPid(42, (file, args, options, cb) => cb(null, ' 42 99\n'));
  const unknown = await foregroundProcessByPid(42, (file, args, options, cb) => cb(new Error('ps failed'), ''));
  assert.deepEqual(idle, { ok: true, running: false });
  assert.deepEqual(running, { ok: true, running: true });
  assert.deepEqual(unknown, { ok: false, running: false });
});

test('lsof 路径解码恢复 UTF-8 中文目录', () => {
  assert.equal(decodeLsofPath('/tmp/\\xe4\\xb8\\xad\\xe6\\x96\\x87'), '/tmp/中文');
});
