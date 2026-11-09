'use strict';

// 自动跟踪验收：全程只在系统临时目录的临时项目上操作，模拟「Agent 直接改清单」。
// 跑完恢复配置、还原 history、清理临时目录与备份，不碰任何真实项目记忆。
// 运行：node tests/track-check.js（需服务已在 127.0.0.1:8787 运行）

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT) || 8787;
const TEST_ID = 'pbw-track-test';
const TMP = path.join(os.tmpdir(), `pbw-track-${process.pid}`);
const MEM = path.join(TMP, '.workbuddy', 'memory');
const DATA = process.env.BACKLOG_HOME ? path.resolve(process.env.BACKLOG_HOME) : ROOT;
const HISTORY = path.join(DATA, 'history.jsonl');
const d = new Date();
const pad = n => String(n).padStart(2, '0');
const DATE = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const CONTEXT = `# 项目长期笔记（自动跟踪验收）

## 历史决策

- 2026-11-08：#1 仍为 P0 待办，后续盘点列入 P0。

## 手写备注

- 工作台不得改动此行。
`;
const DAILY = `# ${DATE}

- 历史日志 A
- 历史日志 B
`;
const BACKLOG = `# 改造清单 · ${TEST_ID}

> 由工作台维护
> 最近同步：${DATE}

<!-- backlog:begin -->
| id | priority | status | title | note | updated |
| --- | --- | --- | --- | --- | --- |
| 1 | P0 | todo | 原有项 A | | ${DATE} |
<!-- backlog:end -->

## 备注（工作台不改动此区块）
- 手写内容 XYZ
`;

const checks = [];
function ok(name, cond) {
  checks.push([name, !!cond]);
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name);
}
const read = f => fs.readFileSync(f, 'utf8');
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const wait = ms => new Promise(r => setTimeout(r, ms));
// watcher 去抖 500ms + 文件读写，慢 CI 上给足窗口；负向断言必须等这一段过去
const SETTLE_WAIT = 1200;
async function waitFor(predicate, timeoutMs = 6000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await wait(100);
  }
  return false;
}

function req(method, url, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const r = http.request({
      host: '127.0.0.1', port: PORT, path: url, method,
      headers: data
        ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
        : {}
    }, res => {
      let s = '';
      res.on('data', c => s += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(s) }); }
        catch (e) { reject(new Error(`非 JSON 响应 ${method} ${url}: ${res.statusCode} ${s.slice(0, 200)}`)); }
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

function openSSE() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const r = http.request({ host: '127.0.0.1', port: PORT, path: '/api/events', method: 'GET' }, res => {
      res.setEncoding('utf8');
      res.on('data', c => chunks.push(c));
      resolve({ chunks, res, status: res.statusCode });
    });
    r.on('error', reject);
    r.end();
  });
}

