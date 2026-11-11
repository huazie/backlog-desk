'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const PKG_DIR = __dirname;
const PUBLIC_DIR = path.join(PKG_DIR, 'public');
const DEV_CONFIG = path.join(PKG_DIR, 'config', 'workbench.json');
const DEFAULT_CONFIG = path.join(PKG_DIR, 'config', 'default.json');
const USER_DATA_DIR = path.join(os.homedir(), '.backlog-desk');

// 包目录只读、数据目录可写：运行态产物（配置副本/事件流/备份）统一落 ctx.dataDir。
const ctx = { dataDir: null, configFile: null };
const historyFile = () => path.join(ctx.dataDir, 'history.jsonl');
const backupDirOf = id => path.join(ctx.dataDir, 'backups', id);

const expandHome = v => {
  const s = String(v);
  // ~\ 只在 Windows 是分隔符；POSIX 下反斜杠是普通字符，不能当作家目录前缀
  const homeSep = s === '~' || s.startsWith('~/') || (path.sep === '\\' && s.startsWith('~\\'));
  if (!homeSep) return s;
  return path.join(os.homedir(), s === '~' ? '' : s.slice(2));
};

// 配置可能在 Windows 写、在 POSIX 读：两种平台的绝对路径写法都要识别
const isAbsoluteAny = v => path.isAbsolute(v) || path.win32.isAbsolute(v);

// 沿用目标文件原有的换行风格，避免 Windows 的 CRLF 记忆文件被写成混合换行
const eolOf = text => {
  const crlf = (text.match(/\r\n/g) || []).length;
  const lf = (text.match(/(?<!\r)\n/g) || []).length;
  return crlf > lf ? '\r\n' : '\n';
};

function resolvePaths(opts = {}) {
  ctx.dataDir = path.resolve(expandHome(opts.dataDir || process.env.BACKLOG_HOME ||
    (require.main === module ? PKG_DIR : USER_DATA_DIR)));
  ctx.configFile = opts.config ? path.resolve(expandHome(opts.config))
    : (ctx.dataDir === PKG_DIR && fs.existsSync(DEV_CONFIG)) ? DEV_CONFIG
    : path.join(ctx.dataDir, 'config.json');
}
resolvePaths();

const MARK_BEGIN = '<!-- backlog:begin -->';
const MARK_END = '<!-- backlog:end -->';
const SYNC_BEGIN = '<!-- backlog-sync:begin -->';
const SYNC_END = '<!-- backlog-sync:end -->';
const HEADER_DECL = '> 权威状态：本文件标记区块为改造清单唯一权威状态；长期笔记与日志中的历史清单描述仅为决策留痕，不作为当前待办依据。';
const PRIORITIES = ['P0', 'P1', 'P2', 'P3'];
const STATUSES = ['todo', 'doing', 'done', 'removed'];
const STATUS_LABEL = { todo: '待办', doing: '进行中', done: '已完成', removed: '已移除' };
const HEADERS = ['id', 'priority', 'status', 'title', 'note', 'updated'];
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
};

