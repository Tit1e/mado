/**
 * [INPUT]: 依赖 Node.js 文件/进程能力、Codex CLI、配置目录和调用方路径解析能力
 * [OUTPUT]: 对外提供 createDeveloperTools，封装 AI 整理、CLI 定位与磁盘占用分析
 * [POS]: server 模块的开发者工作流服务，被主 HTTP 路由和 Codex 会话服务消费
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
'use strict';

const fsp = require('fs/promises');
const path = require('path');
const { execFile } = require('child_process');

function createDeveloperTools({ configDir, resolvePath }) {
  const CONFIG_DIR = configDir;
// ---------- AI 整理：备料 + 在内嵌终端拉起 Codex ----------
// CodexBox 只负责把整理偏好、过往整理历史和工作约定写成 brief 文件；
// Codex 先摊方案，用户确认后再动手，并持续写回滚日志与偏好。
const ORGANIZE_LOG_DIR = path.join(CONFIG_DIR, 'organize-log');
const ORGANIZE_PREFS_FILE = path.join(CONFIG_DIR, 'organize-prefs.md');
const ORGANIZE_BRIEF_FILE = path.join(CONFIG_DIR, 'organize-brief.md');
const DEFAULT_ORGANIZE_STRATEGY = `- 默认归档：过时/低频的文件移入 _archive/ 下的语义子目录（如 _archive/截图/2026-06/）
- 同一主题的散文件归进语义明确的项目文件夹（项目制：一个项目一个文件夹，按需建议新文件夹）
- 归档之外，单独提一份「建议删除」清单（什么算该删由你判断：明显垃圾、可再生成的产物、过期大文件……），逐条给理由
- 删除须用户逐条点头；确认后移入废纸篓 ~/.Trash/（不直接 rm），并照常记进回滚日志
- 最近 7 天内有动静的文件视为正在进行的工作，不要动
- 文件夹一律不动，只整理松散文件
- 拿不准的单独列出来问，宁可少动不要乱动`;

// codex 各版本旗标常变（0.139 移除了 --full-auto）：按 --help 实测有什么用什么，
// 全不认识就裸跑——退化成多几次审批确认，但不会因 unexpected argument 拉不起来
async function codexOrganizeFlags(bin) {
  const help = await new Promise((resolve) => {
    execFile(bin, ['--help'], { timeout: 8000 }, (err, stdout) => resolve(err ? '' : String(stdout)));
  });
  if (help.includes('--full-auto')) return ' --full-auto';
  let flags = '';
  if (help.includes('--sandbox')) flags += ' --sandbox workspace-write';
  if (help.includes('--ask-for-approval')) flags += ' -a on-request';
  if (help.includes('--add-dir')) flags += ` --add-dir "${CONFIG_DIR}"`;
  return flags;
}

async function findCodexBin() {
  // GUI 启动的 app 没有用户 shell 的 PATH，走登录 shell 找一次绝对路径
  return new Promise((resolve) => {
    execFile('/bin/zsh', ['-lc', 'command -v codex'], { timeout: 8000 }, (err, stdout) => {
      const out = String(stdout || '').trim().split('\n').pop();
      resolve(!err && out && out.startsWith('/') ? out : null);
    });
  });
}

// 最近几次整理日志的一句话摘要，给 agent 当历史参照（日志由 agent 按 brief 约定写入）
async function organizeHistory() {
  let files = [];
  try { files = (await fsp.readdir(ORGANIZE_LOG_DIR)).filter((f) => f.endsWith('.json')); } catch { return ''; }
  files.sort().reverse();
  const lines = [];
  for (const f of files.slice(0, 3)) {
    try {
      const log = JSON.parse(await fsp.readFile(path.join(ORGANIZE_LOG_DIR, f), 'utf8'));
      const m0 = (log.moves || [])[0];
      const sample = m0 ? `（如 ${path.basename(m0.from)} → ${path.relative(log.dir, m0.to)}）` : '';
      lines.push(`- ${new Date(log.at).toLocaleString('zh-CN')} 整理过 ${log.dir}，移动 ${(log.moves || []).length} 项${sample}`);
    } catch { /* 坏日志跳过 */ }
  }
  return lines.join('\n');
}