const state = () => req('GET', '/api/state');
const cfgNow = async () => (await state()).data.config;
async function mtimeOf(id) {
  const s = await state();
  return s.data.projects.find(p => p.id === id).mtime;
}
async function mutate(method, url, body) {
  return req(method, url, { ...body, expectedMtime: await mtimeOf(TEST_ID) });
}
async function putConfig(mut) {
  const c = JSON.parse(JSON.stringify(await cfgNow()));
  mut(c);
  const r = await req('PUT', '/api/config', { config: c });
  if (r.status !== 200) throw new Error('配置写入失败：' + r.data.error);
  return c;
}
const eventsOf = (source, action) => {
  if (!fs.existsSync(HISTORY)) return [];
  return read(HISTORY).trim().split(/\r?\n/).filter(Boolean).flatMap(l => {
    try {
      const e = JSON.parse(l);
      return (e.source === source && (!action || e.action === action)) ? [e] : [];
    } catch (_) { return []; }
  });
};
function externalWrite(title) {
  const f = path.join(MEM, '改造清单.md');
  const text = read(f);
  const at = text.indexOf('<!-- backlog:end -->');
  const row = `| 90 | P1 | todo | ${title} | 由 Agent 直接写入 | ${DATE} |\n`;
  fs.writeFileSync(f, text.slice(0, at) + row + text.slice(at), 'utf8');
}
function cleanupDir(dir) {
  // Windows 上 watcher 可能仍占着句柄，交给 rmSync 重试而不是逐个 unlink
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

(async () => {
  const originalConfig = (await state()).data.config;
  const originalHistory = fs.existsSync(HISTORY) ? read(HISTORY) : null;
  const ctxPath = path.join(MEM, 'MEMORY.md');
  const logPath = path.join(MEM, `${DATE}.md`);
  const backlogPath = path.join(MEM, '改造清单.md');
  let sse = null;

  fs.mkdirSync(MEM, { recursive: true });
  fs.writeFileSync(ctxPath, CONTEXT, 'utf8');
  fs.writeFileSync(logPath, DAILY, 'utf8');
  fs.writeFileSync(backlogPath, BACKLOG, 'utf8');

  try {
    await putConfig(c => c.projects.push({
      id: TEST_ID, name: TEST_ID, projectRoot: TMP, memoryRoot: TMP, agent: 'workbuddy'
    }));

    // 1. 监听与基线
    let st = (await state()).data;
    const proj = () => st.projects.find(p => p.id === TEST_ID);
    ok('临时项目记忆路径健康', Object.values(proj().health).every(Boolean));
    ok('记忆目录已进入监听清单', st.track.watchDirs.some(x => path.resolve(x) === path.resolve(MEM)));
    ok('初始无指纹基线时提示 unknown', proj().track.drift === 'unknown');

    // 2. 工作台自写不应被误判为 Agent 外部改动
    const agentBefore = eventsOf('agent').length;
    let r = await mutate('POST', `/api/items/${TEST_ID}`, { title: '工作台新增项 B', priority: 'P1' });
    ok('工作台新增写回成功', r.status === 200 && r.data.items.length === 2);
    await wait(SETTLE_WAIT);
    ok('工作台自写未误判为外部改动（自写抑制）', eventsOf('agent').length === agentBefore);
    st = (await state()).data;
    ok('新增生成 1 张 pending 任务卡', st.tasks.length === 1 && st.tasks[0].status === 'pending');
    const task = st.tasks[0].task;
    ok('任务卡含条目与项目路径', task && task.itemId === '2' && task.title === '工作台新增项 B' &&
      path.resolve(task.memoryDir) === path.resolve(MEM));
    ok('任务卡指令写明唯一权威源与禁止项',
      task && task.prompt.includes('唯一权威源') && task.prompt.includes('不要删行') &&
      task.prompt.includes('不要自动 commit'));

    // 3. 校准后指纹一致、漂移消失
    ok('工作台写回后已建立镜像指纹基线', proj().track.drift === false);
    const ctx1 = read(ctxPath);
    const fp = (ctx1.match(/^> 清单指纹：`([0-9a-f]{16})`/m) || [])[1];
    ok('镜像指纹与清单指纹一致', fp && fp === proj().track.fingerprint);
    ok('长期笔记历史前缀逐字节不变', ctx1.startsWith(CONTEXT.trimEnd()));

    // 4. 改优先级不生成任务卡；转 doing 才生成
    const tasksBefore = st.tasks.length;
    r = await mutate('PATCH', `/api/items/${TEST_ID}/2`, { priority: 'P0' });
    ok('改优先级写回成功', r.status === 200);
    st = (await state()).data;
    ok('改优先级不生成新任务卡', st.tasks.length === tasksBefore);
    r = await mutate('PATCH', `/api/items/${TEST_ID}/2`, { status: 'doing' });
    ok('状态转为进行中写回成功', r.status === 200);
    st = (await state()).data;
    ok('转 doing 生成第 2 张任务卡', st.tasks.length === tasksBefore + 1);

    // 5. 任务卡可关闭
    r = await req('POST', `/api/tasks/${encodeURIComponent(st.tasks[0].id)}`, { status: 'done' });
    ok('任务卡可标记完成', r.status === 200 && r.data.tasks.length === st.tasks.length - 1);

    // 6. SSE 连接
    sse = await openSSE();
    await waitFor(() => sse.chunks.join('').includes(': connected'), 3000);
    ok('SSE 通道建立成功', sse.status === 200 && sse.chunks.join('').includes(': connected'));

    // 7. Agent 直接改清单 → 自动感知 + 自动校准
    const agentEventsBefore = eventsOf('agent', 'external-change').length;
    const ctxBefore = read(ctxPath);
    const logBefore = read(logPath);
    externalWrite('Agent 外部新增项 C');
    await waitFor(() => eventsOf('agent', 'external-change').length > agentEventsBefore &&
      read(ctxPath).includes('Agent 外部新增项 C'));
    const agentEvents = eventsOf('agent', 'external-change');
    ok('Agent 外部改动被识别为 1 条 source:agent 事件',
      agentEvents.length === agentEventsBefore + 1, `新增 ${agentEvents.length - agentEventsBefore} 条`);
    const ctx2 = read(ctxPath);
    const log2 = read(logPath);
    ok('自动校准：镜像包含 Agent 新增项', ctx2.includes('Agent 外部新增项 C'));
    ok('自动校准：当天日志追加外部变更留痕', log2.length > logBefore.length &&
      log2.includes('检测到 Agent 或手工直接改动'));
    ok('长期笔记历史前缀仍逐字节不变', ctx2.startsWith(CONTEXT.trimEnd()));
    ok('当天日志为 append-only（原文完整前缀）', log2.startsWith(logBefore));
    st = (await state()).data;
    ok('校准后漂移标记归零', proj().track.drift === false);
    const fp2 = (ctx2.match(/^> 清单指纹：`([0-9a-f]{16})`/m) || [])[1];
    ok('校准后镜像指纹与清单一致', fp2 === proj().track.fingerprint);
    ok('SSE 推送了 change 广播', sse.chunks.join('').includes('"type":"change"'));
    ok('镜像仍只有一对标记（幂等替换）',
      (ctx2.match(/<!-- backlog-sync:begin -->/g) || []).length === 1);

    // 8. 事件去重：内容不变重复写盘不再产生新事件
    const cnt = eventsOf('agent', 'external-change').length;
    const text = read(backlogPath);
    fs.writeFileSync(backlogPath, text, 'utf8');
    await wait(SETTLE_WAIT);
    ok('相同内容重复写盘不重复记事件（去重）', eventsOf('agent', 'external-change').length === cnt);

    // 9. 关闭自动校准：仍感知、不写记忆、标记漂移
    await putConfig(c => { c.autoCalibrate = false; });
    const ctx3 = read(ctxPath);
    const log3 = read(logPath);
    const ev3 = eventsOf('agent', 'external-change').length;
    externalWrite('关闭校准后的外部项 D');
    await waitFor(() => eventsOf('agent', 'external-change').length > ev3);
    ok('关闭自动校准后仍感知外部改动', eventsOf('agent', 'external-change').length === ev3 + 1);
    ok('关闭自动校准后长期笔记逐字节不变', read(ctxPath) === ctx3);
    ok('关闭自动校准后当天日志逐字节不变', read(logPath) === log3);
    st = (await state()).data;
    ok('关闭自动校准后漂移标记为 true', proj().track.drift === true);

    // 10. 恢复校准并关闭全局监听：外部改动不再被感知
    await putConfig(c => { c.autoCalibrate = true; c.autoWatch = false; });
    st = (await state()).data;
    ok('全局关闭后监听目录清空', st.track.watchDirs.length === 0);
    const ev4 = eventsOf('agent', 'external-change').length;
    externalWrite('关闭监听后的外部项 E');
    await wait(SETTLE_WAIT);
    ok('全局关闭 autoWatch 后不感知外部改动', eventsOf('agent', 'external-change').length === ev4);

    // 11. 关闭任务卡生成
    await putConfig(c => { c.autoWatch = true; c.autoTask = false; });
    await wait(200);
    const tk = (await state()).data.tasks.length;
    r = await mutate('POST', `/api/items/${TEST_ID}`, { title: '关闭任务卡后的新增项' });
    ok('关闭 autoTask 后新增仍写回成功', r.status === 200);
    ok('关闭 autoTask 后不生成任务卡', (await state()).data.tasks.length === tk);

    // 12. 关闭记忆同步时，外部改动也不写真实记忆文件
    await putConfig(c => { c.autoTask = true; c.syncToMemory = false; });
    const ctx5 = read(ctxPath);
    const log5 = read(logPath);
    externalWrite('关闭同步后的外部项 F');
    await wait(SETTLE_WAIT);
    ok('关闭 syncToMemory 后外部改动不写长期笔记', read(ctxPath) === ctx5);
    ok('关闭 syncToMemory 后外部改动不写当天日志', read(logPath) === log5);

    console.log(`\n结果：${checks.filter(c => c[1]).length}/${checks.length} 通过`);
    if (checks.some(c => !c[1])) process.exitCode = 1;
  } finally {
    if (sse && sse.res) { try { sse.res.destroy(); } catch (_) { /* 已断开 */ } }
    await req('PUT', '/api/config', { config: originalConfig });
    if (originalHistory === null) {
      if (fs.existsSync(HISTORY)) fs.unlinkSync(HISTORY);
    } else {
      fs.writeFileSync(HISTORY, originalHistory, 'utf8');
    }
    cleanupDir(TMP);
    cleanupDir(path.join(DATA, 'backups', TEST_ID));
    console.log('清理：配置已恢复、history 已还原、临时目录与测试备份已删除');
  }
})().catch(e => {
  console.error('验收异常：' + e.stack);
  process.exitCode = 1;
});
