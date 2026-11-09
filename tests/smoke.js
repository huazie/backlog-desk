'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 8787;
const BASE = `http://127.0.0.1:${PORT}`;
const ROOT = path.resolve(__dirname, '..');
const DATA = process.env.BACKLOG_HOME ? path.resolve(process.env.BACKLOG_HOME) : ROOT;
const BAK_DIR = path.join(DATA, 'backups', 'hexo-theme-diversity');
const HISTORY = path.join(DATA, 'history.jsonl');

const results = [];
let originalConfig = null;
let hexoMem = null;
let fleaMem = null;
let originalHistory = null;
let historyCaptured = false;
let originalBacklog = null; // { file, text }：验收前 hexo 清单快照
let bakBefore = [];
let backupsCaptured = false;
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

async function req(p, method = 'GET', body) {
  const r = await fetch(BASE + p, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: r.status, data: await r.json() };
}

function check(name, cond, detail = '') {
  results.push({ name, ok: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' | ' + detail : ''}`);
}

function restoreHistory() {
  if (!historyCaptured) return; // 未取到快照时不能删真实 history
  if (originalHistory === null) {
    if (fs.existsSync(HISTORY)) fs.unlinkSync(HISTORY);
  } else {
    fs.writeFileSync(HISTORY, originalHistory, 'utf8');
  }
}

// 验收异常时也必须还原真实清单；写回时 autoWatch 仍关闭，避免被 watcher 当作 Agent 外部改动
function restoreBacklog() {
  if (!originalBacklog) return;
  try {
    if (fs.readFileSync(originalBacklog.file, 'utf8') !== originalBacklog.text) {
      fs.writeFileSync(originalBacklog.file, originalBacklog.text, 'utf8');
      console.log('清理：改造清单.md 已按验收前快照还原');
    }
  } catch (e) {
    console.error(`清理失败：${originalBacklog.file} 未能还原（${e.message}），请从写前备份恢复`);
  }
}

function cleanupBackups() {
  if (!backupsCaptured || !fs.existsSync(BAK_DIR)) return; // 未取到基线时不能删真实备份
  try {
    for (const n of fs.readdirSync(BAK_DIR)) {
      if (!bakBefore.includes(n)) fs.unlinkSync(path.join(BAK_DIR, n));
    }
  } catch (e) {
    console.error(`清理失败：写前备份未能清理（${e.message}）`);
  }
}

// 正常结束与异常中断走同一套清理：先还原清单（此时 quiet 配置生效），再还原 history / 备份 / 配置
async function cleanup() {
  restoreBacklog();
  restoreHistory();
  cleanupBackups();
  if (originalConfig) {
    try { await req('/api/config', 'PUT', { config: originalConfig }); } catch (_) { /* 已尽力恢复 */ }
  }
}

async function mtimeOf(id) {
  const r = await req('/api/state');
  return r.data.projects.find(p => p.id === id).mtime;
}

(async () => {
  // 回归期间临时关闭记忆同步与任务卡生成，避免验收数据写入真实 MEMORY.md / 日志 / history。
  const st0 = (await req('/api/state')).data;
  originalConfig = st0.config;
  const agentDir = originalConfig.agents.workbuddy.memoryDir;
  hexoMem = path.join(originalConfig.projects.find(p => p.id === 'hexo-theme-diversity').memoryRoot, agentDir);
  fleaMem = path.join(originalConfig.projects.find(p => p.id === 'flea-framework').memoryRoot, agentDir);
  originalHistory = fs.existsSync(HISTORY) ? fs.readFileSync(HISTORY, 'utf8') : null;
  historyCaptured = true;
  const quiet = JSON.parse(JSON.stringify(originalConfig));
  quiet.syncToMemory = false;
  quiet.autoTask = false;
  quiet.autoWatch = false; // 清单还原写盘时不要被 watcher 当成 Agent 外部改动
  await req('/api/config', 'PUT', { config: quiet });

  const watch = [
    path.join(hexoMem, 'MEMORY.md'), path.join(hexoMem, '2026-11-07.md'), path.join(hexoMem, '2026-11-08.md'),
    path.join(fleaMem, 'MEMORY.md'), path.join(fleaMem, '2026-11-07.md'), path.join(fleaMem, '2026-11-08.md')
  ];
  const snap = Object.fromEntries(watch.map(f => [f, sha(f)]));
  const backlogFile = path.join(hexoMem, '改造清单.md');
  const before = fs.readFileSync(backlogFile, 'utf8');
  originalBacklog = { file: backlogFile, text: before };
  bakBefore = fs.existsSync(BAK_DIR) ? fs.readdirSync(BAK_DIR) : [];
  backupsCaptured = true;

  let r = await req('/api/state');
  const hexo = r.data.projects.find(p => p.id === 'hexo-theme-diversity');
  const flea = r.data.projects.find(p => p.id === 'flea-framework');
  check('TC-001 状态接口与两项目清单解析',
    r.status === 200 && hexo.items.length === 11 && flea.items.length === 21,
    `hexo ${hexo.items.length} 条 / flea ${flea.items.length} 条`);
  check('TC-002 代码根与记忆根分离生效',
    hexo.backlogPath.replace(/\\/g, '/').includes('.workbuddy') && !hexo.backlogPath.replace(/\\/g, '/').includes('themes/diversity'),
    hexo.backlogPath);
  check('TC-003 两项目路径健康检查通过',
    Object.values(hexo.health).every(Boolean) && Object.values(flea.health).every(Boolean));
  check('TC-004 被推翻/已移除项保留决策留痕',
    hexo.items.find(i => i.id === '2')?.status === 'removed' &&
    flea.items.find(i => i.id === '2')?.status === 'removed');

  r = await req('/api/memory/hexo-theme-diversity');
  check('TC-005 读取 Agent 记忆（长期笔记 + 日志）',
    r.status === 200 && r.data.contextFiles.some(f => f.name === 'MEMORY.md') && r.data.dailyLogs.length >= 2,
    `${r.data.dailyLogs.length} 个日志文件`);

  const html = await fetch(BASE + '/').then(x => x.text());
  check('TC-006 看板页面可访问', html.includes('改造清单台'));

  let mt = await mtimeOf('hexo-theme-diversity');
  r = await req('/api/items/hexo-theme-diversity', 'POST',
    { title: '【自动化验收】临时条目', priority: 'P1', note: 'smoke test', expectedMtime: mt });
  const newId = r.data.items?.at(-1)?.id;
  check('TC-007 新增改造项', r.status === 200 && r.data.items.length === 12, '新 id=' + newId);

  mt = await mtimeOf('hexo-theme-diversity');
  r = await req(`/api/items/hexo-theme-diversity/${newId}`, 'PATCH',
    { priority: 'P0', status: 'doing', expectedMtime: mt });
  const edited = r.data.items.find(i => i.id === newId);
  check('TC-008 修改优先级与状态',
    r.status === 200 && edited.priority === 'P0' && edited.status === 'doing');

  const disk = fs.readFileSync(backlogFile, 'utf8');
  check('TC-009 变更即时写回记忆文件',
    disk.includes('【自动化验收】临时条目') && disk.includes(`| ${newId} | P0 | doing |`));
  check('TC-010 标记区块外的手写备注保留',
    disk.includes('## 抽取说明（工作台不改动此区块）'));
  check('TC-011 写前备份在工作台目录、不污染记忆目录',
    fs.existsSync(BAK_DIR) && fs.readdirSync(BAK_DIR).length > bakBefore.length &&
    !fs.existsSync(backlogFile + '.bak'));

  r = await req(`/api/items/hexo-theme-diversity/${newId}`, 'PATCH',
    { note: 'should fail', expectedMtime: 1 });
  check('TC-012 外部改动冲突检测（409 拒绝覆盖）',
    r.status === 409 && /已被外部修改/.test(r.data.error || ''), r.data.error);

  mt = await mtimeOf('hexo-theme-diversity');
  r = await req(`/api/items/hexo-theme-diversity/${newId}`, 'DELETE', { expectedMtime: mt });
  check('TC-013 删除默认为软删除 removed',
    r.status === 200 && r.data.items.find(i => i.id === newId).status === 'removed');

  mt = await mtimeOf('hexo-theme-diversity');
  r = await req(`/api/items/hexo-theme-diversity/${newId}`, 'DELETE', { hard: true, expectedMtime: mt });
  check('TC-014 彻底删除后条数还原', r.status === 200 && r.data.items.length === 11);

  const after = fs.readFileSync(backlogFile, 'utf8');
  check('TC-015 清单文件逐字节无损还原', after === before, `${Buffer.byteLength(after)} bytes`);
  check('TC-016 验收期间原始记忆零改动（同步已临时关闭）',
    watch.every(f => sha(f) === snap[f]));

  const cfg = (await req('/api/state')).data.config;
  const badCfg = JSON.parse(JSON.stringify(cfg));
  badCfg.agents.workbuddy.memoryDir = 'C:/Windows';
  r = await req('/api/config', 'PUT', { config: badCfg });
  check('TC-017 Agent 绝对路径越界被拒绝',
    r.status === 400 && /相对路径/.test(r.data.error || ''), r.data.error);
  check('TC-018 非法配置未落盘',
    (await req('/api/state')).data.config.agents.workbuddy.memoryDir === '.workbuddy/memory');

  const failed = results.filter(x => !x.ok).length;
  console.log(`\n结果：${results.length - failed}/${results.length} 通过`);
  await cleanup();
  process.exitCode = failed ? 1 : 0;
})().catch(async e => {
  console.error('测试异常：', e);
  await cleanup();
  process.exitCode = 1;
});
