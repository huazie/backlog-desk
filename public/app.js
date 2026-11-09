'use strict';

const $ = s => document.querySelector(s);
const PRIORITIES = ['P0', 'P1', 'P2', 'P3'];
const STATUSES = [['todo', '待办'], ['doing', '进行中'], ['done', '已完成'], ['removed', '已移除']];

const S = {
  config: null,
  projects: [],
  active: null,
  memory: null,
  tasks: [],
  track: null,
  filter: { q: '', status: 'all', priority: 'all' }
};

let lastMtimes = '';
let boardDirty = false;
let es = null;

function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

async function api(url, method = 'GET', body) {
  const r = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await r.json();
  if (!r.ok || data.ok === false) throw new Error(data.error || `请求失败 ${r.status}`);
  return data;
}

const activeProject = () => S.projects.find(p => p.id === S.active);
const activeMtime = () => activeProject()?.mtime ?? null;
const activeUrl = () => '/api/items/' + encodeURIComponent(S.active);

let toastTimer;
function toast(msg, kind = 'ok') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'toast show ' + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 3400);
}

async function loadState(withMemory = true) {
  const d = await api('/api/state');
  S.config = d.config;
  S.projects = d.projects;
  S.tasks = d.tasks || [];
  S.track = d.track || null;
  lastMtimes = d.projects.map(p => `${p.id}:${p.mtime}`).join('|');
  if (!S.projects.some(p => p.id === S.active)) S.active = S.projects[0]?.id ?? null;
  renderAll();
  if (withMemory) await loadMemory();
}

async function loadMemory() {
  if (!S.active) { S.memory = null; $('#memory-body').innerHTML = ''; return; }
  try {
    S.memory = await api('/api/memory/' + encodeURIComponent(S.active));
  } catch (e) {
    S.memory = null;
    $('#memory-body').innerHTML = `<div class="muted">读取失败：${esc(e.message)}</div>`;
    return;
  }
  renderMemory();
}

async function commit(url, method, body, msg) {
  const payload = { ...body, expectedMtime: activeMtime() };
  try {
    const r = await api(url, method, payload);
    await loadState(false);
    await loadMemory();
    const s = r.sync;
    const taskTip = r.task ? ' · 已生成待派发任务卡' : '';
    if (s?.warning) toast(`${msg}，但记忆同步失败：${s.warning}`, 'err');
    else if (s?.enabled && s.files?.length) toast(`${msg} · 已同步${s.context ? '长期笔记 + ' : ''}当天日志${taskTip}`);
    else toast(msg + taskTip);
  } catch (e) {
    toast(e.message, 'err');
  }
}

function renderAll() {
  renderStats();
  renderProjects();
  renderBoard();
  renderTrackBar();
  renderTasks();
}

function renderStats() {
  const all = S.projects.flatMap(p => p.items);
  const open = all.filter(i => i.status !== 'done' && i.status !== 'removed');
  const parts = [
    `<span class="stat"><b>${S.projects.length}</b> 项目</span>`,
    `<span class="stat"><b>${open.length}</b> 待处理</span>`,
    ...PRIORITIES.map(p =>
      `<span class="stat pri-${p}"><b>${open.filter(i => i.priority === p).length}</b> ${p}</span>`)
  ];
  $('#stats').innerHTML = parts.join('');
}

function renderProjects() {
  $('#project-list').innerHTML = S.projects.map(p => {
    const pending = p.items.filter(i => i.status === 'todo' || i.status === 'doing').length;
    const bad = Object.values(p.health).some(v => !v);
    return `<button class="proj ${p.id === S.active ? 'active' : ''}" data-id="${esc(p.id)}">
      <span class="proj-name">${esc(p.name)}</span>
      <span class="proj-meta">${esc(p.agentLabel)} · ${p.items.length} 项 · 待办 ${pending}</span>
      <span class="proj-path ${bad ? 'bad' : ''}">${bad ? '路径异常，请检查配置' : '记忆根可达'}</span>
    </button>`;
  }).join('') || '<div class="muted">暂无项目，点「添加项目」开始</div>';
}

