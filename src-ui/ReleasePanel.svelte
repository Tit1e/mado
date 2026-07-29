<!--
  [INPUT]: 依赖 Svelte 5 状态、发布检查/准备函数、提示与终端执行回调
  [OUTPUT]: 对外提供 open/close 接口，渲染版本、说明和发布选项表单
  [POS]: src-ui 的发布向导界面岛，保留服务端发布安全边界
  [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
-->
<script>
  let { inspect, prepare, notify, runCommand } = $props();
  let visible = $state(false), loading = $state(false), busy = $state(false), error = $state(''), data = $state(null), directory = $state('');
  let version = $state(''), notes = $state(''), doDist = $state(false), doPush = $state(false), doRelease = $state(false);
  let requestId = 0;

  export async function open(path) {
    const id = ++requestId;
    visible = true; loading = true; busy = false; error = ''; data = null; directory = path;
    try {
      const result = await inspect(path);
      if (id !== requestId) return;
      if (!result.ok) { error = result.error || '检查失败'; return; }
      data = result;
      version = result.version.replace(/(\d+)(\D*)$/, (match, number, tail) => Number(number) + 1 + tail);
      notes = result.unreleased || '';
      doDist = !!result.hasDist; doPush = !!result.remote; doRelease = !!(result.gh && result.remote);
    } catch { if (id === requestId) error = '检查失败'; }
    finally { if (id === requestId) loading = false; }
  }
  export function close() { visible = false; requestId++; }

  async function submit() {
    const nextVersion = version.trim();
    if (!/^\d+\.\d+\.\d+$/.test(nextVersion)) { notify('版本号要 x.y.z 格式', true); return; }
    busy = true;
    const result = await prepare({ path: directory, version: nextVersion, notes, doDist, doPush, doRelease });
    if (!result.ok) { notify(result.error || '准备失败', true); busy = false; return; }
    close();
    runCommand(directory, result.cmd, `v${nextVersion} 发版序列已在终端开跑`);
  }
  function handleKey(event) { if (visible && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } }
  function overlay(event) { if (event.target === event.currentTarget) close(); }
</script>

<svelte:window onkeydowncapture={handleKey} />
{#if visible}
  <div class="input-overlay rel-overlay" role="presentation" onclick={overlay}>
    <div class="input-dialog rel-dialog" role="dialog" aria-modal="true" aria-label="发版">
      <div class="input-title">发版</div>
      <div class="rel-body">
        {#if loading}<div class="cmdk-loading">检查项目状态…</div>
        {:else if error}<div class="empty-state">{error}</div>
        {:else if data}
          <div class="rel-row"><label for="rel-ver">版本号</label><span class="rel-cur">当前 v{data.version} →</span><input id="rel-ver" bind:value={version} spellcheck="false" /></div>
          <div class="rel-row rel-col"><label for="rel-notes">发布说明{data.unreleased ? '（预填自 CHANGELOG 的 Unreleased 段）' : ''}</label><textarea id="rel-notes" bind:value={notes} rows="8" spellcheck="false"></textarea></div>
          <div class="rel-opts">
            {#if data.hasDist}<label><input type="checkbox" bind:checked={doDist} /> 打包（npm run dist）</label>{/if}
            {#if data.remote}<label><input type="checkbox" bind:checked={doPush} /> 推送（git push）</label>{/if}
            {#if data.gh && data.remote}<label><input type="checkbox" bind:checked={doRelease} /> GitHub Release{data.hasDist ? '（附 dmg）' : ''}</label>{/if}
          </div>
          {#if data.dirty}<div class="rel-hint">工作区有未提交改动，会一并进这次发版 commit</div>{/if}
          {#if !data.isRepo}<div class="rel-hint">这里不是 git 仓库，只能改版本号</div>{/if}
          <div class="input-actions"><button class="ghost-btn" type="button" onclick={close}>取消</button><button class="primary" type="button" disabled={busy} onclick={submit}>在终端开跑</button></div>
        {/if}
      </div>
    </div>
  </div>
{/if}