function localDate(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
const today = () => localDate();
function nowText() {
  const d = new Date();
  return `${localDate(d)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
const hashText = s => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
const fingerprint = items =>
  hashText(items.map(i => HEADERS.map(k => String(i[k] == null ? '' : i[k])).join('\u0001')).join('\n'));

function json(res, code, data) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', c => {
      buf += c;
      if (buf.length > 1024 * 1024) req.destroy();
    });
    req.on('end', () => {
      try { resolve(buf ? JSON.parse(buf) : {}); } catch (e) { reject(new Error('请求体不是合法 JSON')); }
    });
    req.on('error', reject);
  });
}

function loadConfig() {
  const f = ctx.configFile;
  const cfg = JSON.parse(fs.readFileSync(fs.existsSync(f) ? f : DEFAULT_CONFIG, 'utf8'));
  // 仓库内开发配置用相对路径登记兄弟项目，统一以包目录为基准解析，不依赖启动时的 cwd
  if (f === DEV_CONFIG) {
    for (const p of cfg.projects || []) {
      for (const k of ['projectRoot', 'memoryRoot']) {
        const v = String(p[k] == null ? '' : p[k]);
        if (v && !v.startsWith('~') && !isAbsoluteAny(v)) p[k] = path.resolve(PKG_DIR, v);
      }
    }
  }
  return cfg;
}

function saveConfig(cfg) {
  fs.mkdirSync(path.dirname(ctx.configFile), { recursive: true });
  // 开发配置保持相对路径可移植：页面回写的绝对路径还原成相对包目录的写法
  if (ctx.configFile === DEV_CONFIG) {
    for (const p of cfg.projects || []) {
      for (const k of ['projectRoot', 'memoryRoot']) {
        const v = String(p[k] == null ? '' : p[k]);
        if (!v || v.startsWith('~') || !isAbsoluteAny(v)) continue;
        const rel = path.relative(PKG_DIR, v).replace(/\\/g, '/');
        if (rel && !isAbsoluteAny(rel)) p[k] = rel;
      }
    }
  }
  fs.writeFileSync(ctx.configFile, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
}

function validateConfig(cfg) {
  if (!cfg || typeof cfg !== 'object') throw new Error('配置格式不正确');
  if (!cfg.agents || typeof cfg.agents !== 'object' || !Object.keys(cfg.agents).length) {
    throw new Error('至少需要一个 Agent 适配器');
  }
  for (const [key, a] of Object.entries(cfg.agents)) {
    if (!a.memoryDir || !a.backlogFile) throw new Error(`Agent ${key} 缺少 memoryDir 或 backlogFile`);
    for (const k of ['memoryDir', 'backlogFile', 'syncFile', 'dailyFile']) {
      if (!a[k]) continue;
      const v = String(a[k]);
      if (isAbsoluteAny(v) || v.split(/[\\/]/).includes('..')) {
        throw new Error(`Agent ${key} 的 ${k} 必须是记忆目录内的相对路径`);
      }
    }
  }
  if (!Array.isArray(cfg.projects)) throw new Error('projects 必须是数组');
  const ids = new Set();
  for (const p of cfg.projects) {
    if (!p.id || !p.name || !p.projectRoot || !p.memoryRoot || !p.agent) {
      throw new Error('项目缺少必填字段：id / name / projectRoot / memoryRoot / agent');
    }
    if (ids.has(p.id)) throw new Error(`项目 id 重复：${p.id}`);
    ids.add(p.id);
    if (!cfg.agents[p.agent]) throw new Error(`项目 ${p.id} 引用了不存在的 Agent：${p.agent}`);
  }
  return cfg;
}

function agentOf(cfg, p) {
  const a = cfg.agents[p.agent];
  if (!a) throw new Error(`未找到 Agent 适配器：${p.agent}`);
  return a;
}

function projectOf(cfg, id) {
  const p = cfg.projects.find(x => x.id === id);
  if (!p) throw new Error(`项目不存在：${id}`);
  return p;
}

function memoryDirOf(cfg, p) {
  return path.resolve(expandHome(p.memoryRoot), agentOf(cfg, p).memoryDir);
}

function backlogFileOf(cfg, p) {
  return path.join(memoryDirOf(cfg, p), agentOf(cfg, p).backlogFile);
}

function assertInside(base, target) {
  const rel = path.relative(path.resolve(base), path.resolve(target));
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('路径越界：目标文件不在允许的记忆目录内');
  }
  return path.resolve(target);
}

function escCell(v) {
  return String(v == null ? '' : v).replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}

function unescCell(v) {
  return String(v).replace(/\\\|/g, '|').replace(/<br>/g, '\n');
}

function parseBacklog(text) {
  const s = text.indexOf(MARK_BEGIN);
  const e = text.indexOf(MARK_END);
  if (s === -1 || e === -1 || e < s) return { found: false, items: [] };
  const before = text.slice(0, s + MARK_BEGIN.length);
  const after = text.slice(e);
  const items = [];
  for (const line of text.slice(s + MARK_BEGIN.length, e).split(/\r?\n/)) {
    const row = line.trim();
    if (!row.startsWith('|')) continue;
    const cells = row.slice(1, -1).split(/(?<!\\)\|/).map(c => c.trim());
    if (cells.length < HEADERS.length) continue;
    if (cells[0] === 'id' || /^[-: ]+$/.test(cells[0])) continue;
    items.push({
      id: cells[0],
      priority: PRIORITIES.includes(cells[1]) ? cells[1] : 'P2',
      status: STATUSES.includes(cells[2]) ? cells[2] : 'todo',
      title: unescCell(cells[3]),
      note: unescCell(cells[4]),
      updated: cells[5]
    });
  }
  return { found: true, items, before, after };
}

function renderBlock(items) {
  const lines = [
    '',
    '| ' + HEADERS.join(' | ') + ' |',
    '| ' + HEADERS.map(() => '---').join(' | ') + ' |'
  ];
  for (const it of items) {
    lines.push('| ' + [
      it.id, it.priority, it.status,
      escCell(it.title), escCell(it.note), it.updated
    ].join(' | ') + ' |');
  }
  lines.push('');
  return lines.join('\n');
}

function loadItems(cfg, p) {
  const file = backlogFileOf(cfg, p);
  if (!fs.existsSync(file)) return [];
  return parseBacklog(fs.readFileSync(file, 'utf8')).items;
}

/* ---------- 双向事件总线（复用 history.jsonl，兼容旧行） ---------- */

let eventSeq = 0;
function appendEvent(projectId, action, detail, extra = {}) {
  const row = {
    id: `evt-${Date.now().toString(36)}-${(++eventSeq).toString(36)}`,
    time: new Date().toISOString(),
    localTime: nowText(),
    project: projectId,
    source: extra.source || 'workbench',
    action,
    status: extra.status || 'logged',
    item: extra.item || null,
    task: extra.task || null,
    detail
  };
  fs.appendFileSync(historyFile(), JSON.stringify(row) + '\n', 'utf8');
  return row;
}

function readEvents() {
  const histFile = historyFile();
  if (!fs.existsSync(histFile)) return [];
  return fs.readFileSync(histFile, 'utf8').split(/\r?\n/).filter(Boolean).flatMap(line => {
    try {
      const e = JSON.parse(line);
      return [{ ...e, source: e.source || 'workbench', status: e.status || 'logged', id: e.id || null }];
    } catch (_) { return []; }
  });
}

const pendingTasks = () => readEvents().filter(e => e.status === 'pending' && e.task);

/* ---------- 工作台 → Agent 的手动任务卡（只生成，不自动执行） ---------- */

function buildTaskPrompt(cfg, p, it) {
  const a = agentOf(cfg, p);
  return [
    `请按《改造清单协作约定》推进以下改造项。`,
    ``,
    `- 项目：${p.id}`,
    `- 代码根：${p.projectRoot}`,
    `- 记忆根：${p.memoryRoot}`,
    `- 记忆目录：${memoryDirOf(cfg, p)}`,
    `- 改造项：#${it.id} ${it.priority} · ${STATUS_LABEL[it.status] || it.status} · 「${it.title}」`,
    it.note ? `- 说明：${it.note}` : '',
    ``,
    `执行要求：`,
    `1. 先读 记忆目录/改造清单协作约定.md 与 记忆目录/${a.backlogFile}。`,
    `2. 唯一权威源是 ${a.backlogFile} 的 ${MARK_BEGIN} / ${MARK_END} 标记区块；MEMORY.md 末尾状态镜像由工作台维护，不要手写。`,
    `3. 完成后只把该行 status 改为 done、updated 改为今天（本地日期 YYYY-MM-DD），不要删行、不要重排 ID。`,
    `4. 不要自动 commit / push；但代码经指示完成 commit 或 push 的同一轮，必须同步更新该行（commit 后按进度置 done / doing 并在 note 记 hash，push 后复核置 done），不留滞后。`,
    `5. 执行过程可在当天日志 append 一行留痕。`,
    `6. 工作台会自动感知清单变化并刷新看板。`
  ].filter(Boolean).join('\n');
}