function renderBoard() {
  const ae = document.activeElement;
  if (ae && ae.closest && ae.closest('#items-body') && (ae.tagName === 'INPUT' || ae.tagName === 'SELECT')) {
    boardDirty = true;
    return;
  }
  boardDirty = false;
  const p = activeProject();
  if (!p) {
    $('#board-title').textContent = '暂无项目';
    $('#board-path').innerHTML = '';
    $('#items-body').innerHTML = '';
    $('#empty').hidden = false;
    return;
  }

  $('#board-title').textContent = p.name;
  $('#board-path').innerHTML =
    `代码 <code>${esc(p.projectRoot)}</code><br>清单 <code>${esc(p.backlogPath)}</code>`;

  const f = S.filter;
  const rows = p.items.filter(it => {
    if (f.priority !== 'all' && it.priority !== f.priority) return false;
    if (f.status === 'open' && (it.status === 'done' || it.status === 'removed')) return false;
    if (f.status !== 'all' && f.status !== 'open' && it.status !== f.status) return false;
    const q = f.q.trim().toLowerCase();
    return !q || (it.title + ' ' + it.note).toLowerCase().includes(q);
  });

  $('#items-body').innerHTML = rows.map(it => {
    const optP = PRIORITIES.map(x =>
      `<option value="${x}" ${x === it.priority ? 'selected' : ''}>${x}</option>`).join('');
    const optS = STATUSES.map(([v, l]) =>
      `<option value="${v}" ${v === it.status ? 'selected' : ''}>${l}</option>`).join('');
    return `<tr data-id="${esc(it.id)}" class="s-${esc(it.status)}">
      <td class="c-id mono">#${esc(it.id)}</td>
      <td><select class="cell-sel" data-field="priority" data-p="${esc(it.priority)}">${optP}</select></td>
      <td><select class="cell-sel" data-field="status" data-s="${esc(it.status)}">${optS}</select></td>
      <td><input class="cell-input" data-field="title" value="${esc(it.title)}"></td>
      <td><input class="cell-input note" data-field="note" value="${esc(it.note)}"></td>
      <td class="c-date mono">${esc(it.updated)}</td>
      <td class="c-op">
        <button class="op" data-act="remove">移除</button>
        <button class="op hard" data-act="hard" title="彻底删除">×</button>
      </td>
    </tr>`;
  }).join('');
  $('#empty').hidden = rows.length > 0;
}

function renderTrackBar() {
  const bar = $('#track-bar');
  const p = activeProject();
  if (!p) { bar.hidden = true; return; }
  bar.hidden = false;
  const t = p.track || {};
  let cls = '', text = '', action = '';
  if (!t.watch) {
    cls = 'off';
    text = '自动跟踪已关闭 · 需手动点「刷新」读取磁盘变化';
  } else if (t.drift === true) {
    cls = 'warn';
    text = '清单已被外部改动，状态镜像待校准';
    action = '<button type="button" class="btn" id="btn-calibrate">立即校准</button>';
  } else if (t.drift === 'unknown' || t.drift === 'missing') {
    cls = 'warn';
    text = t.drift === 'missing' ? '未找到长期笔记状态镜像' : '状态镜像尚无指纹基线';
    action = '<button type="button" class="btn" id="btn-calibrate">建立基线</button>';
  } else {
    text = `自动跟踪已开启 · 清单与镜像一致 · 指纹 ${t.fingerprint || '—'}`;
  }
  bar.className = 'track-bar ' + cls;
  bar.innerHTML = `<span class="dot"></span><span class="grow">${esc(text)}</span>${action}<span class="badge ro">待派发 ${S.tasks.length}</span>`;
  const btn = $('#btn-calibrate');
  if (btn) btn.addEventListener('click', () => $('#btn-resync').click());
}

function renderTasks() {
  const panel = $('#task-panel');
  if (!S.tasks.length) { panel.hidden = true; return; }
  panel.hidden = false;
  $('#task-count').textContent = S.tasks.length + ' 张';
  $('#task-list').innerHTML = S.tasks.map(t => {
    const k = t.task || {};
    return `<div class="task-item" data-id="${esc(t.id)}">
      <span class="pri-tag" data-p="${esc(k.priority)}">${esc(k.priority)}</span>
      <div class="task-meta">
        <b>#${esc(k.itemId)} ${esc(k.title)}</b>
        <span class="mono">${esc(t.project)} · ${esc(k.status === 'doing' ? '进行中' : '待办')} · ${esc(t.localTime || '')}</span>
      </div>
      <button type="button" class="btn ghost" data-task="copy">复制指令</button>
      <button type="button" class="btn ghost" data-task="done">完成</button>
    </div>`;
  }).join('');
}

