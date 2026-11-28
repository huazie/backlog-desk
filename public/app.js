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
  // 多选筛选：空数组 = 全部（状态里的 'open' 仅待处理为伪状态，等价 todo+doing 复合选择）；
  // filter 为当前项目条目的引用（attachFilter 绑定），filters 按项目 id 分存（#48）
  filters: null,
  filter: { q: '', status: [], priority: [] }
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
  // 静态演示模式：demo.js 检测 ?demo=1 后挂载 __mockApi，全部请求走内存 mock（见 public/demo.js）
  if (window.__mockApi) return window.__mockApi(url, method, body);
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
// 项目选择持久化 key：演示态独立，避免 demo 页的选择记忆与真实页互相覆盖（demo.js 先于本文件挂载 __mockApi）
const PROJ_KEY = window.__mockApi ? 'pbw-project-demo' : 'pbw-project';
// 筛选按项目独立（#48）：S.filters[projectId] 持有该项目筛选并落 localStorage（刷新恢复），
// S.filter 指向当前项目的条目；key 随演示态独立，与 PROJ_KEY 同策略
const FILTER_KEY = window.__mockApi ? 'pbw-filters-demo' : 'pbw-filters';
const newFilter = () => ({ q: '', status: [], priority: [] });
const readFilters = () => {
  try { return JSON.parse(localStorage.getItem(FILTER_KEY)) || {}; } catch { return {}; }
};
const saveFilters = () => localStorage.setItem(FILTER_KEY, JSON.stringify(S.filters));
S.filters = readFilters();
// 绑定当前项目的筛选到 S.filter 并回填控件（切项目与页面恢复共用）
const attachFilter = () => {
  if (!S.filters[S.active]) S.filters[S.active] = newFilter();
  S.filter = S.filters[S.active];
  saveFilters();
  const q = $('#q');
  if (q.value !== S.filter.q) q.value = S.filter.q; // 同值不回写，避免打断输入光标
  $('#ms-priority')._sync?.();
  $('#ms-status')._sync?.();
};
const activeMtime = () => activeProject()?.mtime ?? null;
const activeUrl = () => '/api/items/' + encodeURIComponent(S.active);
const activeTasks = () => S.tasks.filter(t => t.project === S.active);

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
  // 记住上次选中的项目：刷新/重开页面后恢复；项目已不存在则回落第一个并清理记录
  const saved = localStorage.getItem(PROJ_KEY);
  if (!S.active && saved && S.projects.some(p => p.id === saved)) S.active = saved;
  if (!S.projects.some(p => p.id === S.active)) S.active = S.projects[0]?.id ?? null;
  if (S.active) localStorage.setItem(PROJ_KEY, S.active);
  else localStorage.removeItem(PROJ_KEY);
  attachFilter(); // 恢复/刷新后绑定当前项目的筛选并回填控件（#48）
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
    return `<div class="proj ${p.id === S.active ? 'active' : ''}" data-id="${esc(p.id)}" role="button">
      <span class="proj-name">${esc(p.name)}</span>
      <span class="proj-meta">${esc(p.agentLabel)} · ${p.items.length} 项 · 待办 ${pending}</span>
      <span class="proj-path ${bad ? 'bad' : ''}">${bad ? '路径异常，请检查配置' : '记忆根可达'}</span>
      <button class="op" data-edit-project="${esc(p.id)}" title="编辑项目">✎</button>
    </div>`;
  }).join('') || '<div class="muted">暂无项目，点「项目配置」开始</div>';
}

