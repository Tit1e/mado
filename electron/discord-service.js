/**
 * [INPUT]: 依赖 discord.js 客户端、Mado 已登记项目、Pi RPC 会话、诊断服务与 Discord 配置
 * [OUTPUT]: 对外提供 createDiscordService，提供单用户 /new、/status、/stop、/result 与 Thread 内自然语言对话、项目自动补全
 * [POS]: electron 的 Discord 远程入口编排器；一个 Thread 永久绑定一个项目与可持久恢复的 Pi 会话
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
'use strict';
const path = require('path');
const fsp = require('fs/promises');
const { randomUUID } = require('crypto');
const { Client, GatewayIntentBits, Events, REST, Routes, PermissionFlagsBits } = require('discord.js');
const { createPiRpcSession } = require('./pi-rpc-service');
const { createDiscordSessionStore } = require('./discord-session-store');
const COMMANDS = [
  { name: 'new', description: '在指定的 Mado 项目中创建新的 Pi 会话', options: [{ type: 3, name: 'project', description: '选择 Mado 中已登记的项目', required: true, autocomplete: true }] },
  { name: 'status', description: '查看当前远程 Pi 会话状态' },
  { name: 'stop', description: '停止当前 Thread 的 Pi 会话' },
  { name: 'result', description: '重新查看当前 Thread 的最后总结' },
];
const MAX_PROMPT = 12000;
const MAX_REPLY = 1900;
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const MAX_ATTACHMENTS = 5;

function createDiscordService({ config, listProjects, diagnostics, sessionStore = createDiscordSessionStore(), makePiSession = createPiRpcSession, ClientClass = Client, RestClass = REST, RoutesApi = Routes }) {
  const sessions = new Map();
  const sessionDir = path.join(path.dirname(sessionStore.file), 'discord-sessions');
  let client = null;
  let started = false;
  let bridgeLock = null;
  function owner(interaction) {
    return interaction.guildId === config.guildId && interaction.user?.id === config.ownerUserId && (!config.channelId || interaction.channelId === config.channelId || interaction.channel?.parentId === config.channelId);
  }
  function safe(text) { return diagnostics.redact(String(text || '')).slice(0, MAX_REPLY); }
  function attachmentsOf(message) { return [...(message.attachments?.values?.() || [])]; }
  async function downloadAttachments(message, session) {
    const attachments = attachmentsOf(message);
    if (attachments.length > MAX_ATTACHMENTS) throw new Error(`一条消息最多支持 ${MAX_ATTACHMENTS} 个附件`);
    const directory = path.join(path.dirname(sessionStore.file), 'discord-attachments', session.id);
    await fsp.mkdir(directory, { recursive: true, mode: 0o700 });
    const paths = [];
    for (const attachment of attachments) {
      let url;
      try { url = new URL(String(attachment.url)); } catch { throw new Error('Discord 附件地址无效'); }
      if (url.protocol !== 'https:' || !['cdn.discordapp.com', 'media.discordapp.net'].includes(url.hostname)) throw new Error('只允许下载 Discord CDN 附件');
      const declared = Number(attachment.size) || 0;
      if (declared > MAX_ATTACHMENT_BYTES) throw new Error('单个附件超过 25 MiB');
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60000);
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok || !response.body) throw new Error(`下载附件失败（HTTP ${response.status}）`);
        const length = Number(response.headers.get('content-length')) || declared;
        if (length > MAX_ATTACHMENT_BYTES) throw new Error('单个附件超过 25 MiB');
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length > MAX_ATTACHMENT_BYTES) throw new Error('单个附件超过 25 MiB');
        const original = path.basename(String(attachment.name || 'attachment'));
        const extension = path.extname(original).replace(/[^a-zA-Z0-9.]/g, '').slice(0, 12);
        const target = path.join(directory, `${randomUUID()}${extension}`);
        await fsp.writeFile(target, bytes, { mode: 0o600 });
        paths.push(target);
      } finally { clearTimeout(timeout); }
    }
    return paths;
  }
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
  async function stopSession(session) {
    const pi = session.pi;
    await pi?.stop();
    if (session.pi === pi) session.pi = null;
    await session.lock?.release();
    session.lock = null;
  }
  function failSession(session, event) {
    session.status = 'failed';
    if (event.errorId) session.errorId = event.errorId;
    session.lastError = event.errorId ? `错误编号：${event.errorId}` : 'Pi 任务失败';
    if (session.thread) void sendThread(session.thread, `❌ Pi 任务失败\n${session.lastError}`, session);
  }
  function makeSession(record, thread) {
    const session = { ...record, id: record.sessionId, thread, lastResult: '', errorId: '', lastError: '', busy: false, status: record.status || 'bound' };
    sessions.set(record.threadId, session);
    return session;
  }
  async function startPi(session, { announce = true } = {}) {
    if (session.pi && session.status !== 'stopped' && session.status !== 'failed') return session;
    if (session.pi) await stopSession(session);
    session.status = 'starting';
    const pi = makePiSession({ cwd: session.projectPath, piPath: config.piPath, sessionId: session.id, sessionFile: session.sessionFile, expectedSessionId: session.piSessionId, sessionDir: session.sessionFile ? '' : sessionDir, diagnostics, onEvent: (event) => {
      if (event.type === 'failed') failSession(session, event);
      if (event.type === 'completed') { session.status = 'idle'; session.busy = false; session.lastResult = event.text; void sessionStore.patch(session.threadId, { status: 'idle' }).catch((error) => diagnostics.error('DISCORD_SESSION_SAVE_FAILED', error, { sessionId: session.id })); void sendThread(session.thread, `✅ Pi 任务完成\n\n${event.text}`, session); }
    }});
    session.pi = pi;
    try {
      session.lock = await sessionStore.lock(session.threadId);
      await pi.start();
      await session.lock.child(pi.pid());
      const state = pi.state();
      session.status = 'idle';
      if (!session.sessionFile && state?.sessionFile) {
        session.sessionFile = state.sessionFile;
        session.piSessionId = state.sessionId || '';
        await sessionStore.patch(session.threadId, { sessionFile: session.sessionFile, piSessionId: session.piSessionId, status: 'idle' });
      } else {
        session.status = 'idle';
        await sessionStore.patch(session.threadId, { status: 'idle' });
      }
      if (announce) await sendThread(session.thread, `🟢 Pi 已就绪\n项目：${session.projectName}\n发送任务即可开始。`, session);
    } catch (error) {
      await stopSession(session);
      session.status = 'failed';
      const errorId = diagnostics.error('DISCORD_SESSION_START_FAILED', error, { sessionId: session.id, project: session.projectName });
      session.errorId = errorId;
      await sessionStore.patch(session.threadId, { status: 'failed' }).catch(() => {});
      await sendThread(session.thread, `❌ Pi 启动失败\n错误编号：${errorId}`, session);
    }
    return session;
  }
  async function createSession(project, thread) {
    const record = { threadId: thread.id, sessionId: `discord-${thread.id}`, projectName: project.name, projectPath: project.path, sessionFile: '', piSessionId: '', status: 'bound', createdAt: Date.now() };
    await sessionStore.put(record);
    return makeSession(record, thread);
  }
  async function availableProjects() {
    const result = await listProjects();
    if (!result?.ok) throw new Error('无法读取 Mado 项目列表');
    return (Array.isArray(result.projects) ? result.projects : []).filter((project) => project && project.available && typeof project.name === 'string');
  }
  async function projectByName(name) {
    return (await availableProjects()).find((project) => project.name === name);
  }
  async function handleAutocomplete(interaction) {
    try {
      if (interaction.commandName !== 'new' || !owner(interaction)) return interaction.respond([]);
      const query = String(interaction.options.getFocused() || '').trim().toLocaleLowerCase();
      const projects = await availableProjects();
      const seen = new Set();
      const choices = projects.filter((project) => {
        const key = project.name.toLocaleLowerCase();
        if (seen.has(key) || (query && !key.includes(query))) return false;
        seen.add(key); return true;
      }).slice(0, 25).map((project) => ({ name: project.name.slice(0, 100), value: project.name }));
      return interaction.respond(choices);
    } catch (error) {
      diagnostics.error('DISCORD_AUTOCOMPLETE_FAILED', error);
      try { return await interaction.respond([]); } catch { return null; }
    }
  }
  async function handleNew(interaction) {
    if (interaction.channelId !== config.channelId) return reply(interaction, '请回到主频道使用 /new 创建新的子区。');
    const name = interaction.options.getString('project', true);
    const project = await projectByName(name);
    if (!project) return reply(interaction, `找不到可用项目「${name}」。请先在 Mado 中添加项目。`);
    const channel = interaction.channel;
    if (!channel?.isTextBased?.() || !channel.threads?.create) return reply(interaction, '当前频道不支持创建任务 Thread。');
    const thread = await channel.threads.create({ name: `pi-${project.name}-${new Date().toISOString().slice(11, 16).replace(':', '')}`, autoArchiveDuration: 1440, reason: 'Mado remote Pi session' });
    const session = await createSession(project, thread);
    await startPi(session);
    return reply(interaction, `已创建新的 Pi 会话：${thread}\n项目：${project.name}\n状态：${session.status}`);
  }
  async function handleInteraction(interaction) {
    if (interaction.isAutocomplete?.()) return handleAutocomplete(interaction);
    if (!owner(interaction)) return reply(interaction, '没有权限使用 Mado Discord Bot。');
    try {
      if (!interaction.isChatInputCommand()) return;
      const isNew = interaction.commandName === 'new';
      const session = find(interaction.channelId);
      if (session) session.thread = interaction.channel;
      // 主频道没有会话时直接回复，不能先 defer 后再走无会话分支，否则部分 Discord 客户端会显示「应用程序未响应」。
      if (!isNew && !session) return reply(interaction, '当前频道没有 Mado 会话，请进入 Bot 创建的子区后再使用此命令。');
      if (!interaction.replied && !interaction.deferred) await interaction.deferReply();
      if (isNew) return handleNew(interaction);
      if (interaction.commandName === 'status') return reply(interaction, `项目：${session.projectName}\nAgent：Pi\n状态：${session.status}${session.errorId ? `\n错误编号：${session.errorId}` : ''}`);
      if (interaction.commandName === 'result') {
        if (session.busy || session.status === 'starting') return reply(interaction, 'Pi 正在处理任务，请等待本轮结束。');
        if (!session.lastResult) {
          await startPi(session, { announce: false });
          if (session.status === 'failed') return reply(interaction, `无法恢复原会话。错误编号：${session.errorId}`);
          session.lastResult = await session.pi.lastText();
        }
        return reply(interaction, session.lastResult ? `最后总结：\n\n${session.lastResult}` : '当前会话还没有执行总结。');
      }
      if (interaction.commandName === 'stop') { await stopSession(session); session.status = 'stopped'; session.busy = false; await sessionStore.patch(session.threadId, { status: 'stopped' }); return reply(interaction, '已停止当前 Pi 会话；会话绑定仍保留，之后发送消息可恢复原上下文。'); }
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
    const attachments = attachmentsOf(message);
    if ((!text && !attachments.length) || text.startsWith('/') || text.length > MAX_PROMPT) { if (text.length > MAX_PROMPT) await sendThread(message.channel, '任务太长，请控制在 12000 字符以内。', session); return; }
    session.thread = message.channel;
    if (session.status === 'starting') return sendThread(message.channel, 'Pi 还在启动，请稍后再发送。', session);
    if (session.busy) return sendThread(message.channel, 'Pi 正在处理上一条任务，请等待最终总结后再发送。', session);
    if (!session.pi || session.status === 'failed' || session.status === 'stopped' || session.status === 'bound') {
      await startPi(session, { announce: false });
      if (session.status === 'failed') return;
    }
    session.busy = true; session.status = 'running';
    await sendThread(message.channel, '⏳ Pi 正在处理任务，完成后会发送最终总结。', session);
    try {
      const files = await downloadAttachments(message, session);
      const prompt = `${text || '请处理我上传的附件。'}${files.length ? `\n\nDiscord 附件已下载到以下本地路径，请按需要读取或处理：\n${files.map((file) => `- ${file}`).join('\n')}` : ''}`;
      await session.pi.prompt(prompt);
    } catch (error) { session.busy = false; session.status = 'failed'; const errorId = diagnostics.error('DISCORD_PROMPT_FAILED', error, { sessionId: session.id }); session.errorId = errorId; await sendThread(message.channel, `❌ 任务发送失败\n错误编号：${errorId}`, session); }
  }
  async function registerCommands() {
    const rest = new RestClass({ version: '10' }).setToken(config.token);
    await rest.put(RoutesApi.applicationGuildCommands(client.user.id, config.guildId), { body: COMMANDS });
  }
  async function start() {
    if (started) return { ok: true };
    started = true;
    try {
      bridgeLock = await sessionStore.lock('bridge');
      for (const record of await sessionStore.list()) makeSession({ ...record, status: 'bound' }, null);
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
      await bridgeLock?.release(); bridgeLock = null;
      const errorId = diagnostics.error('DISCORD_START_FAILED', error);
      try { await client?.destroy(); } catch { /* 登录失败时无需阻断应用退出 */ }
      client = null;
      return { ok: false, error: error.message, errorId };
    }
  }
  async function stop() {
    await Promise.all([...sessions.values()].map(async (session) => { await stopSession(session); session.status = 'stopped'; await sessionStore.patch(session.threadId, { status: 'stopped' }).catch(() => {}); }));
    await bridgeLock?.release(); bridgeLock = null;
    sessions.clear();
    if (client) await client.destroy();
    client = null; started = false;
  }
  function snapshot() { return [...sessions.values()].map(({ pi, thread, lastResult, ...item }) => ({ ...item, hasResult: !!lastResult })); }
  return { start, stop, snapshot, sessions, handleInteraction, handleMessage };
}
module.exports = { COMMANDS, createDiscordService };