function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'absolute';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.select();
  let done = false;
  try { done = document.execCommand('copy'); } catch (_) { /* 浏览器不支持 */ }
  ta.remove();
  toast(done ? 'Agent 指令已复制' : '复制失败，请检查浏览器剪贴板权限', done ? 'ok' : 'err');
}

function connectEvents() {
  if (typeof EventSource === 'undefined' || S.config?.autoWatch === false) return;
  if (es) es.close();
  es = new EventSource('/api/events');
  es.onmessage = e => {
    let d;
    try { d = JSON.parse(e.data); } catch (_) { return; }
    if (d.type === 'change' && d.source === 'agent') {
      loadState().then(() => {
        if (d.warning) toast(`检测到外部改动，但校准失败：${d.warning}`, 'err');
        else if (d.calibrated) toast('检测到 Agent 改动清单 · 已刷新并自动校准镜像与日志');
        else toast('检测到 Agent 改动清单 · 已刷新（未自动校准）');
      }).catch(err => toast(err.message, 'err'));
    } else if (d.type === 'warning') {
      toast(d.message, 'err');
    }
  };
  es.onerror = () => { if (es) { es.close(); es = null; } };
}

function startPulse() {
  setInterval(async () => {
    if (S.config?.autoWatch === false) return;
    try {
      const d = await api('/api/state');
      const sig = d.projects.map(p => `${p.id}:${p.mtime}`).join('|');
      if (lastMtimes && sig !== lastMtimes) await loadState();
      lastMtimes = sig;
      if (!es) connectEvents();
    } catch (_) { /* 服务未就绪时静默 */ }
  }, 10000);
}

function renderMemory() {
  const m = S.memory;
  if (!m) return;
  const sync = activeProject()?.sync;
  const badge = $('#sync-badge');
  if (badge) {
    badge.className = 'badge ro ' + (sync?.lastSync ? 'synced' : sync?.enabled ? 'pending' : '');
    badge.textContent = sync?.lastSync ? `已同步 ${sync.lastSync.slice(-5)}` : sync?.enabled ? '待同步' : '同步已关';
    badge.title = sync?.context || '未配置长期笔记';
  }
  const ctx = (m.contextFiles || []).map(f =>
    `<details open><summary>${esc(f.name)}</summary><pre>${esc(f.content)}</pre></details>`).join('');
  const logs = (m.dailyLogs || []).map(l =>
    `<details><summary>${esc(l.name)} · ${l.headings.length} 节</summary><ul>${l.headings.map(h => `<li>${esc(h)}</li>`).join('')}</ul><pre>${esc(l.tail || '')}</pre></details>`).join('');
  $('#memory-body').innerHTML = `
    <div class="mem-path mono">${esc(m.memoryDir || '')}</div>
    <h4>长期笔记</h4>${ctx || '<div class="muted">未找到长期笔记文件</div>'}
    <h4>近期日志（标题）</h4>${logs || '<div class="muted">未找到日志文件</div>'}
    <div class="mem-tip">清单变更写回「改造清单.md」标记区块，并自动同步到长期笔记末尾的受控状态镜像 + 当天日志追加一行；历史条目一字不改。Agent 直接改清单时，工作台会自动感知并校准。点「同步」可按当前清单补校准一次。</div>`;
}

function openDrawer() { $('#drawer').hidden = false; }
function closeDrawer() { $('#drawer').hidden = true; }

async function saveConfig(next, msg) {
  try {
    await api('/api/config', 'PUT', { config: next });
    closeDrawer();
    await loadState();
    toast(msg);
  } catch (e) {
    toast(e.message, 'err');
  }
}

