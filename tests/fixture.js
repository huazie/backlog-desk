'use strict';

// 隔离测试夹具：在系统临时目录造出与真实项目同构的两个假项目。
// 项目 id、清单条数、日志文件名与 smoke.js 的硬编码断言对齐，使其无需改造即可跑在 fixture 上。
// 数据全部为脱敏示例，不含任何真实项目路径、提交号或待办内容。

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const HEADERS = ['id', 'priority', 'status', 'title', 'note', 'updated'];
const PRIORITIES = ['P0', 'P1', 'P2', 'P3'];
const DATE = '2026-11-09';
const LEGACY_DATES = ['2026-11-07', '2026-11-08'];
const MARK_BEGIN = '<!-- backlog:begin -->';
const MARK_END = '<!-- backlog:end -->';
const SYNC_BEGIN = '<!-- backlog-sync:begin -->';
const SYNC_END = '<!-- backlog-sync:end -->';
// 必须与 server.js 的 HEADER_DECL 逐字一致，否则同步时会插入新行，破坏清单逐字节还原断言
const HEADER_DECL = '> 权威状态：本文件标记区块为改造清单唯一权威状态；长期笔记与日志中的历史清单描述仅为决策留痕，不作为当前待办依据。';

const fingerprint = items => crypto.createHash('sha256')
  .update(items.map(i => HEADERS.map(k => String(i[k] == null ? '' : i[k])).join('\u0001')).join('\n'))
  .digest('hex').slice(0, 16);

function makeItems(projectId, count) {
  return Array.from({ length: count }, (_, i) => {
    const id = String(i + 1);
    // #2 固定 removed（TC-004），其余覆盖 todo / doing / done 与 P0~P3
    const status = id === '2' ? 'removed' : i % 7 === 3 ? 'done' : i % 5 === 2 ? 'doing' : 'todo';
    return {
      id,
      priority: PRIORITIES[i % 4],
      status,
      title: `${projectId} 示例改造项 ${id.padStart(2, '0')}`,
      note: 'fixture 示例备注',
      updated: DATE
    };
  });
}

function renderBacklog(name, items) {
  const rows = items.map(i => '| ' + HEADERS.map(k => i[k]).join(' | ') + ' |');
  return `# 改造清单 · ${name}

> 由「改造清单台 · Backlog Desk」维护；标记区块内请勿手工改格式。
> 最近同步：${DATE}
${HEADER_DECL}

${MARK_BEGIN}
| ${HEADERS.join(' | ')} |
| ${HEADERS.map(() => '---').join(' | ')} |
${rows.join('\n')}
${MARK_END}

## 抽取说明（工作台不改动此区块）

- 本文件由 npm test 的隔离 fixture 生成，不含任何真实项目数据。
- #2 固定为 removed，用于覆盖 smoke.js 的 TC-004 断言。
`;
}

function renderMemory(name, items) {
  return `# 项目长期笔记（${name} · fixture）

## 手写备注

- 工作台不得改动此行。

${SYNC_BEGIN}
## 改造清单 · 当前状态镜像（工作台自动维护）

> 清单指纹：\`${fingerprint(items)}\`

${SYNC_END}
`;
}

const renderDaily = date => `# ${date}

- fixture 历史记录 A
- fixture 历史记录 B
`;

function createFixture(dataDir) {
  const root = path.resolve(dataDir);
  fs.mkdirSync(root, { recursive: true });
  const specs = [
    { id: 'hexo-theme-diversity', name: '示例前端项目 fixture', count: 11 },
    { id: 'flea-framework', name: '示例后端项目 fixture', count: 21 }
  ];
  const projects = [];
  for (const s of specs) {
    const projectRoot = path.join(root, 'projects', s.id);
    const mem = path.join(projectRoot, '.workbuddy', 'memory');
    fs.mkdirSync(mem, { recursive: true });
    const items = makeItems(s.id, s.count);
    const backlog = renderBacklog(s.name, items);
    // 前端项目清单故意用 CRLF：覆盖 Windows 真实记忆文件，验证写回不产生混合换行（TC-015）
    fs.writeFileSync(path.join(mem, '改造清单.md'),
      s.id === 'hexo-theme-diversity' ? backlog.replace(/\n/g, '\r\n') : backlog, 'utf8');
    fs.writeFileSync(path.join(mem, 'MEMORY.md'), renderMemory(s.name, items), 'utf8');
    for (const d of [...LEGACY_DATES, DATE]) {
      fs.writeFileSync(path.join(mem, `${d}.md`), renderDaily(d), 'utf8');
    }
    // 统一正斜杠：与 demo/config.json 一致，且避免 Windows 路径在 JSON 里出现转义歧义
    const posixRoot = projectRoot.replace(/\\/g, '/');
    projects.push({
      id: s.id, name: s.name, projectRoot: posixRoot, memoryRoot: posixRoot, agent: 'workbuddy'
    });
  }
  const config = {
    port: 8787,
    syncToMemory: true,
    autoWatch: true,
    autoCalibrate: true,
    autoTask: true,
    agents: {
      workbuddy: {
        label: 'WorkBuddy',
        memoryDir: '.workbuddy/memory',
        backlogFile: '改造清单.md',
        contextFiles: ['MEMORY.md'],
        syncFile: 'MEMORY.md',
        dailyPattern: '^\\d{4}-\\d{2}-\\d{2}\\.md$',
        dailyFile: '{date}.md'
      }
    },
    projects
  };
  // --data-dir <tmp> 时 configFile = <tmp>/config.json（server.js:26 resolvePaths）
  fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify(config, null, 2) + '\n', 'utf8');
  return { root, config };
}

module.exports = { createFixture };