// 备料并返回终端启动命令：brief 写盘（偏好 + 历史 + 工作约定），前端用 term.runInDir 拉起交互式 agent
async function organizeLaunch(b) {
  const dir = resolvePath(b.path);
  const bin = await findCodexBin();
  if (!bin) return { ok: false, error: '没找到 codex 命令——AI 整理需要先安装 Codex CLI' };
  const prefs = await fsp.readFile(ORGANIZE_PREFS_FILE, 'utf8').catch(() => '');
  const history = await organizeHistory();
  const brief = `# AI 整理任务（CodexBox 生成，每次启动覆盖本文件）

你在 CodexBox 的内嵌终端里，帮用户对话式整理这个文件夹：${dir}

## 工作流程
1. 先看现状：列出当前文件夹的松散文件（名字/类型/大小/修改时间）。文件夹和隐藏文件一律不动
2. 结合下面的整理偏好与历史，提出分组整理方案摊给用户——用户明确同意前，一个文件都不要动
3. 用户可能口头调整方案（「截图不动」「这几个归到XX」），以对话为准
4. 动手用 mv 移动，目标目录不存在先 mkdir -p
5. 每完成一批移动，按下面的格式写一份回滚日志，并告诉用户「想撤销随时说」
6. 收尾：把这次对话里新学到的用户偏好（规则/例外/纠正）一条一行追加进偏好文件，别重复已有条目

## 回滚日志（撤销能力全靠它，格式不能错）
每批移动写一个新文件 ${ORGANIZE_LOG_DIR}/<毫秒时间戳>.json，内容：
{"dir":"${dir}","at":<毫秒时间戳>,"moves":[{"from":"<移动前绝对路径>","to":"<移动后绝对路径>"}]}
用户要撤销时：读对应日志，逐条把 to 移回 from（from 位置已被占用的跳过并说明）

## 整理偏好（用户的长期规则，优先级最高）
${DEFAULT_ORGANIZE_STRATEGY}
${prefs.trim() ? `\n### 历次整理沉淀的偏好\n${prefs.trim()}\n` : ''}
## 偏好文件
${ORGANIZE_PREFS_FILE}（markdown 列表，新偏好追加在末尾）

## 最近整理历史
${history || '（还没有历史记录）'}
`;
  await fsp.mkdir(ORGANIZE_LOG_DIR, { recursive: true });
  await fsp.writeFile(ORGANIZE_BRIEF_FILE, brief, 'utf8');
  const kickoff = `先完整读 ${ORGANIZE_BRIEF_FILE}，然后按里面的约定，和我对话式整理当前文件夹`;
  const cmd = `codex${await codexOrganizeFlags(bin)} "${kickoff}"`;
  return { ok: true, cmd };
}

// ---------- 磁盘占用透视：算清当前目录每个子项的真实占用 ----------
// 文件直接 stat（快）；目录一次 du -sk 批量算。du 碰到无权限子目录会报错但仍输出能算的部分，所以忽略 err 只用 stdout
async function diskUsage(p) {
  const dir = resolvePath(p);
  let names;
  try { names = await fsp.readdir(dir, { withFileTypes: true }); } catch (e) { return { ok: false, error: '读取失败：' + e.message }; }
  const dirs = [], items = [];
  await Promise.all(names.map(async (d) => {
    const full = path.join(dir, d.name);
    if (d.isDirectory() && !d.isSymbolicLink()) { dirs.push(full); return; }
    try { const st = await fsp.lstat(full); if (st.isFile()) items.push({ name: d.name, size: st.size, isDir: false }); } catch { /* */ }
  }));
  if (dirs.length) {
    const out = await new Promise((resolve) => {
      execFile('du', ['-sk', ...dirs], { timeout: 120000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => resolve(stdout || ''));
    });
    for (const line of out.split('\n')) {
      const m = line.match(/^(\d+)\s+(.+)$/);
      if (m) items.push({ name: path.basename(m[2]), size: Number(m[1]) * 1024, isDir: true });
    }
  }
  items.sort((a, b) => b.size - a.size);
  const total = items.reduce((a, b) => a + b.size, 0);
  return { ok: true, dir, total, items: items.slice(0, 60), more: Math.max(0, items.length - 60) };
}

  return { findCodexBin, organizeLaunch, diskUsage };
}

module.exports = { createDeveloperTools };