// 提交状态图标：解析 note 中既有提交留痕文本（零清单格式变更，存量行自动生效）。
// 优先级 已推送 > 已提交 > 未提交；done 条目三态兜底（前两个未命中即未提交），非 done 不显示
// git 生命周期 SVG（currentColor 随三态配色）：实心圆+上箭头=已推送、环形节点=已提交、虚线空圈=未提交
const GIT_ICONS = {
  pushed: '<circle cx="8" cy="10" r="4.5" fill="currentColor"/><path d="M8 6.2V1.8M5.8 4 8 1.8 10.2 4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>',
  committed: '<circle cx="8" cy="8" r="5" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="8" r="1.8" fill="currentColor"/>',
  uncommitted: '<circle cx="8" cy="8" r="4.6" fill="none" stroke="currentColor" stroke-width="1.3" stroke-dasharray="2.2 2"/><circle cx="8" cy="8" r="1" fill="currentColor"/>'
};
function commitBadge(it) {
  if (it.status !== 'done') return '';
  const n = it.note || '';
  // 唯一留痕锚：「commit + hash」约定格式（bare hash / 裸「已推送」字样一律不认，
  // 避免 note 元文本——如描述本功能的验收文案——被误判）
  const m = n.match(/\bcommit\s+([0-9a-f]{7,40})\b/i);
  if (!m) return ['uncommitted', '未提交', 'note 未记载 commit 留痕（约定格式：commit + hash），代码可能仍在工作区'];
  // 「已推送」仅在 hash 之后的近邻窗口内认定，远处出现该字样不影响判定
  const after = n.slice(m.index + m[0].length, m.index + m[0].length + 80);
  if (/已推送|已在远端/.test(after)) return ['pushed', '已推送', 'note 记载代码已推送远端'];
  return ['committed', '已提交', 'note 记载代码已 commit（本地）'];
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
    if (f.priority.length && !f.priority.includes(it.priority)) return false;
    if (f.status.length) {
      const sel = new Set(f.status);
      if (sel.has('open')) { sel.add('todo'); sel.add('doing'); }
      // 「已完成·未提交/已提交/已推送」为拆分伪状态（#45），按 note 留痕的提交态细分匹配
      let ok = sel.has(it.status);
      if (!ok && it.status === 'done') {
        const badge = commitBadge(it);
        ok = !!badge && sel.has('done-' + badge[0]);
      }
      if (!ok) return false;
    }
    const q = f.q.trim().toLowerCase();
    return !q || (it.title + ' ' + it.note).toLowerCase().includes(q);
  });

  // —— 已完成折叠分组（#55）：无筛选闲览时，终态已推送行按相邻编号差≤3 串段、
  // 段长≥5 折成组头行；有筛选（优先级/状态/搜索）时全平铺不折叠
  const seq = buildDoneGroups(rows, f);
  $('#items-body').innerHTML = seq.map(en => {
    if (en.head) return `<tr class="done-ghead${en.open ? ' open' : ''}" data-seg="${en.start}">
      <td colspan="7"><span class="gchev"></span>#${en.start}~#${en.end} · 已完成 ${en.count} 项（已推送）</td></tr>`;
    const it = en.it;
    const badge = commitBadge(it);
    // 已推送 = 终态锁定（#46）：note 是提交态唯一留痕锚（commit+hash+已推送窗口），
    // 手滑改动会掉档徽标并经自动保存同步进记忆；title/note readonly（可选中复制），
    // 优先级/状态下拉 disabled；hover 展开仅用于查看全文
    const ro = !!badge && badge[0] === 'pushed';
    const optP = PRIORITIES.map(x =>
      `<option value="${x}" ${x === it.priority ? 'selected' : ''}>${x}</option>`).join('');
    // 「已完成」只能由 Agent 按约定回写、「已移除」只能由右侧「移除」按钮完成，
    // 状态下拉里这两项置灰（当前值除外），不允许手动直接切换
    const optS = STATUSES.map(([v, l]) => {
      const locked = (v === 'done' || v === 'removed') && v !== it.status;
      return `<option value="${v}" ${v === it.status ? 'selected' : ''}${locked ? ' disabled' : ''}>${l}</option>`;
    }).join('');
    const badgeHtml = badge
      ? `<svg class="git-ico b-${badge[0]}" width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><title>${esc(badge[1])}：${esc(badge[2])}</title>${GIT_ICONS[badge[0]]}</svg>` : '';
    // done 行携带提交态类（b-pushed 等），供降权样式区分「已完成且已推送」的更强弱化（#42）；
    // grp-off：所属组处于折叠态（#55），CSS display:none 隐藏
    return `<tr data-id="${esc(it.id)}" class="s-${esc(it.status)}${badge ? ' b-' + esc(badge[0]) : ''}${en.off ? ' grp-off' : ''}">
      <td class="c-id mono">#${esc(it.id)}</td>
      <td><select class="cell-sel" data-field="priority" data-p="${esc(it.priority)}"${ro ? ' disabled title="已完成并推送，锁定编辑"' : ''}>${optP}</select></td>
      <td><span class="st-wrap"><select class="cell-sel" data-field="status" data-s="${esc(it.status)}"${ro ? ' disabled title="已完成并推送，锁定编辑"' : ''}>${optS}</select>${badgeHtml}</span></td>
      <td><input class="cell-input" data-field="title" value="${esc(it.title)}" title="${esc(it.title)}"${ro ? ' readonly' : ''}></td>
      <td><input class="cell-input note" data-field="note" value="${esc(it.note)}" title="${esc(it.note)}"${ro ? ' readonly' : ''}></td>
      <td class="c-date mono">${esc(it.updated)}</td>
      <td class="c-op">
        ${it.status === 'removed' ? '' : '<button class="op" data-act="remove">移除</button>'}
        <button class="op hard" data-act="hard" title="彻底删除">×</button>
      </td>
    </tr>`;
  }).join('');
  $('#empty').hidden = rows.length > 0;
  syncTableWrapFit();
}

// 表头吸顶前提（#54）：表格装得下时 wrap 加 .fit 逃逸为非滚动容器（CSS overflow:visible），
// th 的 sticky 才相对 .board 生效；装不下时保持 auto 横滚——此时原生 th 的 sticky 相对
// 永不纵滚的 wrap 失效，改用克隆表头方案（#54 追加）：thead 克隆到 wrap 外的
// #table-sticky-head（sticky 相对 .board 生效），横滚偏移由 scroll 事件同步
function syncTableWrapFit() {
  document.querySelectorAll('.table-wrap').forEach(w => {
    const fit = w.scrollWidth <= w.clientWidth;
    w.classList.toggle('fit', fit);
    if (fit) removeStickyHead(w); else buildStickyHead(w);
  });
}
window.addEventListener('resize', syncTableWrapFit);