function flagOn(cfg, p, key) {
  return cfg[key] !== false && p[key] !== false;
}

function taskFor(cfg, p, action, it, before) {
  if (!flagOn(cfg, p, 'autoTask')) return null;
  const hit = action === 'add' ||
    (action === 'edit' && it.status === 'doing' && (!before || before.status !== 'doing'));
  if (!hit) return null;
  return {
    itemId: String(it.id), title: it.title, priority: it.priority, status: it.status,
    projectRoot: p.projectRoot, memoryRoot: p.memoryRoot,
    memoryDir: memoryDirOf(cfg, p), backlogFile: agentOf(cfg, p).backlogFile,
    prompt: buildTaskPrompt(cfg, p, it)
  };
}

/* ---------- 写回与记忆同步 ---------- */

const selfWrites = new Map();
function markSelfWrite(file) {
  try { selfWrites.set(path.resolve(file), hashText(fs.readFileSync(file))); } catch (_) { /* 文件不存在则跳过 */ }
}
function isSelfWrite(file) {
  const expected = selfWrites.get(path.resolve(file));
  if (!expected) return false;
  try { return hashText(fs.readFileSync(file)) === expected; } catch (_) { return false; }
}

let backupSeq = 0;
function backupFile(file, p, tag) {
  const bakDir = backupDirOf(p.id);
  fs.mkdirSync(bakDir, { recursive: true });
  // 同毫秒连续写盘会撞名，加序号保证每次写前备份都独立留存
  const name = `${Date.now()}-${String(++backupSeq).padStart(3, '0')}_${tag}_${path.basename(file)}`;
  fs.copyFileSync(file, path.join(bakDir, name));
  const baks = fs.readdirSync(bakDir).filter(n => n.endsWith('.md')).sort();
  while (baks.length > 30) fs.unlinkSync(path.join(bakDir, baks.shift()));
}

function backlogMtime(cfg, p) {
  const f = backlogFileOf(cfg, p);
  return fs.existsSync(f) ? fs.statSync(f).mtimeMs : null;
}

function atomicWrite(file, text) {
  const tmp = file + '.tmp';
  const eol = fs.existsSync(file) ? eolOf(fs.readFileSync(file, 'utf8')) : '\n';
  fs.writeFileSync(tmp, eol === '\r\n' ? text.replace(/\r?\n/g, '\r\n') : text, 'utf8');
  try {
    fs.renameSync(tmp, file);
  } catch (e) {
    if (fs.existsSync(tmp)) {
      fs.writeFileSync(file, fs.readFileSync(tmp));
      fs.unlinkSync(tmp);
    } else {
      throw e;
    }
  }
  markSelfWrite(file);
}

