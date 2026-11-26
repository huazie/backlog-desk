'use strict';

// 静态演示模式：?demo=1（或构建注入 window.__DEMO__ = true）时启用。
// 所有 API 走内存 mock（源：demo/ 脱敏示例文件——dev 页运行时 fetch + 前端解析，改示例文件即改演示数据；
// 构建产物由 build:demo 在构建期把 demo/ 内嵌为 __DEMO_DATA__，file:// 双击直开与静态托管零 fetch），
// 写操作落 localStorage（key pbw-demo-v1，刷新保留），「重置数据」一键恢复初始示例。
// 非演示态本文件不做任何事，真实服务端行为零改动。
// ⚠ mock 的清单/任务卡/校验语义与 server.js 是平行实现（非共享模块，避免 CJS/浏览器双环境耦合）；
//   服务端语义调整（如任务卡生成/关闭规则、config 校验）时需人工同步本文件。

(function () {
  const DEMO = /[?&]demo=1/.test(location.search) || window.__DEMO__ === true;
  if (!DEMO) return;

  const STORE_KEY = 'pbw-demo-v1';
  const TODAY = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const NOW = () => {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${TODAY()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  };
  const clone = v => JSON.parse(JSON.stringify(v));

  /* ---------- demo/ 源文件加载与解析（无预生成 JS） ---------- */

  const MARK_BEGIN = '<!-- backlog:begin -->';
  const MARK_END = '<!-- backlog:end -->';
  const DEMO_TOKEN = '{{DEMO}}';

  // 展示路径：~（模拟用户主目录，demo/ 目录本身）保留原样；{{DEMO}} → demo/projects 前缀
  function toRel(s) {
    if (s.startsWith('~')) return s;
    return 'demo/projects' + s.slice(DEMO_TOKEN.length);
  }
  // 展示路径 → 静态 fetch URL：~ → demo/，其余为相对路径直取
  function toUrl(relPath) {
    return relPath.startsWith('~') ? 'demo' + relPath.slice(1) : relPath;
  }

  async function fetchText(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    return r.text();
  }

  // 数据源二态：构建产物内嵌 __DEMO_DATA__.files（file:// 双击直开与静态托管均免 fetch）
  // > 运行时 fetch demo/ 源文件（dev 服务器 ?demo=1，改源文件即改演示数据）。
  // readText 参数相对 demo/ 根（config.json / projects/.../改造清单.md / .trae-cn/...）
  const EMBED_FILES = window.__DEMO_DATA__ && window.__DEMO_DATA__.files;

  function readText(rel) {
    if (EMBED_FILES) {
      const c = EMBED_FILES[rel];
      if (c === undefined) throw new Error(`demo/${rel}: 内嵌数据缺失`);
      return Promise.resolve(c);
    }
    return fetchText('demo/' + rel);
  }

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

  // 演示数据版本指纹：djb2 hash 适配器配置与所有项目条目（id/状态/标题/note/记忆目录），
  // 任一变化则版本变——本机 localStorage 缓存的旧演示改动自动重置
  function hashItems(projects, agents) {
    const raw = Object.entries(agents || {}).map(([k, a]) => 'agent:' + k + ':' + JSON.stringify(a))
      .concat(Object.entries(projects)
        .map(([pid, p]) => pid + ':' + (p.memory?.memoryDir || '') + ':' + p.items.map(i => `${i.id}|${i.status}|${i.title}|${i.note}`).join(';')))
      .sort().join('\n');
    let h = 5381;
    for (let i = 0; i < raw.length; i++) h = ((h << 5) + h + raw.charCodeAt(i)) >>> 0;
    return h.toString(36);
  }

  function dailyLogOf(name, text) {
    const lines = text.split(/\r?\n/).filter(Boolean);
    return {
      name,
      headings: lines.filter(l => /^##\s+/.test(l)).map(l => l.replace(/^##\s+/, '')),
      lines: lines.length,
      tail: lines.slice(-5).join('\n')
    };
  }

  async function loadDemoData() {
    const raw = JSON.parse(await readText('config.json'));
    const agents = {};
    for (const [k, a] of Object.entries(raw.agents || {})) {
      agents[k] = { ...a, dispatchCommand: '' }; // 示例适配器不带派发命令：演示态不支持派发
    }
    const projects = {};
    const projectCfgs = [];
    for (const p of raw.projects || []) {
      // 记忆目录随项目配置 memoryRoot（{{DEMO}} 或 ~/ 占位符）+ 适配器 memoryDir 推导；
      // 空串 = memoryRoot 本身；memoryRoot 可在项目外（trae 示例的模拟用户级记忆目录）
      const projRel = toRel(p.projectRoot || `${DEMO_TOKEN}/${p.id}`);
      const memRootRel = toRel(p.memoryRoot || p.projectRoot || `${DEMO_TOKEN}/${p.id}`);
      const memDirCfg = raw.agents[p.agent]?.memoryDir || '';
      const memDir = memRootRel + (memDirCfg ? '/' + memDirCfg : '');
      const urlBase = toUrl(memDir);
      const relBase = urlBase.replace(/^demo\//, ''); // demo/ 根相对路径：内嵌数据与 fetch 共用同一 key 空间
      const backlogName = raw.agents[p.agent]?.backlogFile || '改造清单.md';
      const items = parseItems(await readText(`${relBase}/${backlogName}`));

      const contextFiles = [];
      for (const name of (raw.agents[p.agent]?.contextFiles || [])) {
        try { contextFiles.push({ name, content: await readText(`${relBase}/${name}`) }); }
        catch (_) { /* 缺失文件跳过（与服务端 existsSync 行为一致） */ }
      }
      const dailyLogs = [];
      for (const name of (p.dailyFiles || [])) {
        try { dailyLogs.push(dailyLogOf(name, await readText(`${relBase}/${name}`))); }
        catch (_) { /* 同上 */ }
      }

      projects[p.id] = {
        mtime: 1762600000000 + (projectCfgs.length + 1) * 1000,
        items,
        lastSync: lastSyncOf(contextFiles[0]?.content || ''),
        fingerprint: '0'.repeat(16),
        memory: { memoryDir: memDir, contextFiles, dailyLogs }
      };
      projectCfgs.push({
        id: p.id, name: p.name,
        projectRoot: projRel, memoryRoot: memRootRel, agent: p.agent
      });
    }
    return {
      generatedAt: new Date().toISOString(),
      dataVersion: hashItems(projects, agents),
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
  }

  /* ---------- 会话存储与 mock ---------- */

  // mock 未就绪时排队挂起（app.js 挂载即 loadState，与演示数据异步加载存在竞态），
  // 就绪后按序重放；加载失败则放行错误，避免页面静默空白
  let apiImpl = null;
  const pendingCalls = [];
  window.__mockApi = (url, method, body) => {
    if (apiImpl) return apiImpl(url, method, body);
    return new Promise((resolve, reject) => pendingCalls.push({ url, method, body, resolve, reject }));
  };

  let store;
  function persist() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (_) { /* 存储满/隐私模式：仅内存演示 */ }
  }

  (async () => {
    let data;
    try {
      data = await loadDemoData();
    } catch (e) {
      console.error('[demo] 演示数据加载失败：', e);
      for (const c of pendingCalls.splice(0)) c.reject(e);
      const hint = location.protocol === 'file:'
        ? '（file:// 直开仅支持构建产物：先 npm run build:demo，再双击打开 build-demo/index.html）'
        : '（请经 HTTP 服务或静态托管访问）';
      document.documentElement.insertAdjacentHTML('beforeend',
        '<div class="demo-load-error">演示数据加载失败：' + String(e.message || e) + hint + '</div>');
      return;
    }
    // 会话存储：优先恢复本机改动，否则从源文件数据深拷贝；
    // 但源文件内容已更新（dataVersion 变化）时本机缓存作废——示例数据为准，自动重置
    try { store = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch (_) { store = null; }
    const stale = store && store.config && store.dataVersion !== data.dataVersion;
    if (!store || !store.config || stale) {
      if (stale) console.info('[demo] 演示示例数据已更新，本机演示改动已重置为最新示例');
      store = clone(data);
      store.tasks = [];
      persist();
    }
    apiImpl = mockApi;
    for (const c of pendingCalls.splice(0)) apiImpl(c.url, c.method, c.body).then(c.resolve, c.reject);
  })();

  const PRIORITIES = ['P0', 'P1', 'P2', 'P3'];
  const STATUSES = ['todo', 'doing', 'done', 'removed'];
  let eventSeq = 0;

  const projectCfg = id => store.config.projects.find(p => p.id === id);
  const pd = id => store.projects[id]; // { mtime, items, lastSync, fingerprint, memory }
  const backlogPath = id => `${pd(id).memory.memoryDir}/改造清单.md`;

  function buildTaskPrompt(cfg, p, it) {
    return [
      '请按《改造清单协作约定》推进以下改造项。',
      '',
      `- 项目：${p.id}`,
      `- 代码根：${p.projectRoot}`,
      `- 记忆根：${p.memoryRoot}`,
      `- 记忆目录：${pd(p.id).memory.memoryDir}`,
      `- 改造项：#${it.id} ${it.priority} · ${it.status === 'doing' ? '进行中' : it.status === 'todo' ? '待办' : it.status} · 「${it.title}」`,
      it.note ? `- 说明：${it.note}` : '',
      '',
      '执行要求：',
      '1. 先读 记忆目录/改造清单协作约定.md 与 记忆目录/改造清单.md。',
      '2. 唯一权威源是 改造清单.md 的标记区块；MEMORY.md 末尾状态镜像由工作台维护，不要手写。',
      '3. 完成后只把该行 status 改为 done、updated 改为今天（本地日期 YYYY-MM-DD），不要删行、不要重排 ID。',
      '4. 不要自动 commit / push。',
      '5. 执行过程可在当天日志 append 一行留痕。',
      '6. 工作台会自动感知清单变化并刷新看板。'
    ].join('\n');
  }

  function appendCard(projectId, action, item) {
    if (store.config.autoTask === false) return null;
    const p = projectCfg(projectId);
    const card = {
      id: `evt-demo-${Date.now().toString(36)}-${(++eventSeq).toString(36)}`,
      time: new Date().toISOString(),
      localTime: NOW(),
      project: projectId,
      source: 'workbench',
      action,
      status: 'pending',
      item: clone(item),
      task: {
        itemId: String(item.id), title: item.title, priority: item.priority, status: item.status,
        projectRoot: p.projectRoot, memoryRoot: p.memoryRoot,
        memoryDir: pd(projectId).memory.memoryDir, backlogFile: '改造清单.md',
        prompt: buildTaskPrompt(store.config, p, item)
      },
      detail: {}
    };
    store.tasks.push(card);
    return card;
  }

  // 条目进入终态或退回 todo 时，关闭其 pending 任务卡（与服务端语义一致）
  function closeCards(projectId, itemId) {
    store.tasks = store.tasks.filter(t =>
      !(t.project === projectId && t.status === 'pending' && t.task && t.task.itemId === String(itemId)));
  }

  function projectState(id) {
    const p = projectCfg(id);
    const d = pd(id);
    const syncFile = (store.config.agents[p.agent]?.contextFiles || [])[0];
    return {
      id: p.id, name: p.name,
      projectRoot: p.projectRoot, memoryRoot: p.memoryRoot,
      agent: p.agent, agentLabel: store.config.agents[p.agent]?.label || p.agent,
      backlogPath: backlogPath(id),
      health: { projectRoot: true, memoryRoot: true, memoryDir: true, backlogFile: true },
      mtime: d.mtime,
      items: clone(d.items),
      sync: {
        enabled: store.config.syncToMemory !== false,
        context: syncFile ? `${d.memory.memoryDir}/${syncFile}` : null,
        daily: `${d.memory.memoryDir}/${TODAY()}.md`,
        lastSync: d.lastSync, error: null
      },
      track: { watch: true, calibrate: store.config.autoCalibrate !== false, drift: false, fingerprint: d.fingerprint },
      dispatch: { supported: false, auto: false } // 演示态固定不支持派发（示例适配器无 dispatchCommand）
    };
  }

  function touch(id) { pd(id).mtime = Date.now(); }
  const conflict = expected => {
    if (expected != null && Math.abs(pd(expected.projectId).mtime - Number(expected.value)) > 2) {
      throw new Error('清单文件已被外部修改，请先点「刷新」重新读取再编辑');
    }
  };

  async function mockApi(url, method = 'GET', body = {}) {
    const seg = url.split('?')[0].split('/').filter(Boolean); // ['api', ...]
    await new Promise(r => setTimeout(r, 60 + Math.random() * 120)); // 轻微延迟，贴近真实节奏

    if (seg[1] === 'state' && method === 'GET') {
      return {
        ok: true,
        config: clone(store.config),
        projects: store.config.projects.map(p => projectState(p.id)),
        tasks: clone(store.tasks.filter(t => t.status === 'pending' && t.task)),
        track: { autoWatch: false, watchDirs: [], warnings: ['演示模式：无本地文件系统，自动感知不可用'] },
        serverTime: new Date().toISOString()
      };
    }

    if (seg[1] === 'memory' && seg[2] && method === 'GET') {
      const d = pd(seg[2]);
      if (!d) throw new Error('项目不存在：' + seg[2]);
      return { ok: true, project: seg[2], ...clone(d.memory) };
    }

    if (seg[1] === 'config' && method === 'PUT') {
      const next = body.config || body;
      // 轻量校验（与服务端 validateConfig 关键规则一致）
      for (const [k, a] of Object.entries(next.agents || {})) {
        const cmd = String(a.dispatchCommand == null ? '' : a.dispatchCommand).trim();
        if (cmd && !cmd.includes('{{PROMPT_FILE}}')) {
          throw new Error(`Agent ${k} 的 dispatchCommand 必须包含 {{PROMPT_FILE}} 占位符`);
        }
      }
      const ids = new Set();
      for (const p of next.projects || []) {
        if (!p.id || !p.name || !p.projectRoot || !p.memoryRoot || !p.agent) {
          throw new Error('项目缺少必填字段：id / name / projectRoot / memoryRoot / agent');
        }
        if (ids.has(p.id)) throw new Error(`项目 id 重复：${p.id}`);
        ids.add(p.id);
        if (!next.agents[p.agent]) throw new Error(`项目 ${p.id} 引用了不存在的 Agent：${p.agent}`);
        if (p.autoDispatch && !String(next.agents[p.agent].dispatchCommand || '').trim()) {
          throw new Error(`项目 ${p.id} 开启了 autoDispatch，但 Agent ${p.agent} 未配置 dispatchCommand`);
        }
      }
      // 保留已有项目的演示数据；新增项目建空数据集
      for (const p of next.projects) {
        if (!store.projects[p.id]) {
          store.projects[p.id] = {
            mtime: Date.now(), items: [], lastSync: null, fingerprint: '0'.repeat(16),
            memory: { memoryDir: `${p.memoryRoot}/.workbuddy/memory`.replace(/\\/g, '/'), contextFiles: [], dailyLogs: [] }
          };
        }
      }
      for (const k of Object.keys(store.projects)) {
        if (!next.projects.some(p => p.id === k)) delete store.projects[k];
      }
      store.config = { ...store.config, ...next };
      persist();
      return { ok: true, config: clone(store.config), projects: store.config.projects.map(p => projectState(p.id)) };
    }

    if (seg[1] === 'items' && seg[2]) {
      const projectId = seg[2];
      const d = pd(projectId);
      if (!d) throw new Error('项目不存在：' + projectId);
      conflict({ projectId, value: body.expectedMtime });
      const items = d.items;

      if (method === 'POST') {
        const title = String(body.title || '').trim();
        if (!title) throw new Error('改造项标题不能为空');
        const created = {
          id: String(Math.max(0, ...items.map(i => Number(i.id) || 0)) + 1),
          priority: PRIORITIES.includes(body.priority) ? body.priority : 'P2',
          status: 'todo',
          title, note: String(body.note || ''), updated: TODAY()
        };
        items.push(created);
        touch(projectId);
        const card = appendCard(projectId, 'add', created);
        persist();
        return { ok: true, mtime: d.mtime, items: clone(items), sync: { enabled: true, context: true, daily: true, files: [1, 2], warning: null }, task: !!card };
      }

      if (method === 'PATCH' && seg[3]) {
        const it = items.find(i => i.id === seg[3]);
        if (!it) throw new Error(`改造项不存在：#${seg[3]}`);
        const before = it.status;
        for (const k of ['priority', 'status', 'title', 'note']) {
          if (body[k] !== undefined) it[k] = String(body[k]);
        }
        if (!PRIORITIES.includes(it.priority)) throw new Error('优先级不合法');
        if (!STATUSES.includes(it.status)) throw new Error('状态不合法');
        if (!String(it.title).trim()) throw new Error('改造项标题不能为空');
        it.updated = TODAY();
        if (it.status === 'done' || it.status === 'removed' || (before === 'doing' && it.status === 'todo')) {
          closeCards(projectId, it.id);
        }
        touch(projectId);
        const card = (it.status === 'doing' && before !== 'doing') ? appendCard(projectId, 'edit', it) : null;
        persist();
        return { ok: true, mtime: d.mtime, items: clone(items), sync: { enabled: true, context: true, daily: true, files: [1, 2], warning: null }, task: !!card };
      }

      if (method === 'DELETE' && seg[3]) {
        const idx = items.findIndex(i => i.id === seg[3]);
        if (idx < 0) throw new Error(`改造项不存在：#${seg[3]}`);
        const it = items[idx];
        if (body.hard) items.splice(idx, 1);
        else { it.status = 'removed'; it.updated = TODAY(); }
        closeCards(projectId, it.id);
        touch(projectId);
        persist();
        return { ok: true, mtime: d.mtime, items: clone(items), sync: { enabled: true, context: true, daily: true, files: [1, 2], warning: null } };
      }
    }

    if (seg[1] === 'sync' && seg[2] && method === 'POST') {
      const d = pd(seg[2]);
      if (!d) throw new Error('项目不存在：' + seg[2]);
      d.lastSync = NOW();
      touch(seg[2]);
      persist();
      return { ok: true, items: clone(d.items), mtime: d.mtime, sync: { enabled: true, context: true, daily: true, files: [1, 2], warning: null } };
    }

    if (seg[1] === 'tasks' && seg[2] && method === 'POST') {
      const card = store.tasks.find(t => t.id === seg[2]);
      if (!card) throw new Error('任务卡不存在');
      card.status = body.status === 'done' ? 'done' : 'dispatched';
      card.closedAt = NOW();
      persist();
      return { ok: true, tasks: clone(store.tasks.filter(t => t.status === 'pending' && t.task)) };
    }

    throw new Error('演示模式不支持该操作：' + method + ' ' + url);
  }

  // ⚠ 此处不可再直接 window.__mockApi = mockApi：顶部队列包装（未就绪挂起、就绪重放）才是唯一挂载点，
  //   直接赋值会同步覆盖包装，app.js 首个请求在 store 就绪前进入 mockApi 而报 store.config 读取错误

  // 顶栏：演示徽标 + 重置入口
  // .demo-actions 作为 topbar 独立子项插在 brand 之后：PC 端随 flex 落在刷新按钮左侧；
  // 手机端 margin-left auto 靠右与标题同行（重置按钮由 CSS 收成图标腾宽度），不再单独占一行
  function addBanner() {
    const bar = document.querySelector('.topbar');
    if (!bar || document.getElementById('btn-demo-reset')) return;
    const actions = '<span class="demo-actions">' +
      '<span class="badge ro demo-badge" title="静态演示：数据为脱敏虚构示例，改动仅保存在本机浏览器，不影响任何真实项目">演示模式</span>' +
      '<button id="btn-demo-reset" class="btn ghost" title="清空本机演示改动，恢复初始示例数据">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>' +
      '<span>重置数据</span></button></span>';
    const brand = bar.querySelector('.brand');
    if (brand) brand.insertAdjacentHTML('afterend', actions);
    else bar.insertAdjacentHTML('beforeend', actions);
    document.getElementById('btn-demo-reset').addEventListener('click', () => {
      if (!confirm('重置演示数据？\n将清除本机保存的演示改动，恢复到初始示例。')) return;
      localStorage.removeItem(STORE_KEY);
      location.reload();
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addBanner);
  else addBanner();
})();