function openTrackForm() {
  const cfg = S.config;
  const box = (key, label, desc) => `<label class="ck">
    <input type="checkbox" data-flag="${key}" ${cfg[key] !== false ? 'checked' : ''}>
    <span><b>${label}</b><small>${desc}</small></span></label>`;
  const warnings = S.track?.warnings?.length
    ? '；告警：' + S.track.warnings.map(w => esc(w)).join(' / ') : '';
  $('#drawer-title').textContent = '跟踪设置';
  $('#drawer-body').innerHTML = `<form id="form-track" class="form">
    ${box('autoWatch', '自动感知', '监听各项目记忆目录，Agent 改动清单后看板通过 SSE 自动刷新；关闭后只能手动点「刷新」。')}
    ${box('autoCalibrate', '自动校准', 'Agent 直接改清单时，自动幂等校准 MEMORY.md 状态镜像并往当天日志追加一行。依赖「记忆同步」开关；关闭后看板只提示「待校准」。')}
    ${box('autoTask', '生成任务卡', '新增改造项或状态转为「进行中」时生成一张 pending 任务卡，供手动复制指令派发；不会自动唤起 Agent。')}
    <div class="hint">当前监听 ${S.track?.watchDirs?.length ?? 0} 个记忆目录${warnings}。项目可单独用同名配置字段覆盖全局开关。约定见各项目记忆目录的「改造清单协作约定.md」。</div>
    <div class="form-actions"><button type="submit" class="btn primary">保存</button></div>
  </form>`;
  openDrawer();
  $('#form-track').addEventListener('submit', async e => {
    e.preventDefault();
    const next = { ...cfg };
    for (const el of document.querySelectorAll('[data-flag]')) next[el.dataset.flag] = el.checked;
    await saveConfig(next, '跟踪设置已保存');
    connectEvents();
  });
}

function openProjectForm(id) {
  const cfg = S.config;
  const p = id
    ? cfg.projects.find(x => x.id === id)
    : { id: '', name: '', projectRoot: '', memoryRoot: '', agent: Object.keys(cfg.agents)[0] };
  const agents = Object.keys(cfg.agents).map(k =>
    `<option value="${esc(k)}" ${k === p.agent ? 'selected' : ''}>${esc(cfg.agents[k].label || k)}</option>`).join('');

  $('#drawer-title').textContent = id ? '编辑项目' : '添加项目';
  $('#drawer-body').innerHTML = `<form id="form-project" class="form">
    <label>项目 ID<input name="id" value="${esc(p.id)}" ${id ? 'readonly' : ''} placeholder="如 flea-game" required></label>
    <label>显示名称<input name="name" value="${esc(p.name)}" required></label>
    <label>代码根 projectRoot<input name="projectRoot" value="${esc(p.projectRoot)}" placeholder="项目目录绝对路径或 ~/..." required></label>
    <label>记忆根 memoryRoot<input name="memoryRoot" value="${esc(p.memoryRoot)}" placeholder="可与代码根不同" required></label>
    <label>Agent 适配器<select name="agent">${agents}</select></label>
    <div class="hint">projectRoot 是代码位置；memoryRoot 才是读取与写回记忆的位置。主题类子项目通常指向父仓。修改配置不会删除任何记忆文件。</div>
    <div class="form-actions">
      <button type="submit" class="btn primary">保存</button>
      ${id ? '<button type="button" class="btn danger" id="btn-del-project">删除项目</button>' : ''}
    </div>
  </form>`;
  openDrawer();

  $('#form-project').addEventListener('submit', async e => {
    e.preventDefault();
    const obj = Object.fromEntries(new FormData(e.target).entries());
    const projects = id
      ? cfg.projects.map(x => x.id === id ? { ...x, ...obj } : x)
      : [...cfg.projects, obj];
    await saveConfig({ ...cfg, projects }, '项目配置已保存');
  });

  if (id) {
    $('#btn-del-project').addEventListener('click', async () => {
      if (!confirm(`删除项目「${id}」？\n只移除工作台配置，不删除任何记忆文件。`)) return;
      await saveConfig({ ...cfg, projects: cfg.projects.filter(x => x.id !== id) }, '项目已移除');
      S.active = null;
      await loadState();
    });
  }
}

