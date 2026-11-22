// 由 scripts/gen-demo-data.js 自动生成（源：demo/ 脱敏示例，只读）；手工修改会被下次生成覆盖。
window.DEMO_DATA = {
  "generatedAt": "2026-11-22T17:36:50.470Z",
  "dataVersion": "1fyg59i",
  "config": {
    "port": 8788,
    "syncToMemory": true,
    "autoWatch": true,
    "autoCalibrate": true,
    "autoTask": true,
    "agents": {
      "workbuddy": {
        "label": "WorkBuddy",
        "memoryDir": ".workbuddy/memory",
        "skillDir": ".workbuddy",
        "backlogFile": "改造清单.md",
        "contextFiles": [
          "MEMORY.md"
        ],
        "syncFile": "MEMORY.md",
        "dailyPattern": "^\\d{4}-\\d{2}-\\d{2}\\.md$",
        "dailyFile": "{date}.md",
        "dispatchCommand": ""
      }
    },
    "projects": [
      {
        "id": "sample-web",
        "name": "sample-web 示例站点",
        "projectRoot": "demo/projects/sample-web",
        "memoryRoot": "demo/projects/sample-web",
        "agent": "workbuddy"
      },
      {
        "id": "sample-cli",
        "name": "sample-cli 示例工具",
        "projectRoot": "demo/projects/sample-cli",
        "memoryRoot": "demo/projects/sample-cli",
        "agent": "workbuddy"
      }
    ]
  },
  "projects": {
    "sample-web": {
      "mtime": 1762600001000,
      "items": [
        {
          "id": "1",
          "priority": "P0",
          "status": "doing",
          "title": "首页首屏加载优化（示例数据）",
          "note": "拆分关键 CSS，图片懒加载",
          "updated": "2026-11-08"
        },
        {
          "id": "2",
          "priority": "P1",
          "status": "todo",
          "title": "搜索框水平居中与响应式适配",
          "note": "覆盖 375px ~ 1440px",
          "updated": "2026-11-07"
        },
        {
          "id": "3",
          "priority": "P2",
          "status": "todo",
          "title": "深浅色主题变量统一",
          "note": "硬编码颜色迁入 var()",
          "updated": "2026-11-06"
        },
        {
          "id": "4",
          "priority": "P1",
          "status": "done",
          "title": "详情页 meta 条重构",
          "note": "commit a1b2c3d 已推送（v0.4.0 发布）",
          "updated": "2026-11-05"
        },
        {
          "id": "5",
          "priority": "P3",
          "status": "todo",
          "title": "站点地图自动生成",
          "note": "构建期产出 sitemap.xml",
          "updated": "2026-11-04"
        },
        {
          "id": "6",
          "priority": "P2",
          "status": "removed",
          "title": "弹窗组件自研",
          "note": "评估后决定沿用社区方案",
          "updated": "2026-11-03"
        }
      ],
      "lastSync": "2026-11-09 10:00",
      "fingerprint": "0000000000000000",
      "memory": {
        "memoryDir": "demo/projects/sample-web/.workbuddy/memory",
        "contextFiles": [
          {
            "name": "MEMORY.md",
            "content": "# 项目长期笔记（sample-web 示例站点）\r\n\r\n## 改造清单决策\r\n\r\n- 2026-11-08：#1 首屏优化转入进行中，先做关键 CSS 拆分。\r\n- 2026-11-03：#6 弹窗组件自研方案评估后放弃，标记已移除保留决策留痕。\r\n\r\n## 其它\r\n\r\n- 本文件为 demo 演示数据，历史条目中的优先级与状态仅作留痕。\r\n\r\n<!-- backlog-sync:begin -->\r\n## 改造清单 · 当前状态镜像（工作台自动维护）\r\n\r\n> 最后同步：2026-11-09 10:00 ｜ 唯一权威源：同目录 `改造清单.md` 的 `<!-- backlog:begin -->` / `<!-- backlog:end -->` 区块。\r\n> 汇总：共 6 项 ｜ 待办 3 ｜ 进行中 1 ｜ 已完成 1 ｜ 已移除 1。\r\n> 清单指纹：`0000000000000000`（工作台自动维护，用于检测外部改动后镜像是否滞后）。\r\n\r\n| # | 优先级 | 状态 | 改造项 |\r\n| --- | --- | --- | --- |\r\n| 1 | P0 | 进行中 | 首页首屏加载优化（示例数据） |\r\n| 2 | P1 | 待办 | 搜索框水平居中与响应式适配 |\r\n| 3 | P2 | 待办 | 深浅色主题变量统一 |\r\n| 4 | P1 | 已完成 | 详情页 meta 条重构 |\r\n| 5 | P3 | 待办 | 站点地图自动生成 |\r\n| 6 | P2 | 已移除 | 弹窗组件自研 |\r\n\r\n<!-- backlog-sync:end -->\r\n"
          }
        ],
        "dailyLogs": [
          {
            "name": "2026-11-09.md",
            "headings": [],
            "lines": 3,
            "tail": "# 2026-11-09\n- 演示数据：sample-web 当天日志示例行 A。\n- 演示数据：sample-web 当天日志示例行 B。"
          }
        ]
      }
    },
    "sample-cli": {
      "mtime": 1762600002000,
      "items": [
        {
          "id": "1",
          "priority": "P1",
          "status": "todo",
          "title": "输出格式支持 JSON（示例数据）",
          "note": "供 CI 管道消费",
          "updated": "2026-11-08"
        },
        {
          "id": "2",
          "priority": "P0",
          "status": "todo",
          "title": "修复 Windows 路径分隔符问题",
          "note": "反斜杠转义遗漏",
          "updated": "2026-11-07"
        },
        {
          "id": "3",
          "priority": "P2",
          "status": "done",
          "title": "帮助文案中英双语",
          "note": "commit e4f5a6b 已提交（待推送）",
          "updated": "2026-11-05"
        },
        {
          "id": "4",
          "priority": "P3",
          "status": "todo",
          "title": "补充CHANGELOG 生成脚本",
          "note": "从 commit 规范聚合",
          "updated": "2026-11-02"
        },
        {
          "id": "5",
          "priority": "P2",
          "status": "done",
          "title": "错误码统一编码（示例数据）",
          "note": "覆盖 CLI 全部退出路径，未提交",
          "updated": "2026-11-04"
        }
      ],
      "lastSync": "2026-11-09 10:00",
      "fingerprint": "0000000000000000",
      "memory": {
        "memoryDir": "demo/projects/sample-cli/.workbuddy/memory",
        "contextFiles": [
          {
            "name": "MEMORY.md",
            "content": "# 项目长期笔记（sample-cli 示例工具）\r\n\r\n## 改造清单决策\r\n\r\n- 2026-11-07：#2 Windows 路径问题升级为 P0，用户报告量增加。\r\n\r\n## 其它\r\n\r\n- 本文件为 demo 演示数据，历史条目中的优先级与状态仅作留痕。\r\n\r\n<!-- backlog-sync:begin -->\r\n## 改造清单 · 当前状态镜像（工作台自动维护）\r\n\r\n> 最后同步：2026-11-09 10:00 ｜ 唯一权威源：同目录 `改造清单.md` 的 `<!-- backlog:begin -->` / `<!-- backlog:end -->` 区块。\r\n> 汇总：共 5 项 ｜ 待办 2 ｜ 进行中 0 ｜ 已完成 2 ｜ 已移除 0。\r\n> 清单指纹：`0000000000000000`（工作台自动维护，用于检测外部改动后镜像是否滞后）。\r\n\r\n| # | 优先级 | 状态 | 改造项 |\r\n| --- | --- | --- | --- |\r\n| 1 | P1 | 待办 | 输出格式支持 JSON（示例数据） |\r\n| 2 | P0 | 待办 | 修复 Windows 路径分隔符问题 |\r\n| 3 | P2 | 已完成 | 帮助文案中英双语 |\r\n| 4 | P3 | 待办 | 补充CHANGELOG 生成脚本 |\r\n| 5 | P2 | 已完成 | 错误码统一编码（示例数据） |\r\n\r\n<!-- backlog-sync:end -->\r\n"
          }
        ],
        "dailyLogs": [
          {
            "name": "2026-11-09.md",
            "headings": [],
            "lines": 2,
            "tail": "# 2026-11-09\n- 演示数据：sample-cli 当天日志示例行 A。"
          }
        ]
      }
    }
  },
  "tasks": []
};