function syncEnabled(cfg, p) {
  return cfg.syncToMemory !== false && p.syncToMemory !== false;
}

function syncTargets(cfg, p) {
  const a = agentOf(cfg, p);
  const dir = memoryDirOf(cfg, p);
  const ctxName = a.syncFile || (a.contextFiles || [])[0] || null;
  const dailyName = String(a.dailyFile || '{date}.md').replace('{date}', today());
  return {
    context: ctxName ? assertInside(dir, path.join(dir, ctxName)) : null,
    daily: assertInside(dir, path.join(dir, dailyName)),
    ctxName,
    backlogName: a.backlogFile
  };
}

function ensureBacklogHeader(cfg, p) {
  const file = assertInside(memoryDirOf(cfg, p), backlogFileOf(cfg, p));
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  if (text.includes(HEADER_DECL)) return;
  const at = text.indexOf('> 最近同步：');
  let next;
  if (at !== -1) {
    const lineEnd = text.indexOf('\n', at);
    next = text.slice(0, lineEnd + 1) + HEADER_DECL + '\n' + text.slice(lineEnd + 1);
  } else {
    next = HEADER_DECL + '\n' + text;
  }
  backupFile(file, p, 'header');
  atomicWrite(file, next);
}

function renderMirror(cfg, p, items) {
  const count = s => items.filter(i => i.status === s).length;
  const lines = [
    SYNC_BEGIN,
    '## 改造清单 · 当前状态镜像（工作台自动维护）',
    '',
    `> 最后同步：${nowText()} ｜ 唯一权威源：同目录 \`${agentOf(cfg, p).backlogFile}\` 的 \`${MARK_BEGIN}\` / \`${MARK_END}\` 区块。`,
    '> 本文件上方所有历史清单条目（含降级、移除等决策）仅为当时的留痕；其中优先级与待办状态一律以本区块及权威源为准，不得据此重新列为待办。',
    `> 汇总：共 ${items.length} 项 ｜ 待办 ${count('todo')} ｜ 进行中 ${count('doing')} ｜ 已完成 ${count('done')} ｜ 已移除 ${count('removed')}。`,
    `> 清单指纹：\`${fingerprint(items)}\`（工作台自动维护，用于检测外部改动后镜像是否滞后）。`,
    '',
    '| # | 优先级 | 状态 | 改造项 |',
    '| --- | --- | --- | --- |'
  ];
  for (const it of items) {
    lines.push(`| ${it.id} | ${it.priority} | ${STATUS_LABEL[it.status] || it.status} | ${escCell(it.title)} |`);
  }
  lines.push('', SYNC_END, '');
  return lines.join('\n');
}

function writeMirror(cfg, p, items, file) {
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : `# 项目长期笔记（${p.name}）\n`;
  const block = renderMirror(cfg, p, items);
  const s = text.indexOf(SYNC_BEGIN);
  const e = text.indexOf(SYNC_END);
  const next = (s !== -1 && e !== -1 && e > s)
    ? text.slice(0, s) + block.trimEnd() + text.slice(e + SYNC_END.length)
    : text.replace(/\s*$/, '') + '\n\n' + block;
  backupFile(file, p, 'context');
  atomicWrite(file, next);
}

function driftOf(cfg, p, items) {
  try {
    const t = syncTargets(cfg, p);
    if (!t.context || !fs.existsSync(t.context)) return 'missing';
    const m = fs.readFileSync(t.context, 'utf8').match(/^> 清单指纹：`([0-9a-f]{16})`/m);
    if (!m) return 'unknown';
    return m[1] === fingerprint(items) ? false : true;
  } catch (_) { return 'unknown'; }
}

function describeChange(change) {
  const { action, item, before } = change;
  const label = it => `#${it.id}「${it.title}」`;
  if (action === 'add') return `新增 ${label(item)}（${item.priority} · ${STATUS_LABEL[item.status]}）`;
  if (action === 'resync') return `按 \`${change.backlogName}\` 校准状态镜像（共 ${change.total} 项）`;
  if (action === 'external') return `检测到 Agent 或手工直接改动 \`${change.backlogName}\`（共 ${change.total} 项），工作台已按唯一权威源自动校准状态镜像`;
  if (action === 'hard-delete') return `${label(item)} **彻底删除**`;
  if (action === 'soft-delete') return `${label(item)} 标记为**已移除**（${item.priority}）`;
  const parts = [];
  for (const k of ['priority', 'status', 'title', 'note']) {
    if (!before || before[k] === item[k]) continue;
    if (k === 'priority') parts.push(`优先级 ${before[k]} → ${item[k]}`);
    else if (k === 'status') parts.push(`状态 ${STATUS_LABEL[before[k]] || before[k]} → ${STATUS_LABEL[item[k]] || item[k]}`);
    else parts.push(k === 'title' ? '标题更新' : '说明更新');
  }
  return `${label(item)} ${parts.length ? parts.join('、') : '内容更新'}`;
}

