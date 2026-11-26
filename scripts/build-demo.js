#!/usr/bin/env node
'use strict';

// 静态 demo 打包入口：npm run build:demo
// 产出一个纯静态、可直接被任何静态托管使用、也可 file:// 双击直开的目录 build-demo/：
//   1. 全量拷贝 public/（index.html / app.js / style.css / demo.js / favicon）
//   2. 拷贝 demo/ 源文件，并把其内容构建期内嵌为 window.__DEMO_DATA__——
//      file:// 下浏览器禁止 fetch，demo.js 检测到内嵌数据即直接解析（产物快照语义：改 demo/ 源文件需重新 build）
//   3. 在 index.html 注入 window.__DEMO__=true——产物无需 URL 参数即进入演示态
// demo/ 源文件全程只读；产物目录不进 npm 包（package.json files 白名单不含）、不入库（.gitignore）。

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PUB = path.join(ROOT, 'public');
const OUT = path.join(ROOT, 'build-demo');
const INJECT = '<script>window.__DEMO__=true;</script>\n';

// 1. 清空并重建输出目录：public/ 全量拷贝（新增静态文件自动随包，无需维护清单）
//    + demo/ 源文件（内嵌数据来源，同时随包保留以便查阅）
fs.rmSync(OUT, { recursive: true, force: true });
fs.cpSync(PUB, OUT, { recursive: true });
fs.cpSync(path.join(ROOT, 'demo'), path.join(OUT, 'demo'), { recursive: true });

// 2. 内嵌 demo/ 全部文件内容（key 相对 demo/ 根、统一正斜杠，与 demo.js readText 的取用路径一致）
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
  e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
const demoRoot = path.join(OUT, 'demo');
const filesMap = {};
for (const f of walk(demoRoot)) {
  filesMap[path.relative(demoRoot, f).replace(/\\/g, '/')] = fs.readFileSync(f, 'utf8');
}
// JSON 内的 < 转义为 \u003c，防止内容里的 </script> 提前闭合注入的 script 标签
const EMBED = '<script>window.__DEMO_DATA__='
  + JSON.stringify({ generatedAt: new Date().toISOString(), files: filesMap }).replace(/</g, '\\u003c')
  + ';</script>\n';

// 3. 注入演示态标记 + 内嵌数据（均置于 demo.js 加载之前）
const html = fs.readFileSync(path.join(OUT, 'index.html'), 'utf8');
const anchor = '<script src="demo.js">';
if (!html.includes(anchor)) {
  console.error('build:demo 失败：index.html 中找不到注入锚点');
  process.exit(1);
}
fs.writeFileSync(path.join(OUT, 'index.html'), html.replace(anchor, INJECT + EMBED + anchor), 'utf8');

const files = fs.readdirSync(OUT);
const kb = f => (fs.statSync(path.join(OUT, f)).size / 1024).toFixed(1);
console.log(`build:demo 完成 → ${path.relative(ROOT, OUT)}/（${files.map(n => `${n} ${kb(n)}KB`).join('，')}）`);
console.log('产物为纯静态目录，可直接部署到任意静态托管（如 GitHub Pages 子路径），也可双击 build-demo/index.html 直接打开。');
