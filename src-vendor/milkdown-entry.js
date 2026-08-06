/**
 * [INPUT]: 依赖 @milkdown/crepe 及其通用主题和 frame 主题样式
 * [OUTPUT]: 对外提供 window.MadoCrepe 浏览器全局对象
 * [POS]: src-vendor 模块的 Milkdown 构建入口，生成 public/vendor/milkdown/milkdown.js
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { Crepe } from '@milkdown/crepe';
import '@milkdown/crepe/theme/common/style.css';
import '@milkdown/crepe/theme/frame.css';

window.MadoCrepe = { Crepe };
