#!/usr/bin/env node
'use strict';

// 静态 demo 打包入口：npm run build:demo
// 产出一个纯静态、可直接被任何静态托管使用的目录 build-demo/：
//   1. 刷新演示数据（gen-demo-data 模块，源：demo/ 脱敏示例，只读）
//   2. 全量拷贝 public/（index.html / app.js / style.css / demo.js / demo-data.js / favicon）
//   3. 在 index.html 注入 window.__DEMO__=true——产物无需 URL 参数即进入演示态
// demo/ 源文件全程只读；产物目录不进 npm 包（package.json files 白名单不含）、不入库（.gitignore）。

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PUB = path.join(ROOT, 'public');
const OUT = path.join(ROOT, 'build-demo');
const INJECT = '<script>window.__DEMO__=true;</script>\n';

// 1. 刷新演示数据（demo/ 只读，产物落 public/demo-data.js）
require('./gen-demo-data').generate();

// 2. 清空并重建输出目录，全量拷贝 public/（新增静态文件自动随包，无需维护清单）
fs.rmSync(OUT, { recursive: true, force: true });
fs.cpSync(PUB, OUT, { recursive: true });

// 3. 注入演示态标记（置于 demo-data.js 加载之前，demo.js 检测 window.__DEMO__ 即启用）
const html = fs.readFileSync(path.join(OUT, 'index.html'), 'utf8');
const anchor = '<script src="demo-data.js">';
if (!html.includes(anchor)) {
  console.error('build:demo 失败：index.html 中找不到注入锚点');
  process.exit(1);
}
fs.writeFileSync(path.join(OUT, 'index.html'), html.replace(anchor, INJECT + anchor), 'utf8');

const files = fs.readdirSync(OUT);
const kb = f => (fs.statSync(path.join(OUT, f)).size / 1024).toFixed(1);
console.log(`build:demo 完成 → ${path.relative(ROOT, OUT)}/（${files.map(n => `${n} ${kb(n)}KB`).join('，')}）`);
console.log('产物为纯静态目录，可直接部署到任意静态托管（如 GitHub Pages 子路径）。');
