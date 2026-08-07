/**
 * [INPUT]: 依赖固定 Agent 与动作标识
 * [OUTPUT]: 对外提供 resolveAgentLaunch，将 Codex/Pi 启动动作解析为受控命令与用户文案
 * [POS]: public/modules 的第一方 Agent 启动命令唯一真源，不读取会话、凭据或自定义命令
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
const AGENT_LAUNCHES = Object.freeze({
  codex: Object.freeze({
    continue: Object.freeze({ command: 'codex resume --last', message: '正在继续最近会话' }),
    new: Object.freeze({ command: 'codex', message: '正在启动新会话' }),
  }),
  pi: Object.freeze({
    continue: Object.freeze({ command: 'pi -c', message: '正在继续最近会话' }),
    new: Object.freeze({ command: 'pi', message: '正在启动新会话' }),
  }),
});

export function resolveAgentLaunch(agent, action) {
  if (!Object.hasOwn(AGENT_LAUNCHES, agent)) return null;
  const definition = AGENT_LAUNCHES[agent];
  if (!Object.hasOwn(definition, action)) return null;
  return { agent, action, ...definition[action] };
}
