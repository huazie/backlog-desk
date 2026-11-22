#!/usr/bin/env node
'use strict';

// bdesk —— 改造清单台 · Backlog Desk 命令行入口
// 用法：bdesk <start|init|doctor|demo|skill> [选项]

const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');
const pkg = require('../package.json');
const srv = require('../server.js');

const args = process.argv.slice(2);

// skill 安装的 agent 元数据改为 config 驱动（单一权威源）：以包内置 config/default.json 的 agents
// 为基础，合并用户态配置的 agents（同名适配器逐字段浅合并、用户优先）；适配器声明 skillDir
//（技能根目录名）即可 bdesk skill --agent <名字> 安装。必须声明在顶部 -h 快路径之前，usage() 的
// 动态 agent 列表依赖它
function skillAgents() {
  let agents;
  try {
    agents = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'default.json'), 'utf8')).agents || {};
  } catch (e) {
    return {};
  }
  try {
    const user = srv.loadConfig().agents || {};
    for (const [k, v] of Object.entries(user)) agents[k] = { ...agents[k], ...v };
  } catch (e) { /* 用户配置缺失或损坏时仅用内置适配器 */ }
  return agents;
}

const cmd = args[0] && !args[0].startsWith('-') ? args[0] : 'start';
const opt = name => {
  const i = args.indexOf(name);
  return i === -1 ? null : args[i + 1];
};

if (args.includes('--version') || args.includes('-v')) {
  console.log(`backlog-desk v${pkg.version}`);
  process.exit(0);
}

if (args.includes('--help') || args.includes('-h')) {
  usage();
  process.exit(0);
}

function optsFromArgs() {
  const o = {};
  const port = opt('--port');
  if (port) o.port = Number(port);
  const host = opt('--host');
  if (host) o.host = host;
  const config = opt('--config');
  if (config) o.config = config;
  const dataDir = opt('--data-dir');
  if (dataDir) o.dataDir = dataDir;
  return o;
}

function cmdInit() {
  srv._ctx.dataDir = path.resolve(opt('--data-dir') || process.env.BACKLOG_HOME ||
    path.join(os.homedir(), '.backlog-desk'));
  const file = path.join(srv._ctx.dataDir, 'config.json');
  const from = opt('--from');
  let cfg;
  if (from) {
    cfg = JSON.parse(fs.readFileSync(path.resolve(from), 'utf8'));
    // 导入时把相对项目路径按当前目录解析成绝对，用户态配置不依赖启动 bdesk 时的 cwd
    for (const p of cfg.projects || []) {
      for (const k of ['projectRoot', 'memoryRoot']) {
        const v = String(p[k] == null ? '' : p[k]);
        if (v && !v.startsWith('~') && !path.isAbsolute(v) && !path.win32.isAbsolute(v)) {
          p[k] = path.resolve(v);
        }
      }
    }
    srv.validateConfig(cfg);
  } else {
    cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'default.json'), 'utf8'));
  }
  if (fs.existsSync(file) && !args.includes('--force')) {
    console.log(`已存在 ${file}，未覆盖（加 --force 可覆盖）`);
    return;
  }
  fs.mkdirSync(srv._ctx.dataDir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
  console.log(`已生成 ${file}`);
  console.log('下一步：bdesk start 后在页面「添加项目」中登记项目；或直接编辑该文件的 projects 数组。');
}

function portFree(port) {
  return new Promise(resolve => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.once('listening', () => s.close(() => resolve(true)));
    s.listen(port, '127.0.0.1');
  });
}

async function cmdDoctor() {
  srv.resolvePaths(optsFromArgs());
  let cfg;
  try {
    cfg = srv.loadConfig();
    srv.validateConfig(cfg);
  } catch (e) {
    console.log(`配置异常：${e.message}（配置文件：${srv._ctx.configFile}）`);
    process.exitCode = 1;
    return;
  }
  console.log(`配置文件：${srv._ctx.configFile}`);
  let bad = 0;
  for (const p of cfg.projects) {
    const memDir = path.resolve(srv.expandHome(p.memoryRoot), cfg.agents[p.agent].memoryDir);
    const backlog = path.join(memDir, cfg.agents[p.agent].backlogFile);
    const items = [
      ['代码根', fs.existsSync(srv.expandHome(p.projectRoot))],
      ['记忆根', fs.existsSync(srv.expandHome(p.memoryRoot))],
      ['记忆目录', fs.existsSync(memDir)],
      ['清单文件', fs.existsSync(backlog)]
    ];
    const miss = items.filter(x => !x[1]).map(x => x[0]);
    console.log(`${miss.length ? '✗' : '✓'} ${p.id}${miss.length ? '  缺失：' + miss.join('、') : ''}`);
    if (miss.length) bad++;
  }
  const port = Number(cfg.port) || 8787;
  const free = await portFree(port);
  console.log(`${free ? '✓' : '✗'} 端口 ${port} ${free ? '空闲' : '被占用（服务可能已在运行）'}`);
  console.log(bad ? `结果：${bad} 个项目存在缺失路径` : '结果：全部项目路径健康');
  if (bad) process.exitCode = 1;
}