function appendDailyLog(file, line) {
  let prefix = '';
  let eol = '\n';
  if (!fs.existsSync(file)) prefix = `# ${today()}\n\n`;
  else {
    const text = fs.readFileSync(file, 'utf8');
    eol = eolOf(text);
    if (text.length && !text.endsWith('\n')) prefix = '\n';
  }
  fs.appendFileSync(file, (prefix + line + '\n').replace(/\n/g, eol), 'utf8');
  markSelfWrite(file);
}

function syncMemory(cfg, p, items, change) {
  const out = { enabled: false, context: false, daily: false, files: [], warning: null };
  if (!syncEnabled(cfg, p)) return out;
  out.enabled = true;
  try {
    const t = syncTargets(cfg, p);
    ensureBacklogHeader(cfg, p);
    const note = t.context
      ? `当前状态以 \`${t.backlogName}\` 与 \`${t.ctxName}\` 末尾的「改造清单 · 当前状态镜像」为准；本文件上方历史条目中的优先级与待办描述不再作为依据。`
      : `当前状态以 \`${t.backlogName}\` 为准；本文件上方历史条目中的优先级与待办描述不再作为依据。`;
    const line = `- [工作台 ${nowText()}] 改造清单变更：${describeChange(change)}。${note}`;
    if (t.context) {
      writeMirror(cfg, p, items, t.context);
      out.context = true;
      out.files.push(t.context);
    }
    appendDailyLog(t.daily, line);
    out.daily = true;
    out.files.push(t.daily);
  } catch (e) {
    out.warning = e.message;
  }
  return out;
}

function writeBacklog(cfg, p, items, expectedMtime) {
  const file = assertInside(memoryDirOf(cfg, p), backlogFileOf(cfg, p));
  const exists = fs.existsSync(file);
  let text;

  if (exists) {
    const stat = fs.statSync(file);
    if (expectedMtime != null && Math.abs(stat.mtimeMs - Number(expectedMtime)) > 2) {
      const err = new Error('清单文件已被外部修改，请先点「刷新」重新读取再编辑');
      err.code = 'CONFLICT';
      throw err;
    }
    text = fs.readFileSync(file, 'utf8');
    backupFile(file, p, 'backlog');
  } else {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    text = `# 改造清单 · ${p.name}\n\n> 由「改造清单台 · Backlog Desk」维护；标记区块内请勿手工改格式。\n> 最近同步：${today()}\n\n${MARK_BEGIN}\n${MARK_END}\n`;
  }

  const parsed = parseBacklog(text);
  const before = parsed.found ? parsed.before : text.trimEnd() + '\n\n' + MARK_BEGIN;
  const after = parsed.found ? parsed.after : MARK_END + '\n';
  const next = before + renderBlock(items) + after;

  atomicWrite(file, next);
  return fs.statSync(file).mtimeMs;
}

/* ---------- 文件监听：区分「工作台自写」与「Agent 外部写」 ---------- */

const watchers = new Map();
const debounceTimers = new Map();
const lastExternalFp = new Map();
const sseClients = new Set();
const watchWarnings = [];

function baselineForDir(cfg, dir) {
  for (const p of cfg.projects) {
    let d;
    try { d = path.resolve(memoryDirOf(cfg, p)); } catch (_) { continue; }
    if (d !== path.resolve(dir)) continue;
    const file = backlogFileOf(cfg, p);
    if (fs.existsSync(file)) markSelfWrite(file);
    try {
      const t = syncTargets(cfg, p);
      if (t.context && fs.existsSync(t.context)) markSelfWrite(t.context);
      if (t.daily && fs.existsSync(t.daily)) markSelfWrite(t.daily);
    } catch (_) { /* 配置异常由校验层处理 */ }
    lastExternalFp.set(p.id, fingerprint(loadItems(cfg, p)));
  }
}

function setupWatchers(cfg) {
  const dirs = new Set();
  for (const p of cfg.projects) {
    try {
      const d = memoryDirOf(cfg, p);
      if (fs.existsSync(d)) dirs.add(path.resolve(d));
    } catch (_) { /* 跳过配置异常的项目 */ }
  }
  for (const [dir, w] of watchers) {
    if (!dirs.has(dir)) {
      try { w.close(); } catch (_) { /* 已关闭 */ }
      watchers.delete(dir);
    }
  }
  if (cfg.autoWatch === false) {
    for (const [dir, w] of watchers) {
      try { w.close(); } catch (_) { /* 已关闭 */ }
      watchers.delete(dir);
    }
    return;
  }
  for (const dir of dirs) {
    if (watchers.has(dir)) continue;
    baselineForDir(cfg, dir);
    try {
      const w = fs.watch(dir, { persistent: false }, () => scheduleCheck(dir));
      w.on('error', e => watchWarnings.push(`${dir}: ${e.message}`));
      watchers.set(dir, w);
    } catch (e) {
      watchWarnings.push(`${dir}: ${e.message}`);
    }
  }
}

