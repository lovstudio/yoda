# skillusage — CC/Codex 技能调用统计 CLI 解决方案

> Lovstudio.ai · 手工川工作室 · 2026-06-12 · v0.1

## 1. 结论摘要

1. **推荐新建独立开源 CLI `skillusage`**（npm 名实测可用），定位与 ccusage 互补——"ccusage 管钱，skillusage 管行为"；ccusage 16k stars 但完全不做 skill 维度，且 v20 核心已重写为 Rust，提 PR 路线不可行。
2. **技术路线照搬 ccusage 的成熟工程模式**：TypeScript + gunshi（CLI）+ tsdown（零运行时依赖 bundle）+ `node:readline` 流式 JSONL + valibot 容错校验，无需任何数据库——实测本机 CC 395MB + Codex 2GB 全量扫描 < 1 秒，每次实时重扫即可。
3. **统计口径双维度**：手动调用（CC `<command-name>` 斜杠 / Codex `$` 前缀）vs 自动调用（CC `Skill` tool_use + Read/Bash 命中 SKILL.md / Codex `<skill><name>` 注入），检测分类法借鉴 cskwork/skill-usage-stats。
4. 量级：MVP 约 3–4 人天，V1 再 2–3 人天；纯本地解析，零基础设施成本，无隐私外泄面。
5. 最大风险：CC/Codex transcript 是无契约的内部格式，版本升级可能 drift——用 valibot 宽松 schema + 未知行静默跳过 + CI 快照样本回归来对冲。

## 2. 需求理解与假设

- 目标用户：重度 Claude Code / Codex 用户，想知道自己写的几十个 skills 哪些真的在被用、用多频繁、在哪些项目里被用。
- 核心场景：`npx skillusage` 一条命令出 top 榜 + 30 天趋势；`--json` 供 Yoda 等下游程序消费。
- 关键约束：纯本地数据（`~/.claude`、`~/.codex`），不联网不上报；解析的是无文档保证的内部落盘格式。
- 本方案假设：单机单用户，不做多机合并；macOS/Linux 优先，Windows 路径兼容放 V2；已确认要区分手动/自动两口径。

## 3. 模块拆分

| 模块 | 目标 | 推荐路线 | 说明 |
|---|---|---|---|
| 数据源发现 | 定位 CC/Codex 落盘文件 | 自研（~50 行） | 路径固定，tinyglobby 扫 glob |
| JSONL 流式解析 | 大文件低内存逐行读 | 现代开源 DIY | node:readline + JSON.parse |
| 调用检测引擎 | 6 类 pattern 判定 + 提取 skill 名 | 自研（核心差异点） | 本工具全部价值所在，无现成库 |
| 去重与归一 | replay 去重、命名空间归一 | 自研 | (sessionId, skill, ts) 复合键 |
| 聚合统计 | 按 skill/日/项目/来源/口径 | 自研（纯函数） | 内存 Map 聚合，无 DB |
| 终端渲染 | 表格 + sparkline 趋势 | 现代开源 DIY | cli-table3 + 手写八阶块字符 |
| CLI 框架 | 子命令/参数/help | 现代开源 DIY | gunshi（ccusage 同款） |
| 分发 | npm 发布、npx 即用 | 现代开源 DIY | tsdown 全量 bundle，零 runtime deps |

## 4. 推荐架构

```
 ~/.claude/                          ~/.codex/
 ├ projects/**/*.jsonl  (395MB)     ├ sessions/**/rollout-*.jsonl
 └ history.jsonl                    ├ archived_sessions/*.jsonl  (2GB)
                                    └ history.jsonl  (960K, 主信号)
        │                                   │
        ▼                                   ▼
 ┌─────────────────────────────────────────────────┐
 │  Source Adapters（每 runtime 一个，统一吐事件）    │
 │  ClaudeAdapter            CodexAdapter           │
 │  · Skill tool_use → auto  · $prefix → manual     │
 │  · <command-name>→ manual · <skill><name>→ auto  │
 │  · Read/Bash SKILL.md→auto· SKILL.md exec → auto │
 └────────────────────┬────────────────────────────┘
                      ▼
        InvocationEvent { skill, mode: manual|auto,
          source: cc|codex, ts, sessionId, cwd, sidechain }
                      ▼
 ┌──────────────┐  ┌──────────────┐  ┌─────────────┐
 │ Normalizer   │→ │ Deduper      │→ │ Aggregator  │
 │ 命名空间归一  │  │ 复合键去重    │  │ Map 内存聚合 │
 │ 内置命令黑名单│  │ resume replay│  │ 日/项目/口径 │
 └──────────────┘  └──────────────┘  └──────┬──────┘
                                            ▼
                              ┌─────────────┴─────────────┐
                              │ Table + Sparkline (默认)   │
                              │ --json (机器可读，供 Yoda) │
                              └───────────────────────────┘
```

Adapter 模式把两个 runtime 的异构落盘格式收敛为统一 InvocationEvent，后续管线 runtime 无关——未来加 OpenCode/Gemini 只需新增 adapter（Yoda 的 `agentTargets.ts` 已枚举 7 家数据目录，可直接复用知识）。

### 检测口径明细（实测验证）

| 信号 | 口径 | 判定 | 备注 |
|---|---|---|---|
| CC `"name":"Skill"` tool_use | auto | `.message.content[].name=="Skill"` → `.input.skill` | 粗 grep 预过滤提速 |
| CC `<command-name>/x</command-name>` | manual | 正则捕获，去前导 `/` | 需过滤内置命令（/clear /model /compact…） |
| CC Read/Bash 命中 `*/skills/<name>/SKILL.md` | auto | tool_use input 路径匹配 | 不做这条会严重少算自动触发 |
| Codex history.jsonl `^\$name` | manual | 追加式无 replay，计数以它为准 | 缺 cwd，join rollout 文件名补 |
| Codex rollout `<skill>\n<name>x</name>` | auto | 正则需含 `:`（命名空间） | resume/fork 会 replay，必须去重 |
| `isSidechain:true`（CC） | — | 默认排除，`--include-subagents` 开关 | 避免 subagent 归因混乱 |

