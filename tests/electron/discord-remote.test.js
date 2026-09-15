/**
 * [INPUT]: 依赖 Node 内置测试、临时目录、Discord 远程领域服务与会话仓储
 * [OUTPUT]: 对外提供 Discord 配置、诊断脱敏、Pi RPC 错误路径与 Thread 轮次状态机回归验证
 * [POS]: tests/electron 的 Discord 远程功能测试，保护单用户入口、错误收集契约与失败后可续发消息
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadDiscordConfig } = require('../../electron/discord-config');
const { createDiscordDiagnostics } = require('../../electron/discord-diagnostics');
const { createDiscordService } = require('../../electron/discord-service');
const { createDiscordSessionStore } = require('../../electron/discord-session-store');

test('Discord 配置默认关闭且不要求密钥', () => {
  assert.deepEqual(loadDiscordConfig({ home: fs.mkdtempSync(path.join(os.tmpdir(), 'mado-discord-')), env: {} }), { enabled: false });
});

test('Discord 配置拒绝非绝对 pi 路径', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mado-discord-'));
  assert.throws(() => loadDiscordConfig({ home, env: {
    MADO_DISCORD_ENABLED: '1', DISCORD_BOT_TOKEN: 'secret', DISCORD_GUILD_ID: '123456789012345678',
    DISCORD_CHANNEL_ID: '123456789012345679', DISCORD_OWNER_USER_ID: '123456789012345680', MADO_DISCORD_PI_PATH: 'pi',
  } }), /绝对路径/);
});

test('诊断记录提供错误编号并脱敏凭据与主目录', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mado-discord-log-'));
  const diagnostics = createDiscordDiagnostics({ directory, secrets: ['bot-secret'], versions: { mado: 'test' } });
  const errorId = diagnostics.error('TEST_FAILURE', new Error(`token=bot-secret at ${os.homedir()}/private`));
  const report = diagnostics.report();
  assert.match(errorId, /^[0-9a-f]{8}$/);
  assert.doesNotMatch(report, /bot-secret/);
  assert.doesNotMatch(report, new RegExp(os.homedir().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(report, /TEST_FAILURE/);
  assert.match(fs.readFileSync(path.join(directory, 'events.jsonl'), 'utf8'), /TEST_FAILURE/);
});

// ---------- Thread 轮次状态机 ----------

const CONFIG = Object.freeze({
  enabled: true,
  token: 'test-token',
  guildId: '111111111111111111',
  channelId: '222222222222222222',
  ownerUserId: '333333333333333333',
  piPath: '/bin/true',
});
const THREAD_ID = '444444444444444444';
const flush = () => new Promise((resolve) => setTimeout(resolve, 50));

function createProgressRecorder() {
  const instances = [];
  const factory = ({ onUpdate }) => {
    const instance = { onUpdate, events: [], stopped: false, event(event) { instance.events.push(event); }, stop() { instance.stopped = true; } };
    instances.push(instance);
    return instance;
  };
  return { factory, instances };
}

function createPiStub() {
  const created = [];
  const factory = (options) => {
    const session = {
      prompts: [],
      async start() { /* 假会话直接就绪 */ },
      async prompt(text) { session.prompts.push(text); },
      async stop() { session.stopped = true; },
      state: () => ({ sessionFile: options.sessionFile || path.join(options.sessionDir || os.tmpdir(), 'pi-session.jsonl'), sessionId: 'pi-session-1', model: { provider: 'test', id: 'test-model' } }),
      pid: () => process.pid,
      async lastText() { return ''; },
      emit: (event) => options.onEvent(event),
    };
    created.push(session);
    return session;
  };
  return { factory, created };
}

function createChannel(id) {
  const messages = [];
  const channel = {
    id,
    parentId: CONFIG.channelId,
    messages,
    isTextBased: () => true,
    sendTyping: async () => {},
    async send(payload) {
      const message = { content: String(payload?.content ?? ''), edits: [], async edit(next) { message.content = String(next?.content ?? ''); message.edits.push(message.content); return message; } };
      messages.push(message);
      return message;
    },
    threads: { create: async ({ name }) => { channel.threadName = name; channel.thread = createChannel(THREAD_ID); return channel.thread; } },
  };
  return channel;
}

function createFakeDiscord() {
  function FakeClient() {
    const readyHandlers = [];
    return {
      user: { id: '999999999999999999' },
      on() {},
      once(event, handler) { readyHandlers.push(handler); },
      async login() { for (const handler of readyHandlers) handler(); },
      async destroy() {},
    };
  }
  class FakeRest { setToken() { return this; } async put() {} }
  return { ClientClass: FakeClient, RestClass: FakeRest };
}

