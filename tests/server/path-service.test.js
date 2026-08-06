/**
 * [INPUT]: 依赖 node:test、node:path 和 server/path-service
 * [OUTPUT]: 验证路径规整、文件类型、JavaScript 模块 MIME 与项目类型推断
 * [POS]: tests/server 的路径和文件类型回归测试
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createPathService, kindOf, projectOf, MIME } = require('../../server/path-service');

test('路径服务处理主目录、相对路径和空字节', () => {
  const home = path.resolve('/tmp/mado-home');
  const { resolvePath } = createPathService(home);
  assert.equal(resolvePath('~/demo'), path.join(home, 'demo'));
  assert.equal(resolvePath('demo/../work'), path.join(home, 'work'));
  assert.throws(() => resolvePath('bad\0path'), /非法路径/);
});

test('文件和项目类型推断保持现有规则', () => {
  assert.equal(kindOf('README.md', false), 'text');
  assert.equal(kindOf('photo.heic', false), 'image');
  assert.equal(kindOf('bundle.zip', false), 'archive');
  assert.equal(projectOf(new Set(['package.json', '.git'])), 'node');
});

test('JavaScript 与 ES Module 静态资源使用可执行脚本 MIME', () => {
  assert.equal(MIME.js, 'application/javascript; charset=utf-8');
  assert.equal(MIME.mjs, 'application/javascript; charset=utf-8');
});
