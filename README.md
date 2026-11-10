# Backlog Desk

[![NPM Publish](https://github.com/huazie/backlog-desk/actions/workflows/publish.yml/badge.svg)](https://github.com/huazie/backlog-desk/actions/workflows/publish.yml) [![npm version](https://img.shields.io/npm/v/backlog-desk.svg?style=flat&logo=npm)](https://www.npmjs.com/package/backlog-desk) [![Node version](https://img.shields.io/badge/node-%3E%3D18-green?style=flat&logo=node.js)](https://nodejs.org/) [![license](https://img.shields.io/badge/license-MIT-orange)](https://github.com/huazie/backlog-desk/blob/main/LICENSE) [![GitHub Repo stars](https://img.shields.io/github/stars/huazie/backlog-desk?style=flat)](https://github.com/huazie/backlog-desk/stargazers)

> 本地零依赖工作台，读取各项目 Agent 记忆目录下的改造清单，双向自动跟踪改造推进。

## 快速开始

```bash
# 方式一：npx 直接运行（发布后可用，无需安装）
npx backlog-desk

# 方式二：全局安装后使用 bdesk 命令（无参即可启动）
npm i -g backlog-desk
bdesk                 # 等价于 bdesk start
```

浏览器打开 `http://127.0.0.1:8787`。默认只监听 `127.0.0.1`，不对外暴露；关闭终端即停止。

> 包尚未发布到 npm 时，上述两种方式都不可用：本机请走「本机开发」的 `npm start`，或在仓库根执行 `npm link` 后用 `bdesk`。

首次使用建议先生成用户态配置（默认落 `~/.backlog-desk/`）；不生成也能启动，只是项目列表为空：

```bash
bdesk init                         # 生成空配置模板，之后在页面「添加项目」中登记项目
bdesk init --from ./我的配置.json   # 从既有配置导入
bdesk doctor                       # 体检：项目路径、清单文件、配置端口占用
bdesk demo                         # 示例复制到临时目录启动（8788），包内 demo/ 只读
bdesk skill                        # 按 agent（默认 workbuddy）安装协作约定 skill 到当前项目，Agent 会话自动加载
```

## 命令

| 命令 | 作用 |
|---|---|
| `bdesk [start]` | 启动看板（默认命令；`127.0.0.1:8787`，`Ctrl+C` 停止） |
| `bdesk init` | 生成用户态配置，已存在则不覆盖 |
| `bdesk doctor` | 体检：项目路径、清单文件、配置端口占用 |
| `bdesk demo` | 脱敏示例复制到临时目录启动（8788，包目录只读，不碰真实记忆） |
| `bdesk skill` | 按 agent 安装「改造清单协作约定」skill：默认 `--agent workbuddy`，装当前项目 `.workbuddy/skills/bdesk-collab/`；`--global` 装用户级 `~/.workbuddy/skills/`；`--force` 覆盖。模板分层：通用版 `skill/SKILL.md` 用 `{{AGENT}}` / `{{SKILLS_DIR}}` / `{{HOME_SKILLS_DIR}}` / `{{MEMORY_DIR}}` 占位符，安装时按 agent 注入实际路径；`skill/<agent>/SKILL.md` 为可选定制覆盖 |
| `bdesk help` | 显示完整帮助（等价 `-h` / `--help`） |
| `bdesk --version` | 显示版本号（等价 `-v`） |

> 新增 agent 支持：`bin/cli.js` 的 `SKILL_AGENT_DIR` 加一条映射 `{ dir: '<技能根目录名>', memoryDir: '<默认记忆目录>' }`，即可 `bdesk skill --agent <名字>`（模板路径由占位符自动注入，通用正文零改动；某 agent 需要定制正文时，新建 `skill/<agent>/SKILL.md` 整份覆盖）。

## 常用选项

| 选项 | 说明 |
|---|---|
| `--port N` | `start` / `demo` 的端口（默认 8787 / demo 8788；优先级 `--port` > `PORT` > 配置 `port`） |
| `--host H` | `start` 的绑定地址（默认 `127.0.0.1`；端口来自 `PORT` 且未传 `--host` 时默认 `0.0.0.0`） |
| `--config FILE` | 指定配置文件（`start` / `doctor`） |
| `--data-dir DIR` | 指定数据目录（`start` / `init` / `doctor`；默认 `~/.backlog-desk/`，也可用 `BACKLOG_HOME` 环境变量） |
| `--from FILE` | `init`：从既有配置导入（相对项目路径会按当前目录展开成绝对路径） |
| `--force` | `init`：覆盖已存在的配置 |
| `--help` / `-h` | 显示完整帮助 |
| `--version` / `-v` | 显示版本号 |

环境变量：`PORT` 指定 `start` 端口（仅当端口确实取自 `PORT`、且未传 `--host` 时默认绑定 `0.0.0.0`；显式 `--port` 仍只监听回环）、`BACKLOG_HOME` 指定数据目录；优先级与默认值见上表。

> 省略 `start` 也可以：`bdesk`（无参）与 `bdesk --port 9000`（仅带选项）都等价于 `bdesk start`，但 `--help` / `-h` / `--version` / `-v` 除外。未知命令也打印帮助，但退出码为 1。

命令行内随时查看完整说明：`bdesk help`。

## 数据与隐私

- **唯一权威源永远是各项目自己的记忆文件**（`改造清单.md` 标记区块），不复制、不集中存储。
- 全局安装的 `bdesk` 不写包目录：运行态产物（配置副本、`history.jsonl`、写前备份）统一落 `~/.backlog-desk/`；`npm start` 开发模式改落仓库根；`bdesk demo` 把示例复制进系统临时目录后再校准，同样不写包目录。
- 包内 `demo/` 为脱敏虚构示例，仅供演示；npm 发布包不含任何真实项目记忆。

## 清单文件格式

工作台只读写各项目记忆目录下 `改造清单.md` 的标记区块，区块外内容原样保留：

```markdown
<!-- backlog:begin -->
| id | priority | status | title | note | updated |
| --- | --- | --- | --- | --- | --- |
| 1 | P1 | todo | 示例条目 | 说明 | 2026-11-09 |
<!-- backlog:end -->
```

`priority` = `P0`~`P3`；`status` = `todo` / `doing` / `done` / `removed`；`updated` 为 `YYYY-MM-DD`。页面改动即时写回该文件，并在 `MEMORY.md` 维护状态镜像、当日日志追加决策留痕。

## 跨平台

支持 Windows / Linux / macOS，Node ≥ 18；CI 用 3 个系统 × 4 个 Node 版本（18 / 20 / 22 / 24）跑同一套 95 项回归。

- 路径统一走 `path.join` / `path.resolve`；`~/` 展开按当前平台判断分隔符，配置里的绝对路径按 POSIX 与 Windows 两种写法一并校验。
- 写回记忆文件时**沿用原文件的 CRLF / LF 风格**，不会把 Windows 的 CRLF 清单改成混合换行；区块外内容逐字节保留。
- 文件监听逐目录注册、不用 `recursive`，避免 Linux 抛 `ERR_FEATURE_UNAVAILABLE_ON_PLATFORM`；临时目录删除带重试，兼容 Windows 文件句柄。
- 仓库文本由 `.gitattributes` 统一为 LF，避免 shebang 被写成 CRLF；`bdesk demo` 的示例复制到系统临时目录后再校准，包内 `demo/` 只读。

## 本机开发

```bash
cd 本仓库根目录
npm start            # 开发模式：数据目录 = 仓库根，配置读 config/workbench.json
BACKLOG_HOME=. npm start   # 等价，显式指定数据目录
```

`config/workbench.json` 是本机私有配置（已忽略、不进 npm 包），项目路径写相对仓库根的 `../项目名` 即可，服务端会按包目录解析，不依赖启动时的工作目录；换机器只需保持兄弟目录结构，无需改盘符。`bdesk init --from` 导入时会把相对路径展开成绝对路径，用户态配置不依赖启动 `bdesk` 时的目录。

验证（推荐，一条命令，无需预先起服务）：

```bash
npm test
```

`npm test` 会在系统临时目录造两个脱敏 fixture 项目、自启隔离服务、依次跑三套回归（19 + 39 + 37 项），结束后关闭服务并删除临时目录，不读写任何真实项目记忆。

本机真实项目验收（需先 `npm start`，会临时改动 `config/workbench.json` 登记的项目清单并按快照还原）：

```bash
npm run test:local         # 等价于依次跑 tests/smoke.js、sync-check.js、track-check.js
```

三套脚本跑完都会自动还原配置、`history.jsonl` 与临时目录，不留验收痕迹。

## 功能

| 功能 | 操作 |
|---|---|
| 切换项目 | 左侧项目栏单击；双击项目卡片进入编辑 |
| 添加项目 | 顶部「添加项目」，填 `projectRoot` / `memoryRoot` / Agent 适配器（支持 `~/` 路径） |
| 配置其他 Agent | 顶部「Agent 配置」→ 抽屉右上角「新增适配器」；每个适配器卡片独立编辑，头部「保存」仅提交该卡片且抽屉保持打开，点卡片头部可收起/展开；删除卡片「×」二次确认（被项目占用或仅剩一个时不可删）→ 填 `memoryDir` / `backlogFile` / `contextFiles` / `syncFile` / `dailyFile`，再到项目里选它 |
| 新增改造项 | 表格上方填标题、优先级、说明 →「添加」 |
| 改优先级 / 状态 / 文案 | 表格内下拉或输入框，失焦即保存并写回 |
| 删除改造项 | 「移除」= 标记 `removed` 保留决策记录；「×」= 彻底删除（二次确认，有写前备份） |
| 筛选 | 搜索框 + 优先级 + 状态下拉 |
| 记忆速览 | 右侧展示 `MEMORY.md` 全文、近期日志标题与末尾内容；「同步」按钮按当前清单校准一次 |
| 自动感知 | 记忆目录文件变化自动刷新看板（SSE 主通道 + 10 秒轮询兜底）；正在表格输入时不会打断 |
| 漂移提示 | 表格上方提示条显示「清单与镜像一致 / 待校准 / 无基线」，可一键校准 |
| 待派发任务卡 | 新增或状态转「进行中」时生成；点「复制指令」粘贴到 Agent 会话，「完成」关闭任务卡 |
| 跟踪设置 | 顶部「跟踪」→ 三个开关 + 当前监听目录数与告警 |