function agentCard(key, a) {
  const field = (name, value, label) =>
    `<label>${label}<input data-f="${name}" value="${esc(value)}"></label>`;
  return `<div class="agent-card" data-key="${esc(key)}">
    <div class="agent-head"><b>${esc(a.label || key)}</b><code>${esc(key)}</code>
      <button class="op hard" data-del-agent="${esc(key)}" title="删除适配器">×</button></div>
    ${field('label', a.label || '', '显示名称')}
    ${field('memoryDir', a.memoryDir || '', '记忆目录 memoryDir')}
    ${field('backlogFile', a.backlogFile || '', '清单文件名 backlogFile')}
    ${field('contextFiles', (a.contextFiles || []).join(','), '长期笔记 contextFiles（逗号分隔）')}
    ${field('syncFile', a.syncFile || '', '状态镜像 syncFile（留空取上面第一个）')}
    ${field('dailyPattern', a.dailyPattern || '', '日志匹配正则 dailyPattern')}
    ${field('dailyFile', a.dailyFile || '', '日志文件模板 dailyFile（{date} 占位）')}
  </div>`;
}

function openAgentForm() {
  const cfg = S.config;
  $('#drawer-title').textContent = 'Agent 适配器';
  $('#drawer-body').innerHTML = `
    <div class="hint" style="margin-bottom:14px">不同 Agent 只是记忆目录与文件名不同。新增适配器后，在项目配置里选它即可。<code>syncFile</code> 是状态镜像写入的长期笔记（留空取 contextFiles 第一个）；<code>dailyFile</code> 是当天日志文件名模板，<code>{date}</code> 会替换为本地日期。其他 Agent 的目录约定请以其实际文档 / 磁盘目录为准。</div>
    <div id="agent-cards">${Object.entries(cfg.agents).map(([k, a]) => agentCard(k, a)).join('')}</div>
    <div class="form-actions">
      <button type="button" class="btn" id="btn-add-agent">新增适配器</button>
      <button type="button" class="btn primary" id="btn-save-agents">保存</button>
    </div>`;
  openDrawer();

  $('#btn-add-agent').addEventListener('click', () => {
    const key = prompt('输入适配器标识（英文，如 claude）：');
    if (!key || !/^[a-zA-Z0-9_-]+$/.test(key) || cfg.agents[key]) {
      toast('标识为空、格式不符或已存在', 'err');
      return;
    }
    $('#agent-cards').insertAdjacentHTML('beforeend', agentCard(key, {
      label: key, memoryDir: '.', backlogFile: '改造清单.md',
      contextFiles: [], syncFile: '', dailyPattern: '^\\d{4}-\\d{2}-\\d{2}\\.md$',
      dailyFile: '{date}.md'
    }));
  });

  $('#btn-save-agents').addEventListener('click', () => {
    const agents = {};
    for (const card of document.querySelectorAll('.agent-card')) {
      const get = n => (card.querySelector(`[data-f="${n}"]`)?.value || '').trim();
      const key = card.dataset.key;
      agents[key] = {
        ...(cfg.agents[key] || {}),
        label: get('label') || key,
        memoryDir: get('memoryDir'),
        backlogFile: get('backlogFile'),
        contextFiles: get('contextFiles').split(',').map(s => s.trim()).filter(Boolean),
        syncFile: get('syncFile'),
        dailyPattern: get('dailyPattern'),
        dailyFile: get('dailyFile')
      };
    }
    saveConfig({ ...cfg, agents }, 'Agent 适配器已保存');
  });
}

$('#project-list').addEventListener('click', e => {
  const b = e.target.closest('.proj');
  if (!b) return;
  S.active = b.dataset.id;
  renderAll();
  loadMemory();
});

$('#project-list').addEventListener('dblclick', e => {
  const b = e.target.closest('.proj');
  if (b) openProjectForm(b.dataset.id);
});

$('#items-body').addEventListener('change', e => {
  const t = e.target;
  const tr = t.closest('tr');
  if (!tr || !t.dataset.field) return;
  const field = t.dataset.field;
  if (field === 'priority') t.dataset.p = t.value;
  if (field === 'status') { t.dataset.s = t.value; tr.className = 's-' + t.value; }
  commit(`${activeUrl()}/${encodeURIComponent(tr.dataset.id)}`, 'PATCH',
    { [field]: t.value }, `已更新 #${tr.dataset.id} 的${field === 'title' ? '标题' : field === 'note' ? '说明' : field === 'priority' ? '优先级' : '状态'}`);
});