function buildStickyHead(wrap) {
  const src = wrap.querySelector('table.items thead');
  if (!src) return;
  let head = wrap.previousElementSibling;
  if (!head || head.id !== 'table-sticky-head') {
    head = document.createElement('div');
    head.id = 'table-sticky-head';
    head.innerHTML = '<table class="items"><thead></thead></table>';
    wrap.before(head);
    // 数据区横滚 → 克隆表头反向平移同步，列保持对齐（容器 overflow hidden 裁剪）
    wrap.addEventListener('scroll', () => {
      const it = head.querySelector('table.items');
      if (it) it.style.transform = 'translateX(' + (-wrap.scrollLeft) + 'px)';
    }, { passive: true });
  }
  const ct = head.querySelector('table.items');
  ct.style.transform = 'translateX(' + (-wrap.scrollLeft) + 'px)';
  head.querySelector('thead').replaceChildren(src.cloneNode(true));
  head.classList.add('show');
  wrap.classList.add('cloned'); // 先藏原生 thead——此后显示表格列宽由 tbody 单独决定
  // 列宽对齐（#54）：thead 藏后原表列宽与克隆表（完整 thead+tbody 布局）不再一致，
  // 克隆表改 fixed 布局，按显示中 tbody 首行实测列宽逐列写入
  const dt = wrap.querySelector('table.items');
  ct.style.tableLayout = 'fixed';
  const cells = dt.querySelectorAll('tbody tr:first-child > *');
  const cths = ct.querySelectorAll('thead th');
  cells.forEach((c, i) => { if (cths[i]) cths[i].style.width = c.offsetWidth + 'px'; });
  ct.style.width = dt.offsetWidth + 'px';
}

function removeStickyHead(wrap) {
  const head = wrap.previousElementSibling;
  if (head && head.id === 'table-sticky-head') head.remove();
  wrap.classList.remove('cloned');
}

// 已完成折叠分组（#55）：终态已推送行按相邻编号差≤3 串联成段，段长≥5 才折叠——
// 小段折叠收益低反而添一次点击；有筛选时全平铺（找东西时折叠是障碍）。
// 展开段按项目存 localStorage（key 含 projectId），新组默认折叠
function buildDoneGroups(rows, f) {
  const hasFilter = f.priority.length || f.status.length || f.q.trim();
  if (hasFilter) return rows.map(it => ({ it }));
  const isPushed = it => { const b = commitBadge(it); return it.status === 'done' && b && b[0] === 'pushed'; };
  const segs = [];
  let cur = null;
  for (const it of rows) {
    const n = Number(it.id);
    if (isPushed(it)) {
      if (cur && n > cur.end && n - cur.end <= 3) { cur.end = n; cur.items.push(it); }
      else { if (cur) segs.push(cur); cur = { start: n, end: n, items: [it] }; }
    } else { if (cur) segs.push(cur); cur = null; }
  }
  if (cur) segs.push(cur);
  const big = segs.filter(s => s.items.length >= 5);
  if (!big.length) return rows.map(it => ({ it }));
  let open = [];
  try { open = JSON.parse(localStorage.getItem('bdesk-done-fold:' + S.active) || '[]'); } catch (_) {}
  const openSet = new Set(open.filter(s => big.some(b => b.start === s)));
  const segOf = new Map();
  big.forEach(s => s.items.forEach(it => segOf.set(it.id, s)));
  const out = [];
  const emitted = new Set();
  for (const it of rows) {
    const s = segOf.get(it.id);
    if (!s) { out.push({ it }); continue; }
    if (!emitted.has(s.start)) {
      emitted.add(s.start);
      out.push({ head: true, start: s.start, end: s.end, count: s.items.length, open: openSet.has(s.start) });
    }
    out.push({ it, off: !openSet.has(s.start) });
  }
  return out;
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
  bar.innerHTML = `<span class="dot"></span><span class="grow">${esc(text)}</span>${action}<span class="badge ro">待派发 ${activeTasks().length}</span>`;
  const btn = $('#btn-calibrate');
  if (btn) btn.addEventListener('click', () => $('#btn-resync').click());
}