function broadcast(payload) {
  const chunk = `data: ${JSON.stringify(payload)}\n\n`;
  for (const c of sseClients) {
    try { c.write(chunk); } catch (_) { sseClients.delete(c); }
  }
}

function scheduleCheck(dir) {
  clearTimeout(debounceTimers.get(dir));
  debounceTimers.set(dir, setTimeout(() => {
    try { checkDir(dir); } catch (e) { watchWarnings.push(`检查失败 ${dir}: ${e.message}`); }
  }, 500));
}

function handleExternalChange(cfg, p, items, fp) {
  const shouldCalibrate = flagOn(cfg, p, 'autoCalibrate') && syncEnabled(cfg, p);
  let sync = null;
  if (shouldCalibrate) {
    sync = syncMemory(cfg, p, items, {
      action: 'external', total: items.length, backlogName: agentOf(cfg, p).backlogFile
    });
    markSelfWrite(backlogFileOf(cfg, p));
    try {
      const t = syncTargets(cfg, p);
      if (t.context) markSelfWrite(t.context);
      if (t.daily) markSelfWrite(t.daily);
    } catch (_) { /* 已由 sync 返回 warning */ }
  }
  appendEvent(p.id, 'external-change', {
    count: items.length, fingerprint: fp, files: sync ? sync.files.length : 0
  }, { source: 'agent' });
  broadcast({
    type: 'change', project: p.id, source: 'agent', items: items.length,
    calibrated: !!(shouldCalibrate && sync && sync.context && sync.daily),
    warning: sync && sync.warning || null,
    drift: driftOf(cfg, p, items)
  });
}

function checkDir(dir) {
  const cfg = loadConfig();
  if (cfg.autoWatch === false) return;
  for (const p of cfg.projects) {
    if (p.autoWatch === false) continue;
    let d;
    try { d = path.resolve(memoryDirOf(cfg, p)); } catch (_) { continue; }
    if (d !== path.resolve(dir)) continue;
    const file = backlogFileOf(cfg, p);
    if (!fs.existsSync(file) || isSelfWrite(file)) continue;
    const parsed = parseBacklog(fs.readFileSync(file, 'utf8'));
    if (!parsed.found) {
      markSelfWrite(file);
      broadcast({ type: 'warning', project: p.id, message: '清单标记区块解析失败，已跳过自动校准' });
      continue;
    }
    markSelfWrite(file);
    const fp = fingerprint(parsed.items);
    if (lastExternalFp.get(p.id) === fp) continue;
    lastExternalFp.set(p.id, fp);
    handleExternalChange(cfg, p, parsed.items, fp);
  }
}

/* ---------- 状态与视图 ---------- */

function projectState(cfg, p) {
  const memDir = memoryDirOf(cfg, p);
  const file = path.join(memDir, agentOf(cfg, p).backlogFile);
  const state = {
    id: p.id,
    name: p.name,
    projectRoot: p.projectRoot,
    memoryRoot: p.memoryRoot,
    agent: p.agent,
    agentLabel: agentOf(cfg, p).label || p.agent,
    backlogPath: file,
    health: {
      projectRoot: fs.existsSync(expandHome(p.projectRoot)),
      memoryRoot: fs.existsSync(expandHome(p.memoryRoot)),
      memoryDir: fs.existsSync(memDir),
      backlogFile: fs.existsSync(file)
    },
    mtime: null,
    items: [],
    sync: { enabled: syncEnabled(cfg, p), context: null, daily: null, lastSync: null, error: null },
    track: { watch: flagOn(cfg, p, 'autoWatch'), calibrate: flagOn(cfg, p, 'autoCalibrate'), drift: 'unknown', fingerprint: null }
  };
  try {
    const t = syncTargets(cfg, p);
    state.sync.context = t.context;
    state.sync.daily = t.daily;
    if (t.context && fs.existsSync(t.context)) {
      const m = fs.readFileSync(t.context, 'utf8').match(/^> 最后同步：(.+?) ｜/m);
      if (m) state.sync.lastSync = m[1];
    }
  } catch (e) {
    state.sync.error = e.message;
  }
  if (fs.existsSync(file)) {
    state.mtime = fs.statSync(file).mtimeMs;
    state.items = parseBacklog(fs.readFileSync(file, 'utf8')).items;
  }
  state.track.fingerprint = fingerprint(state.items);
  state.track.drift = driftOf(cfg, p, state.items);
  return state;
}

