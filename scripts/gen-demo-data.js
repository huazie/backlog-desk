#!/usr/bin/env node
'use strict';

// 生成静态演示数据：读取包内 demo/（只读），产出 public/demo-data.js（window.DEMO_DATA）。
// 用法：node scripts/gen-demo-data.js  （在仓库根目录执行）
// 产物全部为虚构示例与包内相对路径，不含任何真实项目记忆或绝对路径。

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DEMO_DIR = path.join(ROOT, 'demo');
const OUT_FILE = path.join(ROOT, 'public', 'demo-data.js');

const MARK_BEGIN = '<!-- backlog:begin -->';
const MARK_END = '<!-- backlog:end -->';

function parseItems(text) {
  const s = text.indexOf(MARK_BEGIN);
  const e = text.indexOf(MARK_END);
  if (s === -1 || e === -1 || e < s) return [];
  return text.slice(s + MARK_BEGIN.length, e).split(/\r?\n/).flatMap(line => {
    if (!line.startsWith('|')) return [];
    const cells = line.slice(1, -1).split('|').map(c => c.trim());
    if (cells.length < 6 || cells[0] === 'id' || /^[-: ]+$/.test(cells[0])) return [];
    return [{
      id: cells[0], priority: cells[1], status: cells[2],
      title: cells[3], note: cells[4], updated: cells[5]
    }];
  });
}

function lastSyncOf(text) {
  const m = text.match(/^> 最后同步：(.+?) ｜/m);
  return m ? m[1] : null;
}

function dailyLogsOf(dir, pattern) {
  let names = [];
  try {
    names = fs.readdirSync(dir).filter(n => pattern.test(n)).sort().reverse().slice(0, 5);
  } catch (_) { return []; }
  return names.map(name => {
    const text = fs.readFileSync(path.join(dir, name), 'utf8');
    const lines = text.split(/\r?\n/).filter(Boolean);
    return {
      name,
      headings: lines.filter(l => /^##\s+/.test(l)).map(l => l.replace(/^##\s+/, '')),
      lines: lines.length,
      tail: lines.slice(-5).join('\n')
    };
  });
}

function generate() {
  const raw = JSON.parse(fs.readFileSync(path.join(DEMO_DIR, 'config.json'), 'utf8'));
  const demoRoot = path.join(DEMO_DIR, 'projects');

  const agents = {};
  for (const [k, a] of Object.entries(raw.agents || {})) {
    agents[k] = { ...a, dispatchCommand: '' }; // 示例适配器不带派发命令：演示态不支持派发
  }

  const projects = {};
  const projectCfgs = [];
  for (const p of raw.projects || []) {
    const memDir = path.join(demoRoot, p.id, (raw.agents?.[p.agent]?.memoryDir || '.'));
    const backlogFile = path.join(memDir, raw.agents?.[p.agent]?.backlogFile || '改造清单.md');
    const items = parseItems(fs.readFileSync(backlogFile, 'utf8'));
    const memDirRel = `demo/projects/${p.id}/.workbuddy/memory`;

    let pattern;
    try { pattern = new RegExp(raw.agents?.[p.agent]?.dailyPattern || '^\\d{4}-\\d{2}-\\d{2}\\.md$'); }
    catch (_) { pattern = /^\d{4}-\d{2}-\d{2}\.md$/; }

    const contextFiles = [];
    for (const name of (raw.agents?.[p.agent]?.contextFiles || [])) {
      const fp = path.join(memDir, name);
      if (fs.existsSync(fp)) contextFiles.push({ name, content: fs.readFileSync(fp, 'utf8') });
    }

    projects[p.id] = {
      mtime: 1762600000000 + (projectCfgs.length + 1) * 1000,
      items,
      lastSync: lastSyncOf(contextFiles[0]?.content || ''),
      fingerprint: '0'.repeat(16),
      memory: {
        memoryDir: memDirRel,
        contextFiles,
        dailyLogs: dailyLogsOf(memDir, pattern)
      }
    };
    projectCfgs.push({
      id: p.id, name: p.name,
      projectRoot: `demo/projects/${p.id}`,
      memoryRoot: `demo/projects/${p.id}`,
      agent: p.agent
    });
  }

  const data = {
    generatedAt: new Date().toISOString(),
    config: {
      port: 8788,
      syncToMemory: raw.syncToMemory !== false,
      autoWatch: true,
      autoCalibrate: raw.autoCalibrate !== false,
      autoTask: raw.autoTask !== false,
      agents,
      projects: projectCfgs
    },
    projects,
    tasks: []
  };

  const js = '// 由 scripts/gen-demo-data.js 自动生成（源：demo/ 脱敏示例，只读）；手工修改会被下次生成覆盖。\n'
    + 'window.DEMO_DATA = ' + JSON.stringify(data, null, 2) + ';\n';
  fs.writeFileSync(OUT_FILE, js, 'utf8');
  console.log(`已生成 ${path.relative(ROOT, OUT_FILE)}（${(js.length / 1024).toFixed(1)} KB，项目 ${Object.keys(projects).join(' / ')}，条目 ${Object.values(projects).map(p => p.items.length).join(' + ')}）`);
}

module.exports = { generate };
if (require.main === module) generate();