function userMessage(channel, content) {
  return { author: { id: CONFIG.ownerUserId, bot: false }, guildId: CONFIG.guildId, channelId: channel.id, channel, content, attachments: new Map() };
}

function createHarness({ file = '' } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mado-discord-lifecycle-'));
  const sessionStore = createDiscordSessionStore({ file: file || path.join(directory, 'discord-sessions.json') });
  const diagnostics = { record() {}, error: (code) => `err-${code}`, report: () => '', redact: (value) => String(value ?? '') };
  const progress = createProgressRecorder();
  const pi = createPiStub();
  const main = createChannel(CONFIG.channelId);
  const service = createDiscordService({
    config: CONFIG,
    listProjects: async () => ({ ok: true, projects: [{ name: 'demo', path: directory, available: true }] }),
    diagnostics,
    sessionStore,
    makePiSession: pi.factory,
    createProgress: progress.factory,
    ...createFakeDiscord(),
  });
  return { service, pi, progress, main, directory, sessionStore };
}

async function statusReply(harness) {
  const interaction = {
    guildId: CONFIG.guildId,
    channelId: THREAD_ID,
    user: { id: CONFIG.ownerUserId },
    channel: createChannel(THREAD_ID),
    commandName: 'status',
    deferred: false,
    replied: false,
    isAutocomplete: () => false,
    isChatInputCommand: () => true,
    options: { getString: () => '' },
    async deferReply() { interaction.deferred = true; },
    async reply(payload) { interaction.content = payload.content; return payload; },
    async editReply(payload) { interaction.content = payload.content; return payload; },
  };
  await harness.service.handleInteraction(interaction);
  return interaction.content;
}

async function openThread(harness) {
  const interaction = {
    guildId: CONFIG.guildId,
    channelId: CONFIG.channelId,
    user: { id: CONFIG.ownerUserId },
    channel: harness.main,
    commandName: 'new',
    deferred: false,
    replied: false,
    isAutocomplete: () => false,
    isChatInputCommand: () => true,
    options: { getString: (name) => (name === 'project' ? 'demo' : '') },
    async deferReply() { interaction.deferred = true; },
    async reply(payload) { interaction.deferred = true; return payload; },
    async editReply(payload) { return payload; },
  };
  await harness.service.handleInteraction(interaction);
  return harness.main.thread;
}

test('Pi 任务失败后清理轮次状态，重试消息不再被上一轮拦截', async () => {
  const harness = createHarness();
  try {
    const thread = await openThread(harness);
    const session = harness.service.sessions.get(THREAD_ID);
    assert.equal(session.status, 'idle');
    const firstPi = harness.pi.created[0];

    await harness.service.handleMessage(userMessage(thread, '跑一次构建'));
    assert.equal(session.status, 'running');
    assert.equal(firstPi.prompts.length, 1);

    firstPi.emit({ type: 'failed', code: 'PI_NO_FINAL_RESULT', errorId: 'deadbeef' });
    await flush();
    assert.equal(session.status, 'failed');
    assert.match(thread.messages.at(-1).content, /Pi 任务失败/);

    await harness.service.handleMessage(userMessage(thread, '重试'));
    assert.equal(session.status, 'running');
    assert.equal(harness.pi.created.length, 2, '失败会话应重新启动 Pi');
    assert.equal(harness.pi.created[1].prompts.length, 1, '重试消息应真正发给 Pi');
    assert.ok(!thread.messages.some((message) => /正在处理上一条任务/.test(message.content)), '不应再报上一轮未结束');

    assert.equal(harness.progress.instances[0].stopped, true, '出错轮的进度转发器应停掉');
    assert.equal(harness.progress.instances.length, 2, '重试轮应换用新进度转发器');
    harness.progress.instances[1].onUpdate('正在运行项目命令');
    await flush();
    assert.equal(thread.messages.at(-1).content, '正在运行项目命令');
  } finally { await harness.service.stop(); }
});

