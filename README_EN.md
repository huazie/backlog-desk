# Backlog Desk

[![NPM Publish](https://github.com/huazie/backlog-desk/actions/workflows/publish.yml/badge.svg)](https://github.com/huazie/backlog-desk/actions/workflows/publish.yml) [![npm version](https://img.shields.io/npm/v/backlog-desk.svg?style=flat&logo=npm)](https://www.npmjs.com/package/backlog-desk) [![Node version](https://img.shields.io/badge/node-%3E%3D18-green?style=flat&logo=node.js)](https://nodejs.org/) [![license](https://img.shields.io/badge/license-MIT-orange)](https://github.com/huazie/backlog-desk/blob/main/LICENSE) [![GitHub Repo stars](https://img.shields.io/github/stars/huazie/backlog-desk?style=flat)](https://github.com/huazie/backlog-desk/stargazers)

A zero-dependency local workbench that reads the backlog files in each project's Agent memory directory and tracks improvement progress automatically in both directions.

[中文说明/Chinese Documentation](README.md)

## Quick Start

```bash
# Option 1: run directly with npx (available once published, no installation needed)
npx backlog-desk

# Option 2: install globally and use the bdesk command (starts with no arguments)
npm i -g backlog-desk
bdesk                 # equivalent to bdesk start
```

Open `http://127.0.0.1:8787` in your browser. By default it only listens on `127.0.0.1` and is never exposed externally; it stops when the terminal closes.

> If the package has not yet been published to npm, neither of the two options above is available: on this machine use `npm start` from "Local Development", or run `npm link` at the repository root and then use `bdesk`.

For first use it is recommended to generate the user-level config first (defaults to `~/.backlog-desk/`); it also starts without it, but the project list will be empty:

```bash
bdesk init                         # generate an empty config template, then register projects in the "Add Project" page
bdesk init --from ./my-config.json # import from an existing config
bdesk doctor                       # health check: project paths, backlog files, config and port conflicts
bdesk demo                         # copy the sanitized example to a temp directory and start (8788); demo/ inside the package is read-only
bdesk skill                        # install the collaboration convention skill for the current project by agent (default workbuddy); Agent sessions load it automatically
```

## Commands

| Command | Description |
|---|---|
| `bdesk [start]` | Start the workbench (default command; `127.0.0.1:8787`, `Ctrl+C` to stop) |
| `bdesk init` | Generate user-level config; does not overwrite an existing one |
| `bdesk doctor` | Health check: project paths, backlog files, config and port conflicts |
| `bdesk demo` | Copy the sanitized example to a temp directory and start (8788, package directory read-only, real memories untouched) |
| `bdesk skill` | Install the "Backlog Collaboration Convention" skill by agent: default `--agent workbuddy`, installs to the current project's `.workbuddy/skills/bdesk-collab/`; `--global` installs to user level `~/.workbuddy/skills/`; `--force` overwrites (i.e. updates to the current template version); `--uninstall` removes it (located by `--agent` / `--global` / `--dir`, deletes only the `bdesk-collab` directory and leaves other skills untouched). Template layering: the generic `skill/SKILL.md` uses `{{AGENT}}` / `{{SKILLS_DIR}}` / `{{HOME_SKILLS_DIR}}` / `{{MEMORY_DIR}}` placeholders, injected with actual paths per agent at install time with the generic body unchanged; `skill/<agent>/SKILL.md` is an optional per-agent customized override |
| `bdesk help` | Show full help (equivalent to `-h` / `--help`) |
| `bdesk --version` | Show version (equivalent to `-v`) |

> Adding support for a new agent: adapters are config-driven (single source of truth) — add an adapter with a `skillDir` field (skills root dir name, e.g. `.claude`) via the "Agent Config" drawer or the `agents` section of `config`, and `bdesk skill --agent <name>` works right away (template paths and memory notes are injected automatically via `skillDir` / `memoryHint` / `memoryDir` placeholders with the generic body untouched; create `skill/<agent>/SKILL.md` to override the whole body for a specific agent). Same-name adapters in the user-level config override the built-in ones field by field.

## Common Options

| Option | Description |
|---|---|
| `--port N` | Port for `start` / `demo` (default 8787 / demo 8788; precedence `--port` > `PORT` > config `port`) |
| `--host H` | Bind address for `start` (default `127.0.0.1`; when the port comes from `PORT` and `--host` is not passed, defaults to `0.0.0.0`) |
| `--config FILE` | Specify the config file (`start` / `doctor`) |
| `--data-dir DIR` | Specify the data directory (`start` / `init` / `doctor`; defaults to `~/.backlog-desk/`, also settable via the `BACKLOG_HOME` env var) |
| `--from FILE` | `init`: import from an existing config (relative project paths are expanded to absolute paths based on the current directory) |
| `--force` | `init`: overwrite an existing config |
| `--help` / `-h` | Show full help |
| `--version` / `-v` | Show version |

Environment variables: `PORT` sets the `start` port (only when the port is actually taken from `PORT` and `--host` is not passed does it default to binding `0.0.0.0`; an explicit `--port` still listens on loopback only), and `BACKLOG_HOME` sets the data directory; precedence and defaults are shown in the table above.

> Omitting `start` also works: `bdesk` (no arguments) and `bdesk --port 9000` (options only) are both equivalent to `bdesk start`, except for `--help` / `-h` / `--version` / `-v`. Unknown commands also print help, but exit with code 1.

The full command-line reference is always available via `bdesk help`.

## Data & Privacy

- **The single source of truth is always each project's own memory files** (the marked block in `改造清单.md`); nothing is copied or stored centrally.
- A globally installed `bdesk` never writes to the package directory: runtime artifacts (config copies, `history.jsonl`, pre-write backups) all land in `~/.backlog-desk/`; `npm start` dev mode writes to the repository root instead; `bdesk demo` copies the example into the system temp directory before calibrating, likewise never writing to the package directory.
- `demo/` inside the package is a sanitized fictional example for demonstration only; the npm package contains no real project memories.

## Backlog File Format

The workbench reads and writes only the marked block of `改造清单.md` in each project's memory directory; content outside the block is preserved as-is:

```markdown
<!-- backlog:begin -->
| id | priority | status | title | note | updated |
| --- | --- | --- | --- | --- | --- |
| 1 | P1 | todo | Example item | Notes | 2026-11-09 |
<!-- backlog:end -->
```

`priority` = `P0`~`P3`; `status` = `todo` / `doing` / `done` / `removed`; `updated` is `YYYY-MM-DD`. Page changes are written back to the file immediately, with a status mirror maintained in `MEMORY.md` and decision notes appended to the daily log.

## Cross-Platform

Supports Windows / Linux / macOS with Node ≥ 18; CI runs the same 95 regression checks on 3 systems × 4 Node versions (18 / 20 / 22 / 24).

- Paths consistently use `path.join` / `path.resolve`; `~/` expansion detects the separator per platform, and absolute paths in configs are validated in both POSIX and Windows forms.
- When writing memory files back, the **original file's CRLF / LF style is preserved** — a Windows CRLF backlog is never converted into mixed line endings; content outside the block is preserved byte for byte.
- File watchers are registered per directory without `recursive`, avoiding `ERR_FEATURE_UNAVAILABLE_ON_PLATFORM` on Linux; temp directory deletion includes retries for Windows file handles.
- Repository text is normalized to LF by `.gitattributes` to keep shebangs from being written as CRLF; `bdesk demo` copies its example to the system temp directory before calibrating, and `demo/` inside the package stays read-only.

## Local Development

```bash
cd <this repository root>
npm start            # dev mode: data directory = repo root, config read from config/workbench.json
BACKLOG_HOME=. npm start   # equivalent, with the data directory set explicitly
```

`config/workbench.json` is machine-private config (git-ignored, not shipped in the npm package); write project paths relative to the repo root as `../project-name` and the server resolves them against the package directory regardless of the working directory at startup; on a new machine just keep the sibling directory structure — no drive letters to change. When importing with `bdesk init --from`, relative paths are expanded to absolute paths, so the user-level config does not depend on the directory you start `bdesk` from.

Verification (recommended: one command, no server needed in advance):

```bash
npm test
```

`npm test` creates two sanitized fixture projects in the system temp directory, starts an isolated service, runs the three regression suites in order (19 + 39 + 37 checks), then shuts the service down and deletes the temp directory — no real project memories are read or written.

Local verification against real projects (requires `npm start` first; temporarily modifies the project list registered in `config/workbench.json` and restores it from a snapshot afterwards):

```bash
npm run test:local         # equivalent to running tests/smoke.js, sync-check.js and track-check.js in order
```

All three scripts automatically restore the config, `history.jsonl` and temp directories afterwards, leaving no verification traces.

## Features

| Feature | How to use |
|---|---|
| Switch project | Click in the left project bar; double-click a project card to edit |
| Add project | "Add Project" at the top, fill in `projectRoot` / `memoryRoot` / Agent adapter (supports `~/` paths) |
| Configure other agents | "Agent Config" at the top → "Add Adapter" at the drawer's top-right; each adapter card is edited independently, the header "Save" commits only that card and keeps the drawer open; click a card header to collapse/expand; deleting a card "×" asks for confirmation (not allowed when the adapter is used by a project or is the last one) → fill in `memoryDir` / `backlogFile` / `contextFiles` / `syncFile` / `dailyFile` / `skillDir` (skills root dir name; when set, `bdesk skill --agent <name>` can install, empty = not supported), then select it in a project |
| Add backlog item | Fill in title, priority and notes above the table → "Add" |
| Change priority / status / text | Use dropdowns or inputs in the table; saved and written back on blur |
| Remove backlog item | "Remove" = mark `removed` and keep the decision record; "×" = delete permanently (double confirmation, with pre-write backup) |
| Filter | Search box + priority + status dropdowns |
| Memory quick view | The right side shows the full `MEMORY.md`, recent log titles and the log tail; the "Sync" button calibrates once against the current backlog |
| Auto refresh | File changes in the memory directory refresh the workbench automatically (SSE main channel + 10s polling fallback); typing in the table is never interrupted |
| Drift indicator | A banner above the table shows "backlog and mirror consistent / needs calibration / no baseline", with one-click calibration |
| Pending task cards | Generated when an item is added or moves to "in progress"; click "Copy Instructions" and paste into an Agent session, "Done" closes the card |
| Tracking settings | "Tracking" at the top → three switches plus the current number of watched directories and alerts |
