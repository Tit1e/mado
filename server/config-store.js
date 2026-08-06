/**
 * [INPUT]: 依赖 Node.js fs/promises，依赖调用方提供的配置文件绝对路径
 * [OUTPUT]: 对外提供 createConfigStore，返回 readConfig 与 updateConfig
 * [POS]: server 模块的配置持久化基础设施，被项目、文件、运行规则、语言设置和用户偏好消费
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
'use strict';

const fsp = require('fs/promises');
const path = require('path');

function createConfigStore(configFile) {
  async function readConfig() {
    try {
      const raw = await fsp.readFile(configFile, 'utf8');
      return JSON.parse(raw);
    } catch (err) {
      if (err && err.code === 'ENOENT') return { favorites: [], recentOpened: [], projects: [] };
      throw err;
    }
  }

  let chain = Promise.resolve();
  function updateConfig(mutator) {
    const run = chain.then(async () => {
      const cfg = await readConfig();
      await mutator(cfg);
      await fsp.mkdir(path.dirname(configFile), { recursive: true });
      const tmp = `${configFile}.tmp-${process.pid}-${Date.now()}`;
      try {
        const fh = await fsp.open(tmp, 'w');
        try { await fh.writeFile(JSON.stringify(cfg, null, 2)); await fh.sync(); } finally { await fh.close(); }
        await fsp.rename(tmp, configFile);
      } catch (err) {
        await fsp.unlink(tmp).catch(() => {});
        throw err;
      }
      return cfg;
    });
    chain = run.catch(() => {});
    return run;
  }

  return { readConfig, updateConfig };
}

module.exports = { createConfigStore };
