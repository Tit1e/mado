/**
 * [INPUT]: 依赖运行规则 API、终端服务会话、通用输入/菜单交互与当前目录 state
 * [OUTPUT]: 对外提供 createProjectRunController，管理顶栏运行动作、规则设置和项目运行状态
 * [POS]: public/modules 的项目运行命令控制器，连接目录规则、隐藏 PTY 服务与侧边栏状态
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
export function createProjectRunController(deps) {
  const { $, state, api, apiPost, term, inputDialog, popupMenu, toast, ic, setRunningRoots = () => {} } = deps;
  let context = { path: null, rule: null, running: false, loading: false, action: '' };
  let requestId = 0;
  const pendingRoots = new Map();
  let latestStates = [];

  const enabled = () => !!(window.madoEnv?.isDesktopApp && term.available());
  const ruleIsRunning = (rule) => context.running && context.rule?.id === rule.id;

  function button(className, label, icon, handler, disabled = false) {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = `project-run-btn ${className}`;
    element.setAttribute('aria-label', label);
    element.title = label;
    element.disabled = disabled;
    element.innerHTML = icon;
    element.onclick = handler;
    return element;
  }

  function render() {
    const host = $('#project-run-actions');
    if (!host) return;
    host.replaceChildren();
    if (!enabled() || !state.cwd) return;
    if (context.path !== state.cwd) { void loadRule(state.cwd); return; }

    const locked = context.loading || !!context.action;
    host.appendChild(button('project-run-settings', '设置运行命令', ic('settings', 'currentColor', 15), (event) => void configure(event), locked));
    if (!context.rule) return;

    if (!context.running) {
      host.appendChild(button('project-run-start', '运行项目命令', ic('play', 'currentColor', 15), () => void start(), locked));
      return;
    }

    host.appendChild(button('project-run-status', '查看服务输出', '<span class="project-run-dot" aria-hidden="true"></span>', () => {
      term.revealProjectRun(context.rule);
    }, locked));
    host.appendChild(button('project-run-restart', '重新运行项目命令', ic('redo', 'currentColor', 15), () => void restart(), locked));
    host.appendChild(button('project-run-stop', '停止项目命令', ic('stop', 'currentColor', 14), () => void stop(), locked));
  }

  async function loadRule(path) {
    if (!enabled() || !path) return;
    const id = ++requestId;
    context = { path, rule: null, running: false, loading: true, action: '' };
    render();
    try {
      const result = await api('/api/run-rule?path=' + encodeURIComponent(path));
      if (id !== requestId || state.cwd !== path) return;
      context = { path, rule: result.rule || null, running: false, loading: false, action: '' };
      await refreshRuntime();
    } catch {
      if (id !== requestId || state.cwd !== path) return;
      context = { path, rule: null, running: false, loading: false, action: '' };
      render();
    }
  }

  async function refreshRuntime() {
    if (!enabled()) return;
    let states = latestStates;
    try { states = await term.projectRunStates(); latestStates = states; } catch { /* 单次进程检测失败，保留上一帧状态 */ }
    const now = Date.now();
    for (const [ruleId, pending] of pendingRoots) {
      if (pending.until <= now) pendingRoots.delete(ruleId);
    }
    const runningRules = new Set(states.filter((item) => item.running).map((item) => item.ruleId));
    const runningRoots = new Set(states.filter((item) => item.running).map((item) => item.root));
    pendingRoots.forEach((pending, ruleId) => {
      runningRules.add(ruleId);
      runningRoots.add(pending.root);
    });
    setRunningRoots([...runningRoots]);
    if (context.path === state.cwd && context.rule) context.running = runningRules.has(context.rule.id);
    render();
  }

  async function saveRule(path, value) {
    if (context.rule && context.rule.cwd === path && ruleIsRunning(context.rule)) { toast('请先停止正在运行的命令', true); return; }
    const command = await inputDialog('设置运行命令', value || '', '例如 npm run dev');
    if (!command) return;
    context.action = 'save';
    render();
    try {
      const result = await apiPost('/api/run-rule', { path, command });
      if (!result.ok) { toast(result.error || '保存运行命令失败', true); return; }
      toast('运行命令已保存');
      await loadRule(state.cwd);
    } catch { toast('保存运行命令失败', true); }
    finally {
      if (context.path === state.cwd) { context.action = ''; render(); }
    }
  }

  function configure(event) {
    if (!context.rule) { void saveRule(context.path, ''); return; }
    const rule = context.rule;
    if (!rule.inherited) { void saveRule(rule.cwd, rule.command); return; }
    popupMenu(event, [
      { label: '编辑继承的命令', fn: () => saveRule(rule.cwd, rule.command) },
      { label: '在当前目录新建覆盖', fn: () => saveRule(context.path, '') },
    ]);
  }

  async function runAction(name, action) {
    if (!context.rule || context.action) return;
    const rule = context.rule;
    context.action = name;
    if (name !== 'stop') pendingRoots.set(rule.id, { root: rule.cwd, until: Date.now() + 5000 });
    else pendingRoots.delete(rule.id);
    render();
    try {
      const result = await action(rule);
      if (!result?.ok) toast(result?.error || '运行命令失败', true);
      else if (name === 'start') toast('已启动项目命令');
      else if (name === 'restart') toast('正在重新运行项目命令');
      else toast('正在停止项目命令');
    } catch { toast('运行命令失败', true); }
    finally {
      context.action = '';
      await refreshRuntime();
    }
  }

  const start = () => runAction('start', (rule) => term.startProjectRun(rule));
  const restart = () => runAction('restart', (rule) => term.restartProjectRun(rule));
  const stop = () => runAction('stop', (rule) => term.stopProjectRun(rule));

  function startPolling() {
    if (!enabled()) return;
    setInterval(() => { void refreshRuntime(); }, 2500);
    void refreshRuntime();
  }

  return { render, refreshRuntime, startPolling };
}
