/**
 * [INPUT]: 依赖 Node.js 文件/路径能力与本机 discord.json、私有 Token 文件或环境变量
 * [OUTPUT]: 对外提供 loadDiscordConfig，默认关闭，校验单用户/服务器/频道与 Pi 可执行路径
 * [POS]: electron 的 Discord 配置边界，不读取或修改通用项目配置，不向渲染层暴露密钥
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

function loadDiscordConfig({ home = os.homedir(), env = process.env } = {}) {
  const configFile = path.join(home, '.mado', 'discord.json');
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(configFile, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('discord.json 无法读取或不是有效 JSON'); }
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) throw new Error('discord.json 必须是对象');
  const enabled = env.MADO_DISCORD_ENABLED === undefined ? saved.enabled === true : env.MADO_DISCORD_ENABLED === '1';
  if (!enabled) return { enabled: false };
  const config = { enabled, configFile };
  for (const [key, variable] of Object.entries({ guildId: 'DISCORD_GUILD_ID', channelId: 'DISCORD_CHANNEL_ID', ownerUserId: 'DISCORD_OWNER_USER_ID' })) {
    config[key] = env[variable] || saved[key];
    if (typeof config[key] !== 'string' || !/^\d{17,20}$/.test(config[key])) throw new Error(`${key} 必须是 Discord ID 字符串`);
  }
  config.piPath = env.MADO_DISCORD_PI_PATH || saved.piPath;
  if (typeof config.piPath !== 'string' || !path.isAbsolute(config.piPath) || config.piPath.includes('\0')) {
    throw new Error('请将 piPath 配置为 which pi 返回的绝对路径');
  }
  config.token = (env.DISCORD_BOT_TOKEN || '').trim();
  if (!config.token) {
    const tokenFile = path.join(home, '.mado', 'discord-token');
    let stat;
    try { stat = fs.lstatSync(tokenFile); }
    catch { throw new Error('缺少 DISCORD_BOT_TOKEN 或 ~/.mado/discord-token'); }
    if (!stat.isFile() || stat.isSymbolicLink() || (process.platform !== 'win32' && ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid()))) {
      throw new Error('discord-token 必须是本人拥有的普通文件，权限须为 600');
    }
    config.token = fs.readFileSync(tokenFile, 'utf8').trim();
  }
  if (!config.token || /\s/.test(config.token)) throw new Error('Discord Bot Token 为空或包含空白字符');
  return config;
}
module.exports = { loadDiscordConfig };