function cmdDemo() {
  const demoDir = path.join(__dirname, '..', 'demo');
  const dataDir = path.join(os.tmpdir(), 'backlog-desk-demo');
  fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  fs.mkdirSync(dataDir, { recursive: true });
  // 示例复制到数据目录后再校准：包内 demo/ 始终只读，运行态只写临时副本
  const demoRoot = path.join(dataDir, 'projects');
  fs.cpSync(path.join(demoDir, 'projects'), demoRoot, { recursive: true });
  // 在对象上替换占位符再交给 JSON.stringify：路径里的 $& / 引号 / 反斜杠都不会破坏配置
  const expandDemo = v => {
    if (typeof v === 'string') return v.split('{{DEMO}}').join(demoRoot.replace(/\\/g, '/'));
    if (Array.isArray(v)) return v.map(expandDemo);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, expandDemo(x)]));
    return v;
  };
  const tpl = expandDemo(JSON.parse(fs.readFileSync(path.join(demoDir, 'config.json'), 'utf8')));
  fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify(tpl, null, 2) + '\n', 'utf8');
  const port = Number(opt('--port')) || 8788;
  srv.start({ dataDir, port });
  console.log('演示模式：示例项目已复制到临时目录，不读写包内 demo/ 与任何真实项目记忆。');
  // 示例镜像为静态占位，启动后自动按唯一权威源校准一次，让看板开箱即「一致」
  setTimeout(async () => {
    for (const id of (tpl.projects || []).map(p => p.id)) {
      try { await fetch(`http://127.0.0.1:${port}/api/sync/${id}`, { method: 'POST' }); } catch (_) { /* 服务未就绪则下次手动同步 */ }
    }
  }, 800);
}

