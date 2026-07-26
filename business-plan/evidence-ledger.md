# Yoda — Evidence Ledger

Updated: 2026-07-26

Status values: `fact`, `inference`, `assumption`, `open-gap`.

| ID | Claim | Status | Source | As of | Slide | Notes / next action |
|---|---|---|---|---|---|---|
| E-001 | Yoda 是本地优先、开源、供应商中立的 Agent Workspace / Harness | fact | `README.md`; `package.json`; Apache-2.0 `LICENSE` | 2026-07-26 | 1, 4, 6 | 用普通商业语言解释 Harness，不从技术名词起笔 |
| E-002 | Yoda 的目标是让人从意图到交付持续控制 Agent 工作 | fact | `README.md`; `src/shared/harness.ts`; Task、Feature、Review、Release 相关实现 | 2026-07-26 | 1, 3, 4 | 产品边界是工作系统，不是模型或单一 Agent |
| E-003 | 31 种 Agent Client 已接入 | fact | `README.md:67`; `src/shared/runtime-registry.ts` | 2026-07-26 | 6, 7, 9, 14 | 统计口径为 README 当前声明，不等于每个客户端活跃使用 |
| E-004 | Yoda 覆盖 Task、Feature、Worktree、Diff、Review、PR、Release 主线 | fact | `README.md`; `src/main/core/`; `src/renderer/`; `agents/architecture/overview.md` | 2026-07-26 | 4, 5, 6 | 第 5 页使用真实产品截图 |
| E-005 | Yoda 支持桌面、移动端、浏览器入口、SSH 与 Relay 连续性 | fact | `README.md`; `apps/mobile/`; `agents/architecture/mobile.md`; Relay package | 2026-07-26 | 6, 12 | Relay 处于商业验证早期 |
| E-006 | 实现成本下降时，委托复杂度成为新的控制问题 | inference | E-002–E-005；行业产品演进 | 2026-07-26 | 2, 3 | 趋势图必须标“示意”，不能伪装成统计预测 |
| E-007 | 创意 AI 已进入大量创作者工作流，同时最终判断仍由人承担 | fact | Adobe, “Creators’ Toolkit Report 2026”, https://news.adobe.com/news/2026/06/creators-toolkit-report-2026 | 2026-07-26 | 8 | deck 使用 75% 与 85% 两项原报告口径 |
| E-008 | GitHub 当前 54 Stars、18 Forks | fact | GitHub REST API `repos/lovstudio/yoda` | 2026-07-26 | 9 | 公开兴趣信号，不等于用户规模 |
| E-009 | 最近 14 天 438 次 Clone、141 个独立 Cloner | fact | GitHub Traffic API `traffic/clones` | 2026-07-26 | 9 | 时间窗为 2026-07-11 至 2026-07-24；GitHub 返回 14 天数据 |
| E-010 | 当前累计 76 个 GitHub Release | fact | GitHub REST API `repos/lovstudio/yoda/releases` | 2026-07-26 | 9, 14 | GitHub Release 数不等于语义版本 tag 数 |
| E-011 | 自 GitHub 仓库创建以来 `main` 新增约 1,709 个提交 | fact | `git rev-list --count --since='2026-05-10T15:30:35Z' main` | 2026-07-26 | 9, 14 | 含合并与协作者贡献，不等于个人代码量或质量 |
| E-012 | Release 资产累计 11,842 次请求，其中可安装/压缩资产约 1,465 次 | fact | GitHub Releases API，按扩展名分类汇总 | 2026-07-26 | 9 | 包含重复下载；更新清单等机器请求另计 10,377 次 |
| E-013 | 已观测 73 个独立授权用户、3 个 Relay 试用、0 付费 | fact | 2026-07-21 Yoda 账号与 Relay 后台只读快照；`docs/plans/2026-07-21-yoda-business-plan-outline.md` | 2026-07-21 | 9 | 私有后台快照；不同指标不构成漏斗，投前应刷新并排除内部账号 |
| E-014 | 当前没有覆盖全部桌面用户的 DAU、D7/D30 留存与任务完成率 | open-gap | `docs/plans/2026-07-21-yoda-business-plan-outline.md` | 2026-07-21 | 9, 13, 15 | 0–3 个月首先补齐埋点、口径和 cohort |
| E-015 | 全球约有 2.07 亿创作者 | fact | Visa, “Monetized: Visa 2025 Creator Report”, https://corporate.visa.com/en/solutions/commercial-solutions/knowledge-hub/2025-visa-creators-report.html | 2026-07-26 | 10 | 只作为买方数量上限，不把 5,000 亿美元宏观规模当软件 TAM |
| E-016 | 理论 TAM 248 亿美元/年 | assumption | E-015 × 120 美元/年 | 2026-07-26 | 10 | 每位创作者购买一套基础 AI 工作系统的上限情景 |
| E-017 | SAM 24.8 亿美元/年 | assumption | E-015 × 10% 近期适配率 × 120 美元/年 | 2026-07-26 | 10 | 10% 适配率需通过目标用户研究与转化数据验证 |
| E-018 | 三年 SOM 240 万美元 ARR | assumption | 20,000 个付费账户 × 120 美元/年 | 2026-07-26 | 10 | 经营目标；需用获客能力、留存与付费率逐季反推 |
| E-019 | Yoda 相比单一 Agent 工具更强调供应商中立、Harness、证据与治理 | inference | Yoda README/代码；Cursor、OpenAI Codex、Conductor 等公开产品页面 | 2026-07-26 | 11 | 象限为定性判断，随竞品迭代刷新 |
| E-020 | 本地核心开源，Relay/Creator Pro/Team/Enterprise 分层收费 | assumption | 现有 Relay 能力；`docs/plans/2026-07-21-yoda-business-plan-outline.md` | 2026-07-26 | 12 | 产品与定价架构，尚未证明支付意愿 |
| E-021 | C 端开源社区与 B 端高校/训练营是两条首发 GTM 路径 | assumption | 创始人公开活动触点；现有开源分发能力 | 2026-07-26 | 13 | 先以 20 位深访和 2–3 家设计伙伴验证 |
| E-022 | 创始人是 Yoda 第一重度用户，并用 Yoda 开发 Yoda | fact | Git 历史、项目工作流、`docs/plans/2026-07-21-yoda-business-plan-outline.md` | 2026-07-26 | 14 | 将“自用”转化为可量化交付效率仍需专项测量 |
| E-023 | 创始人横跨开发工具、内容创作、培训与 AI 产品化 | fact | https://lovstudio.ai/about 及其公开链接；项目材料 | 2026-07-26 | 14 | 正式尽调逐项核对活动与履历原始凭证 |
| E-024 | 本轮拟融资 200 万元人民币或 30 万美元、出让 10% | assumption | 创始人既有 BP 提案；奇绩创坛公开标准额度仅作金额参照 | 2026-07-26 | 15 | 10% 为 Yoda 提案，不表述为任何机构统一条款 |
| E-025 | 资金用途为研发 60%、增长 30%、基础设施与运营 10% | assumption | 管理计划 | 2026-07-26 | 15 | 与 18–24 个月里程碑和现金预算联动 |
| E-026 | 本轮要验证留存、个人付费、机构年约和增长效率 | inference | E-014、E-020、E-021、E-024、E-025 | 2026-07-26 | 15 | 这是融资后的四个核心验证门 |

## Source notes

- GitHub API 数据在 2026-07-26 通过已授权 `gh api` 查询；Traffic API 的 “uniques” 为 GitHub 定义的去重口径。
- 仓库总历史包含 Yoda 之前的项目历史，因此提交数只统计 GitHub 仓库创建时间之后的 `main` 提交。
- 账号与 Relay 数据来自 2026-07-21 的只读快照，本轮未访问生产数据库；正式对外前需刷新。
- 市场计算明确区分事实与假设：创作者数量是外部事实，适配率、价格、账户目标均为管理层假设。
- 未记录任何密钥、个人客户数据或后台凭据。