## 5. 技术选型

| 模块 | 首选 | 备选 | 排除 | 理由 |
|---|---|---|---|---|
| 语言/运行时 | TypeScript + Node ≥20 | Bun | Rust（ccusage v20 路线） | 工具链一致迭代快；性能实测无瓶颈，Rust 过度设计 |
| CLI 解析 | gunshi（0.34，2026-06 仍发版） | commander 15 | citty（更新慢）、clipanion（卡 rc.4 两年） | ccusage 同款，类型安全 + 子命令 |
| Schema 校验 | valibot | zod | 裸 parse | 体积小适合 bundle；宽松 schema 容错 drift |
| 表格 | cli-table3（0.6.5） | 手搓 string-width 表格层 | ink/React TUI | MVP 够用；ink 对纯输出 CLI 杀鸡牛刀 |
| 趋势图 | 手写 ▁▂▃▄▅▆▇█ 八阶 sparkline | chartscii | asciichart（2022 停更） | 零依赖 30 行 |
| 打包 | tsdown（rolldown 系） | bun build | tsup（维护模式） | 依赖全 devDeps → 全量 bundle → 零 runtime deps |
| JSONL 解析 | node:readline 手写 | — | 第三方流式 JSON 库 | 行级独立天然流式 |
| 命名 | skillusage（npm 实测可用） | cc-skill-stats | ccskills（GitHub 同名 6-star 仓库语义冲突）、skill-stats（过泛） | 与 ccusage 心智呼应，不绑死 Claude |

### 已排除的整体方案

- 给 ccusage 提 PR：v20 核心是 Rust，skill 行为分析不在其"成本核算"定位内，无相关 feature request。
- 基于 cskwork/skill-usage-stats 二开：Python 脚本 + HTML dashboard，0 star 无分发，重写比改造便宜；检测分类法直接采用。
- SQLite 增量索引：全量扫描 < 1s，索引是 YAGNI。

## 6. 实施路线

| 阶段 | 周期 | 工作内容 | 交付物 |
|---|---:|---|---|
| MVP | 2 天 | 脚手架（gunshi+tsdown）；ClaudeAdapter 三 pattern；归一/去重/聚合；top 榜表格 + --json | CC 口径数字与摸底实测对账（commit-with-context 192 次） |
| V1 | 2 天 | CodexAdapter（history 主信号 + 注入辅信号 + replay 去重）；daily 子命令 + 30 天 sparkline；projects 聚合；--source/--mode 过滤 | 双 runtime 双口径完整；npm 发布 v0.1 |
| V2 | 按需 | 黑名单可配置；Windows 路径；OpenCode/Gemini adapter；mtime 增量缓存（扫描 > 3s 才做）；Yoda 接入（main spawn `skillusage --json` 替换 localStorage 数据源） | v0.2+；Yoda 技能详情页吃真实数据 |

## 7. 成本估算

| 成本项 | 方案 | 估算 | 依据 |
|---|---|---:|---|
| 开发 | 自研（AI 辅助） | 4–6 人天 | 解析 pattern 已全部实测验证，无未知探索量 |
| 基础设施 | 无 | ¥0/月 | 纯本地 CLI，npm 托管免费 |
| API/第三方 | 无 | ¥0 | 全 OSS（MIT 系） |

## 8. 风险与应对

| 风险 | 影响 | 应对 |
|---|---|---|
| CC/Codex 内部格式无契约，版本升级 drift | 高 | valibot 宽松 schema；未知行计数后跳过并在 --verbose 暴露；脱敏快照样本回归测试 |
| Codex resume/fork replay 重复计数 | 中 | manual 口径以 history.jsonl 为准；auto 口径 (sessionId, skill, ts) 去重，与 history 交叉校验（实测 41 vs 42 吻合） |
| 内置命令混入 manual 统计 | 中 | 内置黑名单 + 与 ~/.claude/commands、~/.claude/skills、~/.codex/prompts 安装清单求交集兜底 |
| 同一 skill 多命名形态（a vs plugin:a vs ns:ns:a） | 中 | Normalizer 取末段为主键、保留全名为别名，--no-normalize 可关 |
| CC transcript 被定期清理，历史不全 | 低 | history.jsonl 回溯更久（2025-10 起）作 manual 兜底源；文档明示统计下限语义 |
| Read/Bash 路径匹配误报 | 低 | 该信号标记 auto(inferred)，默认计入，--strict 可排除 |

## 9. 下一步

1. 确认包名 skillusage（备选 cc-skill-stats），即可建仓脚手架。
2. MVP 第一刀：ClaudeAdapter + top 榜，与摸底实测数字对账。
3. 决策：仓库放 lovstudio 组织还是个人名下（影响品牌署名）。

## 10. 参考来源

- https://github.com/ccusage/ccusage — 先行项目架构/分发模式参照，确认无 skill 维度
- https://github.com/cskwork/skill-usage-stats — 检测分类法来源（六类 pattern）
- https://github.com/chiphuyen/sniffly 、https://github.com/davila7/claude-code-templates — 周边竞品排除依据
- https://www.npmjs.com/package/gunshi 、https://www.npmjs.com/package/tsdown 、https://valibot.dev — 选型主件
- 本机实测（2026-06-12）：~/.claude 442 jsonl/395MB 扫描 0.19s；~/.codex 853 jsonl/2GB 扫描 0.7s
