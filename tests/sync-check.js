'use strict';

// 记忆同步验收：全程只在系统临时目录的临时项目上操作，跑完恢复配置并清理。
// 运行：node tests/sync-check.js（需服务已在 127.0.0.1:8787 运行）

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT) || 8787;
const TEST_ID = 'pbw-sync-test';
const TEST_ID2 = 'pbw-sync-custom';
const d = new Date();
const pad = n => String(n).padStart(2, '0');
const DATE = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const TMP = path.join(os.tmpdir(), `pbw-sync-${process.pid}`);
const MEM = path.join(TMP, '.workbuddy', 'memory');
const DATA = process.env.BACKLOG_HOME ? path.resolve(process.env.BACKLOG_HOME) : ROOT;
const HISTORY = path.join(DATA, 'history.jsonl');

const CONTEXT = `# 项目长期笔记（测试）

## 改造清单决策

- 2026-11-08：#1 仍为 P0 待办，后续盘点列入 P0。

## 其它

- 手写备注，工作台不得改动。
`;
const DAILY = `# ${DATE}

- 历史记录 A
- 历史记录 B
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
        catch (e) {
          reject(new Error(`非 JSON 响应 ${method} ${url}: status=${res.statusCode} ` +
            `type=${res.headers['content-type']} len=${s.length} body=${s.slice(0, 300)}`));
        }
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}
const read = f => fs.readFileSync(f, 'utf8');
const state = () => req('GET', '/api/state');
async function mtimeOf(id) {
  const s = await state();
  return s.data.projects.find(p => p.id === id).mtime;
}
async function mutate(method, url, body, id = TEST_ID) {
  return req(method, url, { ...body, expectedMtime: await mtimeOf(id) });
}
function cleanupDir(dir) {
  if (!fs.existsSync(dir)) return;
  for (const n of fs.readdirSync(dir)) {
    const f = path.join(dir, n);
    if (fs.statSync(f).isDirectory()) cleanupDir(f);
    else fs.unlinkSync(f);
  }
  fs.rmdirSync(dir);
}

(async () => {
  const originalConfig = (await state()).data.config;
  const originalHistory = fs.existsSync(HISTORY) ? read(HISTORY) : null;
  fs.mkdirSync(MEM, { recursive: true });
  fs.writeFileSync(path.join(MEM, 'MEMORY.md'), CONTEXT, 'utf8');
  fs.writeFileSync(path.join(MEM, `${DATE}.md`), DAILY, 'utf8');
  fs.writeFileSync(path.join(MEM, '改造清单.md'), BACKLOG, 'utf8');
  fs.writeFileSync(path.join(MEM, 'NOTES.md'), CONTEXT, 'utf8');
  fs.writeFileSync(path.join(MEM, `log-${DATE}.md`), DAILY, 'utf8');
  fs.writeFileSync(path.join(MEM, '清单.md'), BACKLOG, 'utf8');

  try {
    const cfg = JSON.parse(JSON.stringify(originalConfig));
    cfg.agents['test-agent'] = {
      label: '测试Agent', memoryDir: '.workbuddy/memory', backlogFile: '清单.md',
      contextFiles: ['NOTES.md'], syncFile: 'NOTES.md',
      dailyPattern: '^log-\\d{4}-\\d{2}-\\d{2}\\.md$', dailyFile: `log-{date}.md`
    };
    cfg.projects.push({
      id: TEST_ID, name: TEST_ID, projectRoot: TMP, memoryRoot: TMP, agent: 'workbuddy'
    });
    cfg.projects.push({
      id: TEST_ID2, name: TEST_ID2, projectRoot: TMP, memoryRoot: TMP, agent: 'test-agent'
    });
    const put = await req('PUT', '/api/config', { config: cfg });
    ok('临时配置写入成功（未碰真实项目配置）', put.status === 200);

    const st = (await state()).data.projects.find(p => p.id === TEST_ID);
    ok('临时项目记忆路径健康', Object.values(st.health).every(Boolean));
    ok('同步开关默认开启', st.sync.enabled === true);
    ok('同步前无状态镜像', st.sync.lastSync === null);

    // 1. 新增 → 自动同步
    let r = await mutate('POST', `/api/items/${TEST_ID}`, { title: '新增项 B', priority: 'P1' });
    ok('新增写回成功', r.status === 200 && r.data.items.length === 2);
    ok('新增触发双通道同步', r.data.sync.context === true && r.data.sync.daily === true);
    let ctx = read(path.join(MEM, 'MEMORY.md'));
    let daily = read(path.join(MEM, `${DATE}.md`));
    ok('长期笔记历史部分逐字节不变', ctx.startsWith(CONTEXT.trimEnd()));
    ok('镜像区块只有一对标记', (ctx.match(/<!-- backlog-sync:begin -->/g) || []).length === 1 &&
      (ctx.match(/<!-- backlog-sync:end -->/g) || []).length === 1);
    ok('镜像含新增项与汇总', ctx.includes('新增项 B') && ctx.includes('共 2 项'));
    ok('当天日志为 append-only（原文完整前缀）', daily.startsWith(DAILY));
    ok('当天日志追加了新增记录', daily.includes('新增 #2「新增项 B」'));
    ok('清单头部加入权威声明', read(path.join(MEM, '改造清单.md')).includes('唯一权威状态'));
    ok('清单区块外备注保留', read(path.join(MEM, '改造清单.md')).includes('手写内容 XYZ'));

    // 2. 改优先级 → 镜像幂等、日志再追加一行
    const ctxAfterAdd = ctx;
    r = await mutate('PATCH', `/api/items/${TEST_ID}/2`, { priority: 'P0' });
    ok('改优先级写回成功', r.status === 200);
    ctx = read(path.join(MEM, 'MEMORY.md'));
    daily = read(path.join(MEM, `${DATE}.md`));
    ok('镜像仍只有一对标记（幂等替换）', (ctx.match(/<!-- backlog-sync:begin -->/g) || []).length === 1);
    ok('镜像反映新优先级', ctx.includes('| 2 | P0 | 待办 | 新增项 B |'));
    ok('长期笔记历史部分仍逐字节不变', ctx.startsWith(CONTEXT.trimEnd()));
    ok('日志追加优先级变更', daily.includes('优先级 P1 → P0'));
    ok('日志原有内容未被改写', daily.startsWith(DAILY));
    ok('镜像内容确实发生了变化', ctx !== ctxAfterAdd);

    // 3. 软删除 → 状态镜像标记已移除
    r = await mutate('DELETE', `/api/items/${TEST_ID}/2`, {});
    ok('软删除写回成功', r.status === 200 && r.data.items.find(i => i.id === '2').status === 'removed');
    ctx = read(path.join(MEM, 'MEMORY.md'));
    daily = read(path.join(MEM, `${DATE}.md`));
    ok('镜像标记 #2 已移除', ctx.includes('| 2 | P0 | 已移除 | 新增项 B |'));
    ok('日志追加移除记录', daily.includes('标记为**已移除**'));
    ok('日志含「不再作为依据」约束', daily.includes('不再作为依据'));

    // 4. 补同步接口
    r = await req('POST', `/api/sync/${TEST_ID}`, {});
    ok('补同步接口可用', r.status === 200 && r.data.sync.context && r.data.sync.daily);
    ok('补同步写入校准记录', read(path.join(MEM, `${DATE}.md`)).includes('校准状态镜像'));

    // 5. 硬删除 → 镜像中消失
    r = await mutate('DELETE', `/api/items/${TEST_ID}/2`, { hard: true });
    ok('硬删除写回成功', r.status === 200 && r.data.items.length === 1);
    ok('硬删除后镜像不再含该项', !read(path.join(MEM, 'MEMORY.md')).includes('新增项 B'));
    ok('日志记录彻底删除', read(path.join(MEM, `${DATE}.md`)).includes('**彻底删除**'));

    // 6. 关闭开关 → 两个记忆文件都不写
    const off = JSON.parse(JSON.stringify(cfg));
    off.syncToMemory = false;
    await req('PUT', '/api/config', { config: off });
    const ctxBefore = read(path.join(MEM, 'MEMORY.md'));
    const dailyBefore = read(path.join(MEM, `${DATE}.md`));
    r = await mutate('POST', `/api/items/${TEST_ID}`, { title: '关闭同步后的项' });
    ok('关闭开关后主写回仍成功', r.status === 200 && r.data.sync.enabled === false);
    ok('关闭开关后长期笔记逐字节不变', read(path.join(MEM, 'MEMORY.md')) === ctxBefore);
    ok('关闭开关后当天日志逐字节不变', read(path.join(MEM, `${DATE}.md`)) === dailyBefore);

    // 7. 自定义 Agent 适配器（不同记忆文件名）
    const on = JSON.parse(JSON.stringify(cfg));
    await req('PUT', '/api/config', { config: on });
    r = await mutate('POST', `/api/items/${TEST_ID2}`, { title: '自定义 Agent 项' }, TEST_ID2);
    ok('自定义 Agent 新增成功', r.status === 200);
    ok('自定义 Agent 写入 NOTES.md', read(path.join(MEM, 'NOTES.md')).includes('自定义 Agent 项'));
    ok('自定义 Agent 写入 log-{date}.md', read(path.join(MEM, `log-${DATE}.md`)).includes('自定义 Agent 项'));
    ok('自定义 Agent 未误写 MEMORY.md', !read(path.join(MEM, 'MEMORY.md')).includes('自定义 Agent 项'));

    // 8. 路径越界在配置层被拒绝
    const evil = JSON.parse(JSON.stringify(cfg));
    evil.agents.workbuddy.syncFile = '../evil.md';
    const bad = await req('PUT', '/api/config', { config: evil });
    ok('越界 syncFile 被配置校验拒绝', bad.status === 400);
    ok('非法配置未落盘', (await state()).data.config.agents.workbuddy.syncFile === 'MEMORY.md');

    // 9. 备份
    ok('写前备份已生成', fs.existsSync(path.join(DATA, 'backups', TEST_ID)) &&
      fs.readdirSync(path.join(DATA, 'backups', TEST_ID)).some(n => n.endsWith('.md')));

    console.log(`\n结果：${checks.filter(c => c[1]).length}/${checks.length} 通过`);
    if (checks.some(c => !c[1])) process.exitCode = 1;
  } finally {
    await req('PUT', '/api/config', { config: originalConfig });
    if (originalHistory === null) {
      if (fs.existsSync(HISTORY)) fs.unlinkSync(HISTORY);
    } else {
      fs.writeFileSync(HISTORY, originalHistory, 'utf8');
    }
    cleanupDir(TMP);
    cleanupDir(path.join(DATA, 'backups', TEST_ID));
    cleanupDir(path.join(DATA, 'backups', TEST_ID2));
    console.log('清理：配置已恢复、history 已还原、临时目录与测试备份已删除');
  }
})().catch(e => {
  console.error('验收异常：' + e.stack);
  process.exitCode = 1;
});
