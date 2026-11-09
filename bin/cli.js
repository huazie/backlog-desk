#!/usr/bin/env node
'use strict';

// bdesk —— 改造清单台 · Backlog Desk 命令行入口
// 用法：bdesk <start|init|doctor|demo> [选项]

const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');
const pkg = require('../package.json');
const srv = require('../server.js');

const args = process.argv.slice(2);
const cmd = args[0] && !args[0].startsWith('-') ? args[0] : 'start';
const opt = name => {
  const i = args.indexOf(name);
  return i === -1 ? null : args[i + 1];
};

if (args.includes('--version') || args.includes('-v')) {
  console.log(`backlog-desk v${pkg.version}`);
  process.exit(0);
}

function optsFromArgs() {
  const o = {};
  const port = opt('--port');
  if (port) o.port = Number(port);
  const host = opt('--host');
  if (host) o.host = host;
  const config = opt('--config');
  if (config) o.config = config;
  const dataDir = opt('--data-dir');
  if (dataDir) o.dataDir = dataDir;
  return o;
}

function cmdInit() {
  srv._ctx.dataDir = path.resolve(opt('--data-dir') || process.env.BACKLOG_HOME ||
    path.join(os.homedir(), '.backlog-desk'));
  const file = path.join(srv._ctx.dataDir, 'config.json');
  const from = opt('--from');
  let cfg;
  if (from) {
    cfg = JSON.parse(fs.readFileSync(path.resolve(from), 'utf8'));
    srv.validateConfig(cfg);
  } else {
    cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'default.json'), 'utf8'));
  }
  if (fs.existsSync(file) && !args.includes('--force')) {
    console.log(`已存在 ${file}，未覆盖（加 --force 可覆盖）`);
    return;
  }
  fs.mkdirSync(srv._ctx.dataDir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
  console.log(`已生成 ${file}`);
  console.log('下一步：bdesk start 后在页面「添加项目」中登记项目；或直接编辑该文件的 projects 数组。');
}

function portFree(port) {
  return new Promise(resolve => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.once('listening', () => s.close(() => resolve(true)));
    s.listen(port, '127.0.0.1');
  });
}

async function cmdDoctor() {
  srv.resolvePaths(optsFromArgs());
  let cfg;
  try {
    cfg = srv.loadConfig();
    srv.validateConfig(cfg);
  } catch (e) {
    console.log(`配置异常：${e.message}（配置文件：${srv._ctx.configFile}）`);
    process.exitCode = 1;
    return;
  }
  console.log(`配置文件：${srv._ctx.configFile}`);
  let bad = 0;
  for (const p of cfg.projects) {
    const memDir = path.resolve(srv.expandHome(p.memoryRoot), cfg.agents[p.agent].memoryDir);
    const backlog = path.join(memDir, cfg.agents[p.agent].backlogFile);
    const items = [
      ['代码根', fs.existsSync(srv.expandHome(p.projectRoot))],
      ['记忆根', fs.existsSync(srv.expandHome(p.memoryRoot))],
      ['记忆目录', fs.existsSync(memDir)],
      ['清单文件', fs.existsSync(backlog)]
    ];
    const miss = items.filter(x => !x[1]).map(x => x[0]);
    console.log(`${miss.length ? '✗' : '✓'} ${p.id}${miss.length ? '  缺失：' + miss.join('、') : ''}`);
    if (miss.length) bad++;
  }
  const port = Number(cfg.port) || 8787;
  const free = await portFree(port);
  console.log(`${free ? '✓' : '✗'} 端口 ${port} ${free ? '空闲' : '被占用（服务可能已在运行）'}`);
  console.log(bad ? `结果：${bad} 个项目存在缺失路径` : '结果：全部项目路径健康');
  if (bad) process.exitCode = 1;
}

function cmdDemo() {
  const demoDir = path.join(__dirname, '..', 'demo');
  const dataDir = path.join(os.tmpdir(), `backlog-desk-demo-${process.pid}`);
  fs.rmSync(dataDir, { recursive: true, force: true });
  const tpl = JSON.parse(fs.readFileSync(path.join(demoDir, 'config.json'), 'utf8'));
  const demoRoot = path.join(demoDir, 'projects').replace(/\\/g, '/');
  const text = JSON.stringify(tpl).replace(/\{\{DEMO\}\}/g, demoRoot);
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify(JSON.parse(text), null, 2) + '\n', 'utf8');
  const port = Number(opt('--port')) || 8788;
  srv.start({ dataDir, port });
  console.log('演示模式：数据全部来自包内 demo/ 示例目录，不会读写任何真实项目记忆。');
  // 示例镜像为静态占位，启动后自动按唯一权威源校准一次，让看板开箱即「一致」
  setTimeout(async () => {
    for (const id of (tpl.projects || []).map(p => p.id)) {
      try { await fetch(`http://127.0.0.1:${port}/api/sync/${id}`, { method: 'POST' }); } catch (_) { /* 服务未就绪则下次手动同步 */ }
    }
  }, 800);
}

function usage() {
  console.log(`backlog-desk v${pkg.version} —— 改造清单台

用法：
  bdesk start [--port N] [--host H] [--config FILE] [--data-dir DIR]   启动看板（默认回环 8787）
  bdesk init [--from FILE] [--data-dir DIR] [--force]                  生成用户态配置 ~/.backlog-desk/config.json
  bdesk doctor [--config FILE] [--data-dir DIR]                        体检：项目路径 / 端口占用
  bdesk demo [--port N]                                                用包内脱敏示例数据启动（零读写真实记忆）
  bdesk --version                                                      版本号`);
}

switch (cmd) {
  case 'start': srv.start(optsFromArgs()); break;
  case 'init': cmdInit(); break;
  case 'doctor': cmdDoctor(); break;
  case 'demo': cmdDemo(); break;
  default: usage(); process.exitCode = cmd === 'help' ? 0 : 1;
}