function memoryView(cfg, p) {
  const a = agentOf(cfg, p);
  const dir = memoryDirOf(cfg, p);
  const view = { project: p.id, memoryDir: dir, contextFiles: [], dailyLogs: [] };
  if (!fs.existsSync(dir)) return view;

  for (const name of (a.contextFiles || [])) {
    const fp = assertInside(dir, path.join(dir, name));
    if (fs.existsSync(fp)) {
      view.contextFiles.push({ name, content: fs.readFileSync(fp, 'utf8') });
    }
  }

  let pattern;
  try {
    pattern = new RegExp(a.dailyPattern || '^\\d{4}-\\d{2}-\\d{2}\\.md$');
  } catch (e) {
    pattern = /^\d{4}-\d{2}-\d{2}\.md$/;
  }
  const logs = fs.readdirSync(dir).filter(n => pattern.test(n)).sort().reverse().slice(0, 5);
  for (const name of logs) {
    const text = fs.readFileSync(path.join(dir, name), 'utf8');
    const lines = text.split(/\r?\n/).filter(Boolean);
    view.dailyLogs.push({
      name,
      headings: lines.filter(l => /^##\s+/.test(l)).map(l => l.replace(/^##\s+/, '')),
      lines: lines.length,
      excerpt: text.slice(0, 500),
      tail: lines.slice(-5).join('\n')
    });
  }
  return view;
}

function serveStatic(pathname, res) {
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const file = path.resolve(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return json(res, 403, { ok: false, error: '禁止访问' });
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    return json(res, 404, { ok: false, error: '文件不存在' });
  }
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': 'no-store'
  });
  res.end(fs.readFileSync(file));
}