test('一轮结束后下一轮使用新的进度消息，不被上一轮停掉的转发器拖累', async () => {
  const harness = createHarness();
  try {
    const thread = await openThread(harness);
    const session = harness.service.sessions.get(THREAD_ID);
    const pi = harness.pi.created[0];

    await harness.service.handleMessage(userMessage(thread, '第一轮'));
    harness.progress.instances[0].onUpdate('正在读取 index.js');
    await flush();
    const firstProgressMessage = thread.messages.at(-1);
    assert.equal(firstProgressMessage.content, '正在读取 index.js');

    pi.emit({ type: 'completed', text: '第一轮完成' });
    await flush();
    assert.equal(session.status, 'idle');
    assert.equal(thread.messages.at(-1).content, '第一轮完成');

    await harness.service.handleMessage(userMessage(thread, '第二轮'));
    assert.equal(harness.pi.created.length, 1, '正常完成不重启 Pi 会话');
    assert.equal(harness.progress.instances.length, 2, '每轮应有独立进度转发器');
    assert.equal(harness.progress.instances[0].stopped, true);
    harness.progress.instances[1].onUpdate('正在修改 app.js');
    await flush();
    assert.notEqual(thread.messages.at(-1), firstProgressMessage, '新进度应写入新消息');
    assert.equal(thread.messages.at(-1).content, '正在修改 app.js');
  } finally { await harness.service.stop(); }
});

test('失败重启后旧 Pi 的迟到事件不覆盖新一轮状态', async () => {
  const harness = createHarness();
  try {
    const thread = await openThread(harness);
    const session = harness.service.sessions.get(THREAD_ID);

    await harness.service.handleMessage(userMessage(thread, '第一轮'));
    const stalePi = harness.pi.created[0];
    stalePi.emit({ type: 'failed', code: 'PI_NO_FINAL_RESULT', errorId: 'deadbeef' });
    await flush();

    await harness.service.handleMessage(userMessage(thread, '重试'));
    assert.equal(session.status, 'running');
    assert.equal(harness.pi.created[1].prompts.length, 1);

    stalePi.emit({ type: 'failed', code: 'PI_NO_FINAL_RESULT', errorId: 'stale0001' });
    stalePi.emit({ type: 'completed', text: '陈旧结果' });
    await flush();

    assert.equal(session.status, 'running', '旧进程事件不得结束当前轮');
    assert.ok(!thread.messages.some((message) => message.content.includes('stale0001')));
    assert.ok(!thread.messages.some((message) => message.content === '陈旧结果'));
  } finally { await harness.service.stop(); }
});

test('Mado 重启后 /status 仍能看到上次失败原因与轮次', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mado-discord-restart-'));
  const file = path.join(directory, 'discord-sessions.json');
  const first = createHarness({ file });
  const thread = await openThread(first);
  const pi = first.pi.created[0];

  await first.service.handleMessage(userMessage(thread, '第一轮任务'));
  pi.emit({ type: 'failed', code: 'PI_NO_FINAL_RESULT', errorId: 'deadbeef' });
  await flush();
  await flush();
  // 不调用 stop()：模拟 Mado 异常退出后重新启动
  const persisted = await first.sessionStore.get(THREAD_ID);
  assert.equal(persisted.status, 'failed');
  assert.equal(persisted.errorId, 'deadbeef');
  assert.equal(persisted.turnId, 1);

  const second = createHarness({ file });
  try {
    assert.equal((await second.service.start()).ok, true);
    const session = second.service.sessions.get(THREAD_ID);
    assert.equal(session.status, 'failed', '失败状态应跨重启保留');
    assert.equal(session.errorId, 'deadbeef');
    assert.equal(session.turnId, 1, '轮次计数应跨重启保留');
    const status = await statusReply(second);
    assert.match(status, /状态：failed/);
    assert.match(status, /轮次：第 1 轮/);
    assert.match(status, /错误编号：deadbeef/);
  } finally { await second.service.stop(); }
});

test('运行到一半被强杀的会话恢复为 failed，并说明是中断', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mado-discord-crash-'));
  const file = path.join(directory, 'discord-sessions.json');
  const first = createHarness({ file });
  const thread = await openThread(first);

  await first.service.handleMessage(userMessage(thread, '一轮没跑完的任务'));
  await flush();
  assert.equal((await first.sessionStore.get(THREAD_ID)).status, 'running');
  clearInterval(first.service.sessions.get(THREAD_ID).typing.timer);

  const second = createHarness({ file });
  try {
    assert.equal((await second.service.start()).ok, true);
    const session = second.service.sessions.get(THREAD_ID);
    assert.equal(session.status, 'failed');
    assert.equal(session.errorId, '');
    assert.match(await statusReply(second), /状态：failed/);
  } finally { await second.service.stop(); }
});
