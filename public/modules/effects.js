/**
 * [INPUT]: 依赖共享 state.muted 与文件区 DOM
 * [OUTPUT]: 对外提供 createEffects，返回文件变化过滤、类型推断、合并式文件变化涟漪和提示音能力
 * [POS]: public/modules 的变化反馈叶子模块，被文件浏览、终端与文件跟随控制器消费
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
export function createEffects(state, $) {
// ---------- 文件变化过滤 ----------
// 构建/依赖目录 + macOS 系统噪声目录（Library/缓存/废纸篓 后台无时无刻在写，不是 agent 干活，必须过滤）
const CHANGE_IGNORE = new Set(['.git', 'node_modules', '.next', 'dist', 'build', '.cache', '.venv', 'venv', '__pycache__', '.DS_Store', 'target', '.turbo', '.expo', 'Library', 'Caches', '.Trash', 'CloudStorage', '.cocoapods', 'DerivedData']);
// 这次变更是不是该被忽略的系统/构建噪声（高亮、刷新、文件跟随共用一套判断）
function isNoisyChange(filename) {
  const segs = String(filename).split('/');
  // 隐藏文件/目录一律算噪声：agent 写 .git、各种 .config 时用户什么都没的看（.DS_Store/.com.apple. 也被这条覆盖）
  if (segs.some((s) => CHANGE_IGNORE.has(s) || s.startsWith('.'))) return true;
  const name = segs[segs.length - 1];
  return !name || name.endsWith('~') || name.endsWith('.swp')
    || /\.(tmp|part|crdownload|lock)(\.|$)|-(journal|shm|wal)$/i.test(name); // .tmp 可能在中段：原子写 foo.swift.tmp.<pid>.<hex>，sqlite 等后台 App 的临时 sidecar
}
// 从文件名粗判类型（文件跟随目标可能不在当前 entries 里）
function kindFromName(p) {
  const e = (p.split('.').pop() || '').toLowerCase();
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif', 'heic', 'heif', 'tiff', 'tif'].includes(e)) return 'image';
  if (['mp4', 'webm', 'mov', 'm4v'].includes(e)) return 'video';
  if (e === 'pdf') return 'pdf';
  return 'text';
}

// 高频 fs.watch 事件只保留每行一个动画，避免强制同步布局和涟漪节点无上限堆积。
function rippleFileRow(top, count) {
  const area = $('#file-area');
  if (!area || !state.cwd) return;
  const path = state.cwd.replace(/[\\/]+$/, '') + state.sep + top;
  const el = area.querySelector(`[data-path="${CSS.escape(path)}"]`);
  if (!el) return;
  el.style.setProperty('--heat', Math.min(1, 0.4 + count * 0.12).toFixed(2));

  if (!el.classList.contains('live-edit')) {
    const clearLiveEdit = (event) => {
      if (event.target !== el || event.animationName !== 'liveZapRow') return;
      el.classList.remove('live-edit');
      el.removeEventListener('animationend', clearLiveEdit);
      el.removeEventListener('animationcancel', clearLiveEdit);
    };
    el.classList.add('live-edit');
    el.addEventListener('animationend', clearLiveEdit);
    el.addEventListener('animationcancel', clearLiveEdit);
  }

  const host = el.querySelector('.icon') || el;
  if (host.querySelector('.edit-ripple')) return;
  const ripple = document.createElement('span');
  const removeRipple = () => ripple.remove();
  ripple.className = 'edit-ripple';
  host.appendChild(ripple);
  ripple.addEventListener('animationend', removeRipple, { once: true });
  ripple.addEventListener('animationcancel', removeRipple, { once: true });
}

function rippleFileArea() {
  const host = $('#content') || $('#file-area');
  if (!host) return;
  const rect = host.getBoundingClientRect();
  const r = document.createElement('div');
  r.className = 'area-ripple';
  r.style.left = (rect.left + rect.width / 2) + 'px';
  r.style.top = (rect.top + rect.height / 2) + 'px';
  document.body.appendChild(r);
  r.addEventListener('animationend', () => r.remove(), { once: true });
  setTimeout(() => r.remove(), 1400);
}
let _audioCtx = null;
function playChime(type) {
  if (state.muted) return;
  try {
    _audioCtx = _audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const ctx = _audioCtx; const now = ctx.currentTime;
    const notes = type === 'done' ? [659.25, 987.77] : [523.25]; // 完成是 E5→B5 上行小叮，其它单音
    notes.forEach((f, i) => {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      o.connect(g); g.connect(ctx.destination);
      const t = now + i * 0.11;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.11, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
      o.start(t); o.stop(t + 0.45);
    });
  } catch { /* 音频不可用就算了 */ }
}

  return { isNoisyChange, kindFromName, rippleFileRow, rippleFileArea, playChime };
}