function renderTasks() {
  const panel = $('#task-panel');
  const tasks = activeTasks();
  if (!tasks.length) { panel.hidden = true; return; }
  panel.hidden = false;
  $('#task-count').textContent = tasks.length + ' 张';
  $('#task-list').innerHTML = tasks.map(t => {
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
    `<details><summary>${esc(l.name)} · ${l.headings.length} 节 · ${l.lines || 0} 行</summary><ul>${l.headings.map(h => `<li>${esc(h)}</li>`).join('')}</ul><pre>${esc(l.tail || '')}</pre></details>`).join('');
  $('#memory-body').innerHTML = `
    <div class="mem-path mono">${esc(m.memoryDir || '')}</div>
    <h4>长期笔记</h4>${ctx || '<div class="muted">未找到长期笔记文件</div>'}
    <h4>近期日志（标题）</h4>${logs || '<div class="muted">未找到日志文件</div>'}
    <div class="mem-tip">清单变更写回「改造清单.md」标记区块，并自动同步到长期笔记末尾的受控状态镜像 + 当天日志追加一行；历史条目一字不改。Agent 直接改清单时，工作台会自动感知并校准。点「同步」可按当前清单补校准一次。</div>`;
}

function openDrawer() { $('#drawer').hidden = false; }
function closeDrawer() { $('#drawer-actions').innerHTML = ''; $('#drawer').hidden = true; }

async function saveConfig(next, msg, keepOpen) {
  try {
    await api('/api/config', 'PUT', { config: next });
    if (!keepOpen) closeDrawer();
    await loadState();
    toast(msg);
    return true;
  } catch (e) {
    toast(e.message, 'err');
    return false;
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

// 项目卡「记忆根 memoryRoot」的 label 行：适配器带 memoryHint（trae/dsh 记忆目录在用户级路径，
// 配 memoryRoot 需要该说明）时在行右侧渲染 ⓘ 悬浮提示，与 Agent 配置卡 skillDir 的 tip 同款；
// 无 memoryHint 的适配器不渲染图标；随适配器切换整体重渲染
function memRootLbl(agentKey) {
  const hint = (S.config.agents[agentKey]?.memoryHint || '').trim();
  const tip = hint ? `<span class="tip" data-mem-tip><svg class="tip-i" width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="6.6" stroke="currentColor" stroke-width="1.3"/><rect x="7.35" y="7.1" width="1.3" height="4.1" rx="0.65" fill="currentColor"/><circle cx="8" cy="4.9" r="0.95" fill="currentColor"/></svg><span class="tip-box">${esc(hint)}</span></span>` : '';
  return `<span class="lbl-row" data-mem-lbl>记忆根 memoryRoot${tip}</span>`;
}

// 项目配置卡片：复用 agent-card 的卡片样式与收起/展开交互，每个项目独立编辑、独立保存
function projectCard(p, isNew) {
  const d = p || { name: '', projectRoot: '', memoryRoot: '', agent: Object.keys(S.config.agents)[0] };
  const agents = Object.entries(S.config.agents).map(([k, a]) =>
    `<option value="${esc(k)}" ${k === d.agent ? 'selected' : ''}>${esc(a.label || k)}</option>`).join('');
  return `<div class="agent-card ${p && !isNew ? 'collapsed' : ''}" data-id="${esc(p?.id || '')}">
    <div class="agent-head"><b>${esc(d.name || '新项目')}</b><code>${esc(p?.id || '未保存')}</code>
      <span class="tw">▾</span>
      <button class="btn ghost" data-save-project="${esc(p?.id || '')}" title="仅保存该项目">保存</button>
      ${p ? `<button class="op hard" data-del-project="${esc(p.id)}" title="删除项目">×</button>` : ''}
    </div>
    <div class="agent-body">
      <label>项目 ID<input data-f="id" value="${esc(p?.id || '')}" ${p ? 'readonly' : ''} placeholder="英文标识，如 flea-game"></label>
      <label>显示名称<input data-f="name" value="${esc(d.name)}"></label>
      <label>代码根 projectRoot<input data-f="projectRoot" value="${esc(d.projectRoot)}" placeholder="项目目录绝对路径或 ~/..."></label>
      <label>${memRootLbl(d.agent)}<input data-f="memoryRoot" value="${esc(d.memoryRoot)}" placeholder="可与代码根不同"></label>
      <label>Agent 适配器<select data-f="agent">${agents}</select></label>
    </div>
  </div>`;
}

function openProjectsForm(openId, addNew) {
  $('#drawer-title').textContent = '项目';
  $('#drawer-actions').innerHTML = '<button type="button" class="btn" id="btn-add-project">添加项目</button>';
  $('#drawer-body').innerHTML = `
    <div class="hint" style="margin-bottom:14px">projectRoot 是代码位置；memoryRoot 才是读取与写回记忆的位置，主题类子项目通常指向父仓。修改配置不会删除任何记忆文件。</div>
    <div id="proj-cards">${S.config.projects.map(p => projectCard(p)).join('')}</div>
    <div class="hint">每个项目独立保存：点卡片头部的「保存」只提交该卡片的修改，抽屉保持打开；点头部空白处收起/展开。</div>`;
  if (openId) {
    const card = $('#proj-cards').querySelector(`.agent-card[data-id="${CSS.escape(openId)}"]`);
    if (card) card.classList.remove('collapsed');
  }
  openDrawer();
  $('#btn-add-project').addEventListener('click', () => {
    $('#proj-cards').insertAdjacentHTML('beforeend', projectCard(null, true));
  });
  if (addNew) $('#btn-add-project').click();
}

function agentCard(key, a, isNew) {
  const field = (name, value, label) =>
    `<label>${label}<input data-f="${name}" value="${esc(value)}"></label>`;
  return `<div class="agent-card ${!isNew ? 'collapsed' : ''}" data-key="${esc(key)}">
    <div class="agent-head"><b>${esc(a.label || key)}</b><code>${esc(key)}</code>
      <span class="tw">▾</span>
      <button class="btn ghost" data-save-agent="${esc(key)}" title="仅保存该适配器">保存</button>
      <button class="op hard" data-del-agent="${esc(key)}" title="删除适配器">×</button></div>
    <div class="agent-body">
    ${field('label', a.label || '', '显示名称')}
    ${field('memoryDir', a.memoryDir || '', '记忆目录 memoryDir（留空 = 即项目记忆根）')}
    <label><span class="lbl-row">技能根目录 skillDir（留空 = 不支持 skill 安装）<span class="tip"><svg class="tip-i" width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="6.6" stroke="currentColor" stroke-width="1.3"/><rect x="7.35" y="7.1" width="1.3" height="4.1" rx="0.65" fill="currentColor"/><circle cx="8" cy="4.9" r="0.95" fill="currentColor"/></svg><span class="tip-box">该 Agent 技能根目录的目录名（单个目录名，如 <code>.claude</code> / <code>.trae-cn</code>）。配置后可用 <code>bdesk skill --agent &lt;名字&gt;</code> 安装「改造清单协作约定」skill：项目级装 <code>&lt;项目根&gt;/&lt;skillDir&gt;/skills/</code>，用户级（--global）装 <code>~&lt;/skillDir&gt;/skills/</code>。留空 = 不支持 skill 安装。</span></span></span><input data-f="skillDir" value="${esc(a.skillDir || '')}" placeholder="如 .claude，须为单个目录名"></label>
    ${field('backlogFile', a.backlogFile || '', '清单文件名 backlogFile')}
    ${field('contextFiles', (a.contextFiles || []).join(','), '长期笔记 contextFiles（逗号分隔）')}
    ${field('syncFile', a.syncFile || '', '状态镜像 syncFile（留空取上面第一个）')}
    ${field('dailyPattern', a.dailyPattern || '', '日志匹配正则 dailyPattern')}
    ${field('dailyFile', a.dailyFile || '', '日志文件模板 dailyFile（{date} 占位）')}
    </div>
  </div>`;
}

function openAgentForm() {
  const cfg = S.config;
  $('#drawer-title').textContent = 'Agent 适配器';
  $('#drawer-actions').innerHTML = '<button type="button" class="btn" id="btn-add-agent">新增适配器</button>';
  $('#drawer-body').innerHTML = `
    <div class="hint" style="margin-bottom:14px">不同 Agent 只是记忆目录与文件名不同。新增适配器后，在项目配置里选它即可。<code>syncFile</code> 是状态镜像写入的长期笔记（留空取 contextFiles 第一个）；<code>dailyFile</code> 是当天日志文件名模板，<code>{date}</code> 会替换为本地日期；<code>skillDir</code> 配置后可用 <code>bdesk skill --agent &lt;名字&gt;</code> 安装协作约定 skill（留空 = 不支持安装）。其他 Agent 的目录约定请以其实际文档 / 磁盘目录为准。</div>
    <div id="agent-cards">${Object.entries(cfg.agents).map(([k, a]) => agentCard(k, a)).join('')}</div>
    <div class="hint">每个适配器独立保存：点卡片头部的「保存」只提交该卡片的修改，抽屉保持打开。</div>`;
  openDrawer();

  $('#btn-add-agent').addEventListener('click', () => {
    const key = prompt('输入适配器标识（英文，如 claude）：');
    if (!key || !/^[a-zA-Z0-9_-]+$/.test(key) || S.config.agents[key]) {
      toast('标识为空、格式不符或已存在', 'err');
      return;
    }
    $('#agent-cards').insertAdjacentHTML('beforeend', agentCard(key, {
      label: key, memoryDir: '.', backlogFile: '改造清单.md',
      contextFiles: [], syncFile: '', dailyPattern: '^\\d{4}-\\d{2}-\\d{2}\\.md$',
      dailyFile: '{date}.md', skillDir: ''
    }, true));
  });
}

$('#project-list').addEventListener('click', e => {
  // 显式编辑入口：点卡片右上角 ✎ 打开配置抽屉并展开该项目卡片
  const ed = e.target.closest('[data-edit-project]');
  if (ed) { openProjectsForm(ed.dataset.editProject); return; }
  const b = e.target.closest('.proj');
  if (!b) return;
  S.active = b.dataset.id;
  localStorage.setItem(PROJ_KEY, S.active);
  attachFilter(); // 切项目：载入该项目自己的筛选（#48），与全局互不污染
  renderAll();
  loadMemory();
});

$('#project-list').addEventListener('dblclick', e => {
  const b = e.target.closest('.proj');
  if (b) openProjectsForm(b.dataset.id);
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

// 输入框内容超宽被裁剪时，悬浮 title 提示跟随编辑实时更新
$('#items-body').addEventListener('input', e => {
  const f = e.target.dataset && e.target.dataset.field;
  if (f === 'title' || f === 'note') e.target.title = e.target.value;
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
    if (!confirm(`关闭并隐藏任务卡 #${t.task?.itemId ?? ''}？\n仅关闭这张卡，不影响清单条目状态；关闭后看板不再显示。`)) return;
    try {
      await api('/api/tasks/' + encodeURIComponent(id), 'POST', { status: 'done' });
      await loadState(false);
      toast('任务卡已关闭');
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
$('#q').addEventListener('input', e => { S.filter.q = e.target.value; saveFilters(); renderBoard(); });

// 多选筛选下拉：按钮 + 弹出复选面板，按钮外观与 select 一致；空选 = 全部（按钮显示
// allLabel），选中项以顿号串联回显；点面板外或 Esc 关闭，打开一个自动收起其他
function initMultiSelect(root, { allLabel, options, get, set }) {
  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'msel-btn';
  btn.id = root.id.replace('ms-', 'f-');
  const pop = document.createElement('div');
  pop.className = 'msel-pop'; pop.hidden = true;
  pop.innerHTML = options.map(o =>
    `<label class="msel-opt"><input type="checkbox" value="${esc(o.v)}"><span>${esc(o.pl || o.l)}</span>${o.ico
      ? `<svg class="git-ico b-${esc(o.ico)}" width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><title>${esc(o.tip || o.l)}</title>${GIT_ICONS[o.ico]}</svg>`
      : ''}</label>`).join('');
  root.append(btn, pop);
  // 箭头随面板开合翻转（#53）：监听 hidden 属性统一驱动——按钮点击/点外部/滚动收起/
  // 打开另一面板等任一路径收起都同步，不散落在各关闭分支
  new MutationObserver(() => btn.classList.toggle('open', !pop.hidden))
    .observe(pop, { attributes: true, attributeFilter: ['hidden'] });

  const sync = () => {
    const sel = get();
    pop.querySelectorAll('input').forEach(cb => { cb.checked = sel.includes(cb.value); });
    // 带图标的选项回显为「文案 + 同款图标」（与面板一致）；纯文字选项维持 esc 文本
    btn.innerHTML = sel.length
      ? options.filter(o => sel.includes(o.v)).map(o => o.ico
          ? `<span>${esc(o.pl || o.l)}</span><svg class="git-ico b-${esc(o.ico)}" width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><title>${esc(o.tip || o.l)}</title>${GIT_ICONS[o.ico]}</svg>`
          : esc(o.l)).join('、')
      : esc(allLabel);
    btn.classList.toggle('active', sel.length > 0);
  };
  const closePop = () => { pop.hidden = true; };
  // 打开时以 fixed 定位精确落点（#50）：.board overflow-y:auto 会裁剪 absolute 面板
  // 伸出部分，矮视口下底部选项又会被视口截断——fixed 一次逃逸两个约束；
  // 下方放不下且上方更宽裕时向上翻转
  const openPop = () => {
    pop.hidden = false;
    pop.style.position = 'fixed';
    const r = btn.getBoundingClientRect();
    pop.style.left = r.left + 'px';
    pop.style.minWidth = Math.max(btn.offsetWidth, 100) + 'px'; // fixed 下原 min-width:100% 失效，改对齐按钮宽
    pop.style.bottom = 'auto';
    pop.style.top = 'auto';
    // 三态决策（#50）：下方够→向下；下方不够且上方更宽裕→向上；两边都不够→
    // 选空间大的一侧并动态收紧 max-height 内滚，面板任何视口下都不伸出屏幕
    const need = pop.scrollHeight + 12; // 内容高 + border/padding 余量
    const below = window.innerHeight - r.bottom;
    const above = r.top;
    if (below >= need || (above < need && below >= above)) {
      pop.style.top = (r.bottom + 4) + 'px';
      pop.style.maxHeight = Math.max(120, below - 8) + 'px';
      pop.classList.remove('up');
    } else {
      pop.style.bottom = (window.innerHeight - r.top + 4) + 'px';
      pop.style.maxHeight = Math.max(120, above - 8) + 'px';
      pop.classList.add('up');
    }
  };
  btn.addEventListener('click', e => {
    e.stopPropagation(); // 按钮点击不冒泡到 document 关闭监听，否则刚打开即被自身关闭
    const wasOpen = !pop.hidden;
    document.querySelectorAll('.msel-pop').forEach(p => { p.hidden = true; });
    if (!wasOpen) openPop();
  });
  // fixed 面板不随文档滚动，页面滚动/缩放窗口会与按钮错位——直接收起（#50）；
  // 面板自身内滚（max-height 兜底态）不收起
  window.addEventListener('scroll', e => { if (!pop.contains(e.target)) pop.hidden = true; }, { capture: true, passive: true });
  window.addEventListener('resize', closePop);
  pop.addEventListener('click', e => e.stopPropagation());
  pop.addEventListener('change', e => {
    if (!e.target.matches('input')) return;
    set([...pop.querySelectorAll('input')].filter(cb => cb.checked).map(cb => cb.value));
    sync();
  });
  document.addEventListener('click', () => { pop.hidden = true; });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') pop.hidden = true; });
  sync();
  root._sync = sync; // 供切项目/页面恢复时回填按钮回显与勾选态（attachFilter 调用）
}

initMultiSelect($('#ms-priority'), {
  allLabel: '全部优先级',
  options: PRIORITIES.map(v => ({ v, l: v })),
  get: () => S.filter.priority,
  set: v => { S.filter.priority = v; saveFilters(); renderBoard(); }
});
initMultiSelect($('#ms-status'), {
  allLabel: '全部状态',
  // 「已完成」拆为三档提交态伪状态（#45）：匹配逻辑见 renderBoard（done-' + badge[0]）
  options: [
    { v: 'open', l: '仅待处理' },
    { v: 'todo', l: '待办' },
    { v: 'doing', l: '进行中' },
    { v: 'done-uncommitted', l: '已完成·未提交', pl: '已完成', ico: 'uncommitted', tip: '未提交' },
    { v: 'done-committed', l: '已完成·已提交', pl: '已完成', ico: 'committed', tip: '已提交' },
    { v: 'done-pushed', l: '已完成·已推送', pl: '已完成', ico: 'pushed', tip: '已推送' },
    { v: 'removed', l: '已移除' }
  ],
  get: () => S.filter.status,
  set: v => { S.filter.status = v; saveFilters(); renderBoard(); }
});

// 已完成行降权（#42）：仅「已推送」行进入紧凑展示态（控件 pointer-events 已关闭），
// 桌面 hover 即恢复完整展示态；触屏无 hover，点行临时展开。展开为临时态（#46 修订）：
// 鼠标离行或点击行外即自动收起，不再锁定——避免误点后行卡在展开态
$('#items-body').addEventListener('click', e => {
  // 组头点击 = 折叠/展开该段（#55），与行编辑逻辑互斥（组头不是数据行）
  const gh = e.target.closest('tr.done-ghead');
  if (gh) {
    const seg = Number(gh.dataset.seg);
    const key = 'bdesk-done-fold:' + S.active;
    let ex = [];
    try { ex = JSON.parse(localStorage.getItem(key) || '[]'); } catch (_) {}
    ex = ex.includes(seg) ? ex.filter(x => x !== seg) : ex.concat(seg);
    localStorage.setItem(key, JSON.stringify(ex));
    renderBoard();
    return;
  }
  const tr = e.target.closest('tr.s-done.b-pushed');
  if (!tr || e.target.closest('select, input, button')) return;
  tr.classList.toggle('edit');
});
document.addEventListener('click', e => {
  if (e.target.closest('tr.s-done.b-pushed')) return;
  document.querySelectorAll('#items-body tr.s-done.b-pushed.edit')
    .forEach(tr => tr.classList.remove('edit'));
});
$('#items-body').addEventListener('mouseout', e => {
  const tr = e.target.closest('tr.s-done.b-pushed.edit');
  if (tr && !tr.contains(e.relatedTarget)) tr.classList.remove('edit');
});

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
$('#btn-project').addEventListener('click', () => openProjectsForm(null, true));
$('#btn-agent').addEventListener('click', openAgentForm);
$('#btn-track').addEventListener('click', openTrackForm);
$('#btn-theme').addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  localStorage.setItem('pbw-theme', next);
});
$('#drawer').addEventListener('click', async e => {
  if (e.target.closest('[data-close]')) return closeDrawer();
  // 卡片头部的「保存」：只提交该卡片的修改，抽屉保持打开
  const sv = e.target.closest('[data-save-agent]');
  if (sv) {
    const card = sv.closest('.agent-card');
    const key = card.dataset.key;
    const get = n => (card.querySelector(`[data-f="${n}"]`)?.value || '').trim();
    const agents = { ...S.config.agents };
    agents[key] = {
      ...(S.config.agents[key] || {}),
      label: get('label') || key,
      memoryDir: get('memoryDir'),
      backlogFile: get('backlogFile'),
      contextFiles: get('contextFiles').split(',').map(s => s.trim()).filter(Boolean),
      syncFile: get('syncFile'),
      dailyPattern: get('dailyPattern'),
      dailyFile: get('dailyFile'),
      skillDir: get('skillDir')
    };
    saveConfig({ ...S.config, agents }, `适配器「${agents[key].label || key}」已保存`, true);
    return;
  }
  // 项目卡片「保存」：只提交该卡片的修改，抽屉保持打开；新卡保存成功后重渲染为已保存态
  const sp = e.target.closest('[data-save-project]');
  if (sp) {
    const card = sp.closest('.agent-card');
    const oldId = card.dataset.id;
    const get = n => (card.querySelector(`[data-f="${n}"]`)?.value || '').trim();
    const obj = {
      id: oldId || get('id'),
      name: get('name'),
      projectRoot: get('projectRoot'),
      memoryRoot: get('memoryRoot'),
      agent: card.querySelector('[data-f="agent"]')?.value || ''
    };
    if (!/^[a-zA-Z0-9_-]+$/.test(obj.id)) { toast('项目 ID 为空或格式不符（仅限字母数字-_）', 'err'); return; }
    if (!obj.name || !obj.projectRoot || !obj.memoryRoot) { toast('显示名称与两个路径均为必填', 'err'); return; }
    if (!S.config.agents[obj.agent]) { toast('Agent 适配器不存在', 'err'); return; }
    if (S.config.projects.some(p => p.id === obj.id && p.id !== oldId)) { toast('项目 ID 已存在', 'err'); return; }
    const projects = oldId
      ? S.config.projects.map(p => p.id === oldId ? { ...p, ...obj } : p)
      : [...S.config.projects, obj];
    const ok = await saveConfig({ ...S.config, projects }, `项目「${obj.name}」已保存`, true);
    if (ok) openProjectsForm(obj.id);
    return;
  }
  // 项目卡片「×」：从配置删除该项目（只移除配置，不动记忆文件）
  const dp = e.target.closest('[data-del-project]');
  if (dp) {
    const id = dp.dataset.delProject;
    if (!confirm(`删除项目「${id}」？\n只移除工作台配置，不删除任何记忆文件。`)) return;
    await saveConfig({ ...S.config, projects: S.config.projects.filter(p => p.id !== id) }, '项目已移除', true);
    openProjectsForm();
    return;
  }
  const del = e.target.closest('[data-del-agent]');
  if (del) {
    const key = del.dataset.delAgent;
    // 未保存的新增卡（data-key 不在已保存配置里）：纯 DOM 元素，直接移除，不走适配器校验
    if (!S.config.agents[key]) {
      del.closest('.agent-card').remove();
      return;
    }
    if (S.config.projects.some(p => p.agent === key)) {
      toast('仍有项目在使用该适配器，不能删除', 'err');
      return;
    }
    if (Object.keys(S.config.agents).length <= 1) {
      toast('最后一个适配器不允许删除', 'err');
      return;
    }
    if (!confirm(`删除适配器「${key}」？\n仅移除工作台配置，不影响任何项目记忆文件。`)) return;
    const agents = { ...S.config.agents };
    delete agents[key];
    await saveConfig({ ...S.config, agents }, `适配器「${S.config.agents[key].label || key}」已删除`, true);
    del.closest('.agent-card').remove();
    return;
  }
  // 点击适配器头部空白处切换收起/展开（按钮分支已在上方各自 return）
  const head = e.target.closest('.agent-head');
  if (head) head.closest('.agent-card').classList.toggle('collapsed');
});

document.documentElement.dataset.theme = localStorage.getItem('pbw-theme') || 'light';

// 顶栏自适应（#34）：JS 精确分配空间。flex 换行决策在收缩之前（收缩救不了断行），
// 且 order 会同时改变视觉序（徽标会被排到按钮右侧），故用计算代替 CSS 贪装：
// 优先单行——副标题按需 ellipsis 截断（下限 SUB_MIN，不硬隐藏）；单行实在塞不下时
// 才给 topbar 挂 .stats-drop 让徽标组整体退第二行居中（第一行 brand+演示/重置+按钮贴右）。
// 徽标视觉序始终保持在按钮左侧（不改动 DOM/order 的默认形态）。
(function () {
  const topbar = document.querySelector('.topbar');
  if (!topbar) return;
  const sub = topbar.querySelector('.brand .sub');
  const stats = topbar.querySelector('.stats');
  const brand = topbar.querySelector('.brand');
  const actions = topbar.querySelector('.top-actions');
  const SUB_MIN = 120; // 副标题可截断下限（px）：低于此不如让徽标退行
  function syncTopbar() {
    if (!sub || !stats) return;
    sub.style.maxWidth = '';
    topbar.classList.remove('stats-drop');
    topbar.classList.remove('actions-wrap');
    if (getComputedStyle(sub).display === 'none') return; // ≤760 手机版式不参与
    const cs = getComputedStyle(topbar);
    const avail = topbar.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const gap = parseFloat(cs.columnGap) || 0;
    const kids = [...topbar.children].filter(el => getComputedStyle(el).display !== 'none');
    const widths = kids.map(el => el.getBoundingClientRect().width);
    const subW = sub.getBoundingClientRect().width;
    const sumNoSub = widths.reduce((s, w) => s + w, 0) - subW;
    const gaps = gap * (kids.length - 1);
    if (sumNoSub + subW + gaps <= avail) return;            // 全量单行，副标题全显
    const slack = avail - sumNoSub - gaps;
    if (slack >= SUB_MIN) {                                  // 单行但需截断副标题
      sub.style.maxWidth = slack + 'px';
      return;
    }
    // 单行塞不下：徽标组退二行，但需保证第一行（其余子项、副标题全显）自身装得下，否则维持自然换行
    const si = kids.indexOf(stats);
    if (si < 0) return;
    const firstRow = widths.reduce((s, w, i) => s + (i === si ? 0 : w), 0) + gap * (kids.length - 2);
    if (firstRow <= avail) topbar.classList.add('stats-drop');
    // 按钮组换到第二行时挂 .actions-wrap：按钮组拉伸铺满第二行剩余宽度（垂直中心差判同行，
    // align-items:center 下同行元素 top 不同不能直接比）
    if (actions && brand) {
      const a = actions.getBoundingClientRect(), b = brand.getBoundingClientRect();
      const wrapped = Math.abs((a.top + a.height / 2) - (b.top + b.height / 2)) > 16;
      topbar.classList.toggle('actions-wrap', wrapped);
    }
  }
  window.__syncTopbar = syncTopbar; // 徽标数据渲染后需重算（首测时 stats 为空宽度失真）
  syncTopbar();
  window.addEventListener('resize', syncTopbar);
  window.addEventListener('load', syncTopbar); // 后到元素兜底
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(syncTopbar);
})();

loadState().then(() => { connectEvents(); startPulse(); window.__syncTopbar && window.__syncTopbar(); }).catch(e => toast('加载失败：' + e.message, 'err'));