function cmdSkill() {
  const agent = opt('--agent') || 'workbuddy';
  const agents = skillAgents();
  const agentDir = agents[agent];
  if (!agentDir) {
    console.error(`暂不支持的 agent：${agent}（当前支持：${Object.keys(agents).join(' / ')}）`);
    process.exitCode = 1;
    return;
  }
  if (!agentDir.skillDir) {
    console.error(`适配器 ${agent} 未声明 skillDir（技能根目录名，如 .claude），暂不支持 skill 安装`);
    process.exitCode = 1;
    return;
  }
  // 模板分层：根目录 skill/SKILL.md 是通用模板（所有 agent 共用）；
  // skill/<agent>/SKILL.md 是该 agent 的定制版，存在则整份覆盖，没有就回落通用版
  const agentTpl = path.join(__dirname, '..', 'skill', agent, 'SKILL.md');
  const src = fs.existsSync(agentTpl)
    ? agentTpl
    : path.join(__dirname, '..', 'skill', 'SKILL.md');
  if (!fs.existsSync(src)) {
    console.error(`缺少 skill 模板：${src}（安装包可能不完整，请重装 backlog-desk）`);
    process.exitCode = 1;
    return;
  }
  // 默认装当前项目（项目级技能目录），--global 装用户级，--dir 供自定义 / 测试；
  // cwd 是主目录时「项目级」路径恰好与用户级重合——显式按用户级处理并如实提示，不靠巧合
  const atHome = process.cwd() === os.homedir();
  const asGlobal = args.includes('--global') || (!opt('--dir') && atHome);
  const base = asGlobal
    ? path.join(os.homedir(), agentDir.skillDir, 'skills')
    : path.resolve(opt('--dir') || path.join(process.cwd(), agentDir.skillDir, 'skills'));
  const skillRoot = path.join(base, 'bdesk-collab');
  // --uninstall 卸载：只删 bdesk-collab 目录本身，不碰技能根目录下的其他技能
  if (args.includes('--uninstall')) {
    if (!fs.existsSync(skillRoot)) {
      console.log(`未安装 ${agent} 的 bdesk-collab skill：${skillRoot}`);
      return;
    }
    fs.rmSync(skillRoot, { recursive: true, force: true });
    console.log(`已卸载 ${agent} 的 bdesk-collab skill：${skillRoot}`);
    return;
  }
  const dest = path.join(skillRoot, 'SKILL.md');
  if (fs.existsSync(dest) && !args.includes('--force')) {
    console.log(`已存在 ${dest}，未覆盖（加 --force 可覆盖）`);
    return;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  // 占位符按 agent 注入：通用模板 skill/SKILL.md 不写死任何 agent 的路径；
  // split/join 而非正则 replace，路径含 $& 等字符也不会被误展开。
  // 注入文本取适配器的 memoryHint（说明文本，用于记忆路径不固定的适配器），否则用 memoryDir
  const memDirText = agentDir.memoryHint || agentDir.memoryDir
    || '由项目配置的 memoryRoot 指定（该适配器无固定记忆目录）';
  const text = fs.readFileSync(src, 'utf8')
    .split('{{AGENT}}').join(agent)
    .split('{{SKILLS_DIR}}').join(`${agentDir.skillDir}/skills`)
    .split('{{HOME_SKILLS_DIR}}').join(`~/${agentDir.skillDir}/skills`)
    .split('{{MEMORY_DIR}}').join(memDirText);
  fs.writeFileSync(dest, text, 'utf8');
  console.log(`已安装 ${agent} 的 bdesk-collab skill：${dest}`);
  console.log(asGlobal
    ? (args.includes('--global')
      ? '生效范围：用户级技能目录，对该 agent 的所有项目生效。'
      : '生效范围：用户级技能目录，对该 agent 的所有项目生效（当前目录即主目录，默认项目级落点与其重合，建议显式加 --global）。')
    : opt('--dir')
      ? '生效范围：指定的安装目录（--dir）。'
      : `生效范围：当前项目的项目级技能目录（${agentDir.skillDir}/skills/）。`);
}

function usage() {
  console.log(`backlog-desk v${pkg.version} —— 改造清单台

用法：
  bdesk [start] [选项]     启动看板（默认命令；127.0.0.1:8787，Ctrl+C 停止）
  bdesk init [选项]        生成用户态配置 ~/.backlog-desk/config.json，已存在则不覆盖
  bdesk doctor [选项]      体检：项目路径、清单文件、配置端口占用
  bdesk demo [选项]        脱敏示例复制到临时目录启动（8788，包目录只读，不碰真实记忆）
  bdesk skill [选项]       按 agent 安装「改造清单协作约定」skill（支持：${Object.keys(skillAgents()).join(' / ')}）；更新用户级副本推荐 bdesk skill --force --global；--uninstall 卸载
  bdesk help               显示本帮助（等价 -h / --help）
  bdesk --version | -v     显示版本号

选项（按命令标注生效范围）：
  --port N         start / demo：服务端口（默认 8787 / demo 8788）
  --host H         start：绑定地址（默认 127.0.0.1）
  --config FILE    start / doctor：指定配置文件
  --data-dir DIR   start / init / doctor：指定数据目录
  --from FILE      init：从既有配置导入（相对路径展开为绝对）
  --agent NAME     skill：目标 agent（默认 workbuddy；当前支持：${Object.keys(skillAgents()).join(' / ')}）
  --global         skill：安装到用户级技能目录（默认当前项目；主目录下默认落点与其重合，自动按用户级处理）
  --dir DIR        skill：指定安装根目录（默认当前项目技能目录）
  --uninstall      skill：卸载已安装的 bdesk-collab skill（用 --agent / --global / --dir 定位）
  --force          init / skill：覆盖已存在的配置 / skill 文件
  --help | -h      显示本帮助
  --version | -v   显示版本号

环境变量：
  PORT             start 的端口；端口取自 PORT 且未传 --host 时默认绑定 0.0.0.0
  BACKLOG_HOME     start / init / doctor 的数据目录，默认 ~/.backlog-desk

说明：
  不带参数或只带选项（--help / -h / --version / -v 除外）时默认执行 start，
  例如 bdesk --port 9000。start 端口优先级：--port > PORT > 配置 port > 8787。
  未知命令同样打印本帮助，但退出码为 1。`);
}

switch (cmd) {
  case 'start': srv.start(optsFromArgs()); break;
  case 'init': cmdInit(); break;
  case 'doctor': cmdDoctor(); break;
  case 'demo': cmdDemo(); break;
  case 'skill': cmdSkill(); break;
  default: usage(); process.exitCode = cmd === 'help' ? 0 : 1;
}