/* ---------- HTTP ---------- */

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  const seg = u.pathname.split('/').filter(Boolean);
  try {
    if (seg[0] !== 'api') return serveStatic(u.pathname, res);

    if (seg[1] === 'events' && req.method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive'
      });
      req.socket.setTimeout(0);
      res.write(': connected\n\n');
      sseClients.add(res);
      const hb = setInterval(() => { try { res.write(': ping\n\n'); } catch (_) { /* 连接已断 */ } }, 25000);
      res.on('close', () => { clearInterval(hb); sseClients.delete(res); });
      return;
    }

    const cfg = loadConfig();

    if (seg[1] === 'state' && req.method === 'GET') {
      return json(res, 200, {
        ok: true,
        config: cfg,
        projects: cfg.projects.map(p => projectState(cfg, p)),
        tasks: pendingTasks(),
        track: {
          autoWatch: cfg.autoWatch !== false,
          watchDirs: [...watchers.keys()],
          warnings: watchWarnings.slice(-5)
        },
        serverTime: new Date().toISOString()
      });
    }

    if (seg[1] === 'config' && req.method === 'PUT') {
      const body = await readBody(req);
      const next = validateConfig(body.config || body);
      saveConfig(next);
      setupWatchers(next);
      return json(res, 200, {
        ok: true,
        config: next,
        projects: next.projects.map(p => projectState(next, p))
      });
    }

    if (seg[1] === 'tasks' && seg[2] && req.method === 'POST') {
      const body = await readBody(req);
      const events = readEvents();
      const idx = events.findIndex(e => e.id === seg[2]);
      if (idx < 0) throw new Error('任务卡不存在');
      events[idx].status = body.status === 'done' ? 'done' : 'dispatched';
      events[idx].closedAt = nowText();
      fs.writeFileSync(historyFile(), events.map(e => JSON.stringify(e)).join('\n') + '\n', 'utf8');
      return json(res, 200, { ok: true, tasks: pendingTasks() });
    }

    if (seg[1] === 'memory' && seg[2] && req.method === 'GET') {
      return json(res, 200, { ok: true, ...memoryView(cfg, projectOf(cfg, seg[2])) });
    }

    if (seg[1] === 'sync' && seg[2] && req.method === 'POST') {
      const p = projectOf(cfg, seg[2]);
      const st = projectState(cfg, p);
      const sync = syncMemory(cfg, p, st.items, {
        action: 'resync', total: st.items.length, backlogName: agentOf(cfg, p).backlogFile
      });
      markSelfWrite(backlogFileOf(cfg, p));
      try {
        const t = syncTargets(cfg, p);
        if (t.context) markSelfWrite(t.context);
        if (t.daily) markSelfWrite(t.daily);
      } catch (_) { /* 已由 sync.warning 体现 */ }
      lastExternalFp.set(p.id, fingerprint(st.items));
      appendEvent(p.id, 'resync', { count: st.items.length, files: sync.files.length });
      const file = backlogFileOf(cfg, p);
      return json(res, 200, {
        ok: true,
        items: st.items,
        mtime: fs.existsSync(file) ? fs.statSync(file).mtimeMs : null,
        sync
      });
    }

    if (seg[1] === 'items' && seg[2]) {
      const p = projectOf(cfg, seg[2]);
      const body = await readBody(req);
      const items = loadItems(cfg, p);

      if (req.method === 'POST') {
        const title = String(body.title || '').trim();
        if (!title) throw new Error('改造项标题不能为空');
        const id = String(Math.max(0, ...items.map(i => Number(i.id) || 0)) + 1);
        const created = {
          id,
          priority: PRIORITIES.includes(body.priority) ? body.priority : 'P2',
          status: STATUSES.includes(body.status) ? body.status : 'todo',
          title,
          note: String(body.note || ''),
          updated: today()
        };
        items.push(created);
        writeBacklog(cfg, p, items, body.expectedMtime);
        const sync = syncMemory(cfg, p, items, { action: 'add', item: created });
        markSelfWrite(backlogFileOf(cfg, p));
        const task = taskFor(cfg, p, 'add', created);
        appendEvent(p.id, 'add', { id, title, sync: sync.files.length },
          { item: { ...created }, task, status: task ? 'pending' : 'logged' });
        lastExternalFp.set(p.id, fingerprint(items));
        return json(res, 200, { ok: true, mtime: backlogMtime(cfg, p), items, sync, task: !!task });
      }

      if (req.method === 'PATCH' && seg[3]) {
        const it = items.find(i => i.id === seg[3]);
        if (!it) throw new Error(`改造项不存在：#${seg[3]}`);
        const before = { ...it };
        for (const k of ['priority', 'status', 'title', 'note']) {
          if (body[k] !== undefined) it[k] = String(body[k]);
        }
        if (!PRIORITIES.includes(it.priority)) throw new Error('优先级不合法');
        if (!STATUSES.includes(it.status)) throw new Error('状态不合法');
        if (!String(it.title).trim()) throw new Error('改造项标题不能为空');
        it.updated = today();
        writeBacklog(cfg, p, items, body.expectedMtime);
        const sync = syncMemory(cfg, p, items, { action: 'edit', item: it, before });
        markSelfWrite(backlogFileOf(cfg, p));
        const task = taskFor(cfg, p, 'edit', it, before);
        appendEvent(p.id, 'edit', { id: it.id, changed: Object.keys(body).filter(k => k !== 'expectedMtime'), sync: sync.files.length },
          { item: { ...it }, task, status: task ? 'pending' : 'logged' });
        lastExternalFp.set(p.id, fingerprint(items));
        return json(res, 200, { ok: true, mtime: backlogMtime(cfg, p), items, sync, task: !!task });
      }

      if (req.method === 'DELETE' && seg[3]) {
        const idx = items.findIndex(i => i.id === seg[3]);
        if (idx < 0) throw new Error(`改造项不存在：#${seg[3]}`);
        const it = items[idx];
        if (body.hard) items.splice(idx, 1);
        else { it.status = 'removed'; it.updated = today(); }
        writeBacklog(cfg, p, items, body.expectedMtime);
        const sync = syncMemory(cfg, p, items, { action: body.hard ? 'hard-delete' : 'soft-delete', item: it });
        markSelfWrite(backlogFileOf(cfg, p));
        appendEvent(p.id, body.hard ? 'hard-delete' : 'soft-delete',
          { id: it.id, sync: sync.files.length }, { item: { ...it } });
        lastExternalFp.set(p.id, fingerprint(items));
        return json(res, 200, { ok: true, mtime: backlogMtime(cfg, p), items, sync });
      }
    }

    return json(res, 404, { ok: false, error: '接口不存在' });
  } catch (err) {
    return json(res, err.code === 'CONFLICT' ? 409 : 400, { ok: false, error: err.message });
  }
});

server.requestTimeout = 0;

function start(opts = {}) {
  resolvePaths(opts);
  const cfg = loadConfig();
  setupWatchers(cfg);
  const port = Number(opts.port || process.env.PORT || cfg.port) || 8787;
  // 只有端口来自 PORT 环境变量（容器部署）才默认对外绑定；显式 --port / demo 一律只监听回环
  const envPort = !opts.port && !!process.env.PORT;
  const host = opts.host || (envPort ? '0.0.0.0' : '127.0.0.1');
  server.on('error', e => {
    console.error(`服务启动失败（${host}:${port}）：${e.message}`);
    process.exitCode = 1;
  });
  server.listen(port, host, () => {
    const show = host === '0.0.0.0' ? '127.0.0.1' : host;
    console.log(`改造清单台（Backlog Desk）已启动：http://${show}:${port}`);
    console.log(`数据目录：${ctx.dataDir}`);
    console.log(`自动跟踪 ${watchers.size} 个记忆目录`);
  });
  return server;
}

if (require.main === module) start();

module.exports = { start, loadConfig, saveConfig, validateConfig, resolvePaths, expandHome, _ctx: ctx };
