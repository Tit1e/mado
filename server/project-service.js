/**
 * [INPUT]: 依赖配置读写、路径规整与 Node.js 目录状态查询
 * [OUTPUT]: 对外提供 createProjectService，管理手动项目列表的读取、添加与移除
 * [POS]: server 模块的用户项目领域服务，是 ~/.mado/config.json projects 字段的唯一业务入口
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
'use strict';

const fsp = require('fs/promises');
const path = require('path');

const MAX_PROJECTS = 50;

function createProjectService({ resolvePath, readConfig, updateConfig, stat = fsp.stat }) {
  function normalizeProject(input) {
    if (!input || typeof input.path !== 'string' || !input.path || input.path.includes('\0')) return null;
    try {
      return {
        path: resolvePath(input.path),
        addedAt: Number.isFinite(input.addedAt) ? input.addedAt : 0,
      };
    } catch { return null; }
  }

  function storedProjects(config) {
    const result = [];
    const seen = new Set();
    for (const input of Array.isArray(config.projects) ? config.projects : []) {
      const project = normalizeProject(input);
      if (!project || seen.has(project.path)) continue;
      seen.add(project.path);
      result.push(project);
    }
    return result.slice(0, MAX_PROJECTS);
  }

  async function projectView(project) {
    let available = false;
    try { available = (await stat(project.path)).isDirectory(); } catch { /* 外置磁盘离线或目录已移动时保留记录 */ }
    return {
      ...project,
      name: path.basename(project.path) || project.path,
      available,
    };
  }

  async function listProjects() {
    const config = await readConfig();
    return { ok: true, projects: await Promise.all(storedProjects(config).map(projectView)) };
  }

  async function addProject(projectPath) {
    if (typeof projectPath !== 'string' || !projectPath || projectPath.includes('\0')) return { ok: false, error: '请选择有效的项目目录' };
    let target;
    try { target = resolvePath(projectPath); } catch { return { ok: false, error: '项目路径无效' }; }
    try {
      if (!(await stat(target)).isDirectory()) return { ok: false, error: '所选路径不是目录' };
    } catch { return { ok: false, error: '所选目录不存在或无法访问' }; }

    let added = false;
    let limitReached = false;
    await updateConfig((config) => {
      const projects = storedProjects(config);
      if (projects.some((project) => project.path === target)) return;
      if (projects.length >= MAX_PROJECTS) { limitReached = true; return; }
      config.projects = [{ path: target, addedAt: Date.now() }, ...projects];
      added = true;
    });
    if (limitReached) return { ok: false, error: `最多添加 ${MAX_PROJECTS} 个项目` };
    return { ...(await listProjects()), added };
  }

  async function removeProject(projectPath) {
    if (typeof projectPath !== 'string' || !projectPath || projectPath.includes('\0')) return { ok: false, error: '项目路径无效' };
    let target;
    try { target = resolvePath(projectPath); } catch { return { ok: false, error: '项目路径无效' }; }
    let removed = false;
    await updateConfig((config) => {
      const projects = storedProjects(config);
      const next = projects.filter((project) => project.path !== target);
      removed = next.length !== projects.length;
      config.projects = next;
    });
    return { ...(await listProjects()), removed };
  }

  return { listProjects, addProject, removeProject };
}

module.exports = { MAX_PROJECTS, createProjectService };
