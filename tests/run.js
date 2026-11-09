#!/usr/bin/env node
'use strict';

// 可移植回归入口：临时目录造 fixture → 自启隔离服务 → 跑三套脚本 → 无论成败都清理。
// npm test 走这里；npm run test:local 保留「手动起服务 + 真实项目」的本机验收语义。

const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');
const { spawn } = require('child_process');
const { createFixture } = require('./fixture.js');

const ROOT = path.resolve(__dirname, '..');
const SCRIPTS = ['smoke.js', 'sync-check.js', 'track-check.js'];
const wait = ms => new Promise(r => setTimeout(r, ms));

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.once('listening', () => {
      const port = s.address().port;
      s.close(() => resolve(port));
    });
    s.listen(0, '127.0.0.1');
  });
}

async function waitReady(port, srv, log, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (srv.exitCode !== null) throw new Error(`隔离服务提前退出：\n${log()}`);
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/state`);
      const d = await r.json();
      // 校验连到的是自己起的服务，避免端口竞态时误连到其他进程
      if (r.ok && Array.isArray(d.projects) && d.projects.some(p => p.id === 'hexo-theme-diversity')) return;
    } catch (_) { /* 端口未就绪，继续轮询 */ }
    await wait(100);
  }
  throw new Error(`隔离服务在 ${timeoutMs}ms 内未就绪（端口 ${port}）：\n${log()}`);
}

function runScript(file, env) {
  return new Promise(resolve => {
    const c = spawn(process.execPath, [path.join(__dirname, file)], {
      cwd: ROOT, env, stdio: 'inherit'
    });
    c.on('error', e => {
      console.error(`启动失败 ${file}：${e.message}`);
      resolve(1);
    });
    c.on('exit', code => resolve(code === null ? 1 : code));
  });
}

(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backlog-desk-test-'));
  let srv = null;
  let srvLog = '';
  let failed = false;
  let port = null;
  // Ctrl+C 等中断时也别留下服务进程与临时目录
  const stop = () => {
    try { if (srv) srv.kill(); } catch (_) { /* 已退出 */ }
    try { fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (_) { /* 已删除 */ }
  };
  process.on('SIGINT', () => { stop(); process.exit(130); });
  process.on('SIGTERM', () => { stop(); process.exit(143); });

  try {
    createFixture(dataDir);
    port = await freePort();
    const env = { ...process.env, PORT: String(port), BACKLOG_HOME: dataDir };
    srv = spawn(process.execPath, [path.join(ROOT, 'bin', 'cli.js'), 'start',
      '--port', String(port), '--host', '127.0.0.1', '--data-dir', dataDir], {
      cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe']
    });
    srv.stdout.on('data', d => { srvLog += d; });
    srv.stderr.on('data', d => { srvLog += d; });
    await waitReady(port, srv, () => srvLog);
    console.log(`隔离测试：端口 ${port} ｜ 数据目录 ${dataDir}`);

    const codes = [];
    for (const f of SCRIPTS) {
      console.log(`\n=== ${f} ===`);
      const code = await runScript(f, env);
      codes.push([f, code]);
      if (code !== 0) failed = true;
    }
    console.log('\n汇总：' + codes.map(([f, c]) => `${f} ${c === 0 ? 'PASS' : 'FAIL(' + c + ')'}`).join(' ｜ '));
    if (failed) console.error('隔离测试存在失败项，详见上方各脚本输出');
  } catch (e) {
    failed = true;
    console.error('隔离测试异常：' + (e.stack || e.message));
  } finally {
    stop();
    if (srv) await wait(250); // 等 watcher 释放文件句柄后再删
    try {
      fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      console.log('清理：隔离服务已关闭，临时 fixture 已删除');
    } catch (e) {
      console.error(`清理失败：临时目录未能删除（${e.message}）：${dataDir}`);
      failed = true;
    }
  }
  process.exitCode = failed ? 1 : 0;
})();
