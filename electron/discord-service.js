/**
 * [INPUT]: 依赖 discord.js 客户端、Mado 已登记项目、Pi RPC 会话、诊断服务与 Discord 配置
 * [OUTPUT]: 对外提供 createDiscordService，提供单用户 /new、/status、/stop、/result 与 Thread 内自然语言对话
 * [POS]: electron 的 Discord 远程入口编排器；一个 Thread 只绑定一个全新的 Pi 会话
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
'use strict';
const { Client, GatewayIntentBits, Events, REST, Routes, PermissionFlagsBits } = require('discord.js');
const { createPiRpcSession } = require('./pi-rpc-service');
const COMMANDS = [
  { name: 'new', description: '在指定的 Mado 项目中创建新的 Pi 会话', options: [{ type: 3, name: 'project', description: 'Mado 中已登记的项目名称', required: true }] },
  { name: 'status', description: '查看当前远程 Pi 会话状态' },
  { name: 'stop', description: '停止当前 Thread 的 Pi 会话' },
  { name: 'result', description: '重新查看当前 Thread 的最后总结' },
];
const MAX_PROMPT = 12000;
const MAX_REPLY = 1900;

function createDiscordService({ config, listProjects, diagnostics, makePiSession = createPiRpcSession, ClientClass = Client, RestClass = REST, RoutesApi = Routes }) {
  const sessions = new Map();
  let client = null;
  let started = false;
  function owner(interaction) {
    return interaction.guildId === config.guildId && interaction.user?.id === config.ownerUserId && (!config.channelId || interaction.channelId === config.channelId || interaction.channel?.parentId === config.channelId);
  }
  function safe(text) { return diagnostics.redact(String(text || '')).slice(0, MAX_REPLY); }
  async function reply(target, content) {
    const payload = typeof content === 'string' ? { content: safe(content), allowedMentions: { parse: [] } } : { ...content, allowedMentions: { parse: [] } };
    try {
      if (target.deferred || target.replied) return await target.editReply(payload);
      return await target.reply(payload);
    } catch (error) { diagnostics.error('DISCORD_SEND_FAILED', error, { sessionId: target.sessionId }); return null; }
  }
  async function sendThread(thread, content, session) {
    try { return await thread.send({ content: safe(content), allowedMentions: { parse: [] } }); }
    catch (error) { diagnostics.error('DISCORD_SEND_FAILED', error, { sessionId: session?.id, threadId: thread?.id }); return null; }
  }
  function find(threadId) { return sessions.get(threadId); }
  function failSession(session, event) {
    session.status = 'failed';
    if (event.errorId) session.errorId = event.errorId;
    session.lastError = event.errorId ? `错误编号：${event.errorId}` : 'Pi 任务失败';
    if (session.thread) void sendThread(session.thread, `❌ Pi 任务失败\n${session.lastError}`, session);
  }
  async function startSession(project, thread) {
    const id = `discord-${thread.id}`;
    const session = { id, threadId: thread.id, projectName: project.name, projectPath: project.path, status: 'starting', thread, lastResult: '', errorId: '', lastError: '', createdAt: Date.now(), busy: false };
    sessions.set(thread.id, session);
    const pi = makePiSession({ cwd: project.path, piPath: config.piPath, diagnostics, sessionId: id, onEvent: (event) => {
      if (event.type === 'failed') failSession(session, event);
      if (event.type === 'completed') { session.status = 'completed'; session.busy = false; session.lastResult = event.text; void sendThread(thread, `✅ Pi 任务完成\n\n${event.text}`, session); }
    }});
    session.pi = pi;
    try {
      await pi.start();
      session.status = 'idle';
      await sendThread(thread, `🟢 Pi 已就绪\n项目：${project.name}\n发送任务即可开始。`, session);
    } catch (error) {
      session.status = 'failed';
      const errorId = diagnostics.error('DISCORD_SESSION_START_FAILED', error, { sessionId: id, project: project.name });
      session.errorId = errorId;
      await sendThread(thread, `❌ Pi 启动失败\n错误编号：${errorId}`, session);
    }
    return session;
  }
  async function projectByName(name) {
    const result = await listProjects();
    if (!result?.ok) throw new Error('无法读取 Mado 项目列表');
    return result.projects.find((project) => project.available && project.name === name);
  }
  async function handleNew(interaction) {
    const name = interaction.options.getString('project', true);
    const project = await projectByName(name);
    if (!project) return reply(interaction, `找不到可用项目「${name}」。请先在 Mado 中添加项目。`);
    const channel = interaction.channel;
    if (!channel?.isTextBased?.() || !channel.threads?.create) return reply(interaction, '当前频道不支持创建任务 Thread。');
    const thread = await channel.threads.create({ name: `pi-${project.name}-${new Date().toISOString().slice(11, 16).replace(':', '')}`, autoArchiveDuration: 1440, reason: 'Mado remote Pi session' });
    const session = await startSession(project, thread);
    return reply(interaction, `已创建新的 Pi 会话：${thread}\n项目：${project.name}\n状态：${session.status}`);
  }
  async function handleInteraction(interaction) {
    if (!owner(interaction)) return reply(interaction, '没有权限使用 Mado Discord Bot。');
    try {
      if (!interaction.isChatInputCommand()) return;
      const isNew = interaction.commandName === 'new';
      const session = find(interaction.channelId);
      // 主频道没有会话时直接回复，不能先 defer 后再走无会话分支，否则部分 Discord 客户端会显示「应用程序未响应」。
      if (!isNew && !session) return reply(interaction, '当前频道没有 Mado 会话，请进入 Bot 创建的子区后再使用此命令。');
      if (!interaction.replied && !interaction.deferred) await interaction.deferReply();
      if (isNew) return handleNew(interaction);
      if (interaction.commandName === 'status') return reply(interaction, `项目：${session.projectName}\nAgent：Pi\n状态：${session.status}${session.errorId ? `\n错误编号：${session.errorId}` : ''}`);
      if (interaction.commandName === 'result') return reply(interaction, session.lastResult ? `最后总结：\n\n${session.lastResult}` : '当前会话还没有执行总结。');
      if (interaction.commandName === 'stop') { await session.pi.stop(); session.status = 'stopped'; session.busy = false; return reply(interaction, '已停止当前 Pi 会话。'); }
    } catch (error) {
      const errorId = diagnostics.error('DISCORD_COMMAND_FAILED', error, { command: interaction.commandName });
      return reply(interaction, `操作失败。错误编号：${errorId}`);
    }
  }
  async function handleMessage(message) {
    if (message.author?.bot || !message.guildId || message.guildId !== config.guildId || message.author.id !== config.ownerUserId) return;
    const session = find(message.channelId);
    if (!session) return;
    const text = String(message.content || '').trim();
    if (!text || text.startsWith('/') || text.length > MAX_PROMPT) { if (text.length > MAX_PROMPT) await sendThread(message.channel, '任务太长，请控制在 12000 字符以内。', session); return; }
    if (session.status === 'starting') return sendThread(message.channel, 'Pi 还在启动，请稍后再发送。', session);
    if (session.status === 'failed' || session.status === 'stopped') return sendThread(message.channel, '当前会话已经结束，请重新使用 /new。', session);
    if (session.busy) return sendThread(message.channel, 'Pi 正在处理上一条任务，请等待最终总结后再发送。', session);
    session.busy = true; session.status = 'running';
    await sendThread(message.channel, '⏳ Pi 正在处理任务，完成后会发送最终总结。', session);
    try { await session.pi.prompt(text); }
    catch (error) { session.busy = false; session.status = 'failed'; const errorId = diagnostics.error('DISCORD_PROMPT_FAILED', error, { sessionId: session.id }); session.errorId = errorId; await sendThread(message.channel, `❌ 任务发送失败\n错误编号：${errorId}`, session); }
  }
  async function registerCommands() {
    const rest = new RestClass({ version: '10' }).setToken(config.token);
    await rest.put(RoutesApi.applicationGuildCommands(client.user.id, config.guildId), { body: COMMANDS });
  }
  async function start() {
    if (started) return { ok: true };
    started = true;
    try {
      client = new ClientClass({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });
      client.on(Events.InteractionCreate, (interaction) => void handleInteraction(interaction));
      client.on(Events.MessageCreate, (message) => void handleMessage(message));
      client.on(Events.Error, (error) => diagnostics.error('DISCORD_CLIENT_ERROR', error));
      const ready = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Discord Gateway 连接超时')), 30000);
        client.once(Events.ClientReady, () => { clearTimeout(timer); diagnostics.record('info', 'DISCORD_READY', { userId: client.user.id, guildId: config.guildId }); resolve(); });
      });
      await client.login(config.token);
      await ready;
      await registerCommands();
      return { ok: true };
    } catch (error) {
      started = false;
      const errorId = diagnostics.error('DISCORD_START_FAILED', error);
      try { await client?.destroy(); } catch { /* 登录失败时无需阻断应用退出 */ }
      client = null;
      return { ok: false, error: error.message, errorId };
    }
  }
  async function stop() {
    for (const session of sessions.values()) { try { await session.pi.stop(); } catch { /* */ } session.status = 'stopped'; }
    sessions.clear();
    if (client) await client.destroy();
    client = null; started = false;
  }
  function snapshot() { return [...sessions.values()].map(({ pi, thread, lastResult, ...item }) => ({ ...item, hasResult: !!lastResult })); }
  return { start, stop, snapshot, sessions, handleInteraction, handleMessage };
}
module.exports = { COMMANDS, createDiscordService };