$('#items-body').addEventListener('focusout', e => {
  if (!boardDirty) return;
  if (e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('#items-body')) return;
  setTimeout(() => { if (boardDirty) renderBoard(); }, 0);
});

$('#items-body').addEventListener('click', e => {
  const b = e.target.closest('button[data-act]');
  if (!b) return;
  const id = b.closest('tr').dataset.id;
  const url = `${activeUrl()}/${encodeURIComponent(id)}`;
  if (b.dataset.act === 'remove') {
    if (!confirm(`移除 #${id}？\n将标记为「已移除」并保留记录，避免后续 Agent 重新列为待办。`)) return;
    commit(url, 'DELETE', {}, `已移除 #${id}`);
  } else {
    if (!confirm(`彻底删除 #${id}？\n该行将从清单文件消失（工作台 backups/ 目录有写前备份）。`)) return;
    commit(url, 'DELETE', { hard: true }, `已彻底删除 #${id}`);
  }
});

$('#task-list').addEventListener('click', async e => {
  const b = e.target.closest('button[data-task]');
  if (!b) return;
  const id = b.closest('.task-item')?.dataset.id;
  const t = S.tasks.find(x => x.id === id);
  if (!t) return;
  if (b.dataset.task === 'copy') {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(t.task.prompt);
        toast('Agent 指令已复制，粘贴到会话即可执行');
      } catch (_) { fallbackCopy(t.task.prompt); }
    } else {
      fallbackCopy(t.task.prompt);
    }
  } else {
    try {
      await api('/api/tasks/' + encodeURIComponent(id), 'POST', { status: 'done' });
      await loadState(false);
      toast('任务卡已标记完成');
    } catch (err) { toast(err.message, 'err'); }
  }
});

$('#add-form').addEventListener('submit', async e => {
  e.preventDefault();
  const title = $('#new-title').value.trim();
  if (!title) return;
  await commit(activeUrl(), 'POST', {
    title,
    priority: $('#new-priority').value,
    note: $('#new-note').value.trim()
  }, `已添加「${title}」`);
  $('#new-title').value = '';
  $('#new-note').value = '';
});

$('#new-priority').addEventListener('change', e => { e.target.dataset.p = e.target.value; });
$('#q').addEventListener('input', e => { S.filter.q = e.target.value; renderBoard(); });
$('#f-priority').addEventListener('change', e => { S.filter.priority = e.target.value; renderBoard(); });
$('#f-status').addEventListener('change', e => { S.filter.status = e.target.value; renderBoard(); });

$('#btn-refresh').addEventListener('click', () =>
  loadState().then(() => toast('已从磁盘重新读取')).catch(e => toast(e.message, 'err')));
$('#btn-resync').addEventListener('click', async () => {
  if (!S.active) return;
  try {
    const r = await api('/api/sync/' + encodeURIComponent(S.active), 'POST', {});
    await loadState(false);
    await loadMemory();
    const s = r.sync;
    if (s?.warning) toast('同步失败：' + s.warning, 'err');
    else if (!s?.enabled) toast('该项目已关闭记忆同步');
    else toast(`已按清单校准 · ${s.context ? '长期笔记 + ' : ''}当天日志（${r.items.length} 项）`);
  } catch (e) { toast(e.message, 'err'); }
});
$('#btn-project').addEventListener('click', () => openProjectForm());
$('#btn-agent').addEventListener('click', openAgentForm);
$('#btn-track').addEventListener('click', openTrackForm);
$('#btn-theme').addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  localStorage.setItem('pbw-theme', next);
});
$('#drawer').addEventListener('click', e => {
  if (e.target.closest('[data-close]')) return closeDrawer();
  const del = e.target.closest('[data-del-agent]');
  if (!del) return;
  const key = del.dataset.delAgent;
  if (S.config.projects.some(p => p.agent === key)) {
    toast('仍有项目在使用该适配器，不能删除', 'err');
    return;
  }
  del.closest('.agent-card').remove();
});

document.documentElement.dataset.theme = localStorage.getItem('pbw-theme') || 'light';
loadState().then(() => { connectEvents(); startPulse(); }).catch(e => toast('加载失败：' + e.message, 'err'));
