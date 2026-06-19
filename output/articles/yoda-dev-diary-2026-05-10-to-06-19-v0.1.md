# Yoda 开发日记

> 从「接手 emdash」到 v0.13.4 —— 2026-05-10 ~ 2026-06-19，约 40 天

---

## 结论先行

接手 emdash 的第一天（2026-05-10），我做的不是写功能，而是**改名**：把一个开源 Electron 并行 Agent 编排器整体迁成 Yoda，换品牌、换登录、换数据目录、换 keychain key，干净切断与上游的脐带。之后 40 天里：

- **1029 个 commit**，净增 **+185,490 / −15,142** 行，触及 1196 个文件，`src/` 涨到 1503 个文件，Drizzle 迁移累计 35 个。
- 发布节奏：**v0.1.0 → v0.13.4，共 36 个正式 release**。
- 真正的开发不是线性的，而是「**两头慢、中间炸**」：5 月立身、5 月下旬到 6 月初蛰伏打地基，**6/11–6/13 三天合计 467 个 commit** 的爆发，再到 6 月中下旬收敛进「多智能体协作」这个产品主线。

一句话定性：前 30 天在补 emdash 没有的工程底座（i18n / 签名 / 更新器 / 移动端 / 运行时抽象），后 10 天把 Yoda 从「一个并行 terminal agent 工具」推成「**有品牌、有协作范式、有自动化引擎的 Agent 工作台**」。

---

## 时间线总览

| 阶段 | 日期 | commit 量级 | 版本 | 主题 |
|---|---|---|---|---|
| 一·接手立身 | 5/10–5/12 | 35 | v0.1.0–v0.3.0 | 改名、设备流登录、i18n、签名公证、Lovcode |
| 二·蛰伏筑基 | 5/21–6/9 | ~80 | v0.3.1–v0.3.11 | projectless、Codex 集成、移动端、工作区、更新器 |
| 三·大爆发 | 6/10–6/13 | ~508 | v0.5.0–v0.11.0 | 标签系统、用量统计、子任务、分支收尾、浏览器、主题、开机画面、看板、品牌 The Hood、AI Lab、自动化引擎 |
| 四·收敛成形 | 6/14–6/19 | ~389 | v0.11.1–v0.13.4 | Review 工作流、资源库 Library、智能体团队、多配置对比 |

每日提交曲线（mark 时代）：

```
5/10   1   ▏
5/11  10   ██
5/12  24   █████
5/21   1   ▏
5/25   4   █
5/26   8   ██
5/28-31 5  █
6/02  13   ███
6/04   4   █
6/05   7   ██
6/06  13   ███
6/07   2   ▏
6/08  18   ████
6/09  22   █████
6/10  41   █████████
6/11 115   ████████████████████████
6/12 229   ██████████████████████████████████████████████  ← 单日峰值
6/13 123   ██████████████████████████
6/14  42   █████████
6/15  95   ████████████████████
6/16 129   ███████████████████████████
6/17  99   █████████████████████
6/18  17   ████
6/19   7   ██
```

---

## 第一章 · 接手与立身（5/10 – 5/12）

### 5/10 — 第一刀切在品牌上

接手当天唯一一个 commit：`feat: rename emdash → yoda + switch sign-in to Lovstudio device flow`。这不是改个名字这么轻：

- `package.json` name/productName/appId 全换（`ai.lovstudio.yoda.{stable,canary}`）
- 数据库路径、`.db` 文件名、所有 `EMDASH_*` 环境变量 → `YODA_*`，**不留 fallback，干净断裂**
- keychain key、agent hooks 的 HTTP header（`X-Emdash-*` → `X-Yoda-*`）、worktree 配置 `.emdash.json` → `.yoda.json`
- 登录从「PKCE-loopback 打 auth.emdash.sh」整体换成 **Lovstudio 设备流**（`POST /api/cli/auth/start` → 展示 user_code → 轮询拿 token），因为 Lovstudio 侧根本没有 PKCE 对应物
- README 重写成「Jedi-master / 并行 agent 编排」的叙事

定调：**Yoda 是一个独立产品，不是 emdash 的皮肤。**

### 5/11 — v0.1.0 ~ v0.1.3：把「能发布」这件事跑通

一天连发四个版本，核心是补工程底座：

- **v0.1.0**：i18next + react-i18next 双语（英文 / 简体中文），拼音感知的任务 slug（`pinyin-pro`），新首页（项目 + agent 选择器），侧边栏重构。
- **v0.1.1 / v0.1.2**：Apple Developer ID 签名 + 公证全链路打通，复用 lovstudio org 级 secrets（与 lovcode 共享）；签名做成可选开关，缺密钥也能出无签名包。
- **v0.1.3**：项目归档/取消归档，会话标题模块（从 Claude transcript 推导可读标题）。

### 5/12 — v0.2.0 / v0.3.0：第一批「自己的」功能

- **v0.2.0**：首页草稿持久化 + express mode（侧边栏 `+` 用上次配置秒建任务）、归档备注、按时段问候。同时修了启动时序——`resolveUserEnv()` 移到后台跑，重型 zsh 登录 shell 不再给启动加 1–2s。
- **v0.3.0**：**Lovcode 集成**（命令面板多了一个 Lovcode 搜索源 + 未安装时的引导横幅）、独立的 Agents view、命令面板结构化 qualifier、归档前自定义命令、「标记待审查」任务态、项目别名。

---

## 第二章 · 蛰伏与筑基（5/21 – 6/9）

这段提交量低（每天个位数到十几个），但全是日后爆发的地基。表面平静，实际在啃硬骨头。

- **5/21 v0.3.1 / 5/25 v0.3.2–v0.3.4**：i18n 全覆盖（工作区/设置/项目/任务/MCP/skills）、修中文语言解析、更新器走 GitHub Releases、合并 macOS x64/arm64 更新清单。
- **5/25–5/31 v0.3.3–v0.3.5**：**projectless 工作流**首次出现——不建项目、不开 worktree 也能跑会话；MaaS dashboard + ZenMux 用量集成（加密 API key 存储）。
- **6/2 v0.3.6 / v0.3.7**：`yoda://` / `yoda-canary://` 深链；**Codex 上下文面板**（runtime 元数据、system/developer 消息、记忆文件、动态工具、turn context）；tmux 会话持久化；Electron 升到 41.7.1。
- **6/4 v0.3.8**：**Codex 会话恢复**（能复原 rollout 终端历史、复用原始 session id）；默认开启 tmux 保护长会话；移除 emdash 数据目录的遗留迁移路径——彻底告别上游。
- **6/7 v0.3.9**：**Expo 移动 App + token 保护的桌面移动网关**首次落地，手机端可看项目/任务状态、发新请求。
- **6/9 v0.3.10 / v0.3.11**：**工作区（Workspaces）**——把项目分组切换；**可配置 Agent 实体**（自定义 create/edit/manage）；agent hooks inspector；**可定制侧边栏**（拖拽排序/隐藏次级导航）；实时 agent runtime 指示器。这里重做了 agent 运行态同步，根治了「卡死的转圈」和「空闲却显示忙」。

> 关键术语奠基在此：**Runtime = CLI 执行环境，Agent = prompt+skills 实体**，二者解耦。

---

## 第三章 · 大爆发（6/10 – 6/13）

四天 ~508 个 commit，6/12 单日 229 个是整个项目峰值。Yoda 的「形」基本在这四天里长齐。

### 6/11（115 commit）— v0.5.0 / v0.6.0 / v0.7.0

- **v0.5.0**（跳过 0.3.12–0.4.x，那段号留给 emdash 旧 tag）：
  - **作用域标签系统（Scoped app tabs）**：顶级 tab + 每作用域独立标签条，可 pin 到任务侧栏、可复制成独立窗口。
  - **用量统计域**：解析 Claude/Codex transcript 成 token 用量，token 热力图、按会话用量 chip、项目用量卡片、任务 diff 快照。
  - **嵌套子任务**：任意深度父子层级 + 可折叠侧栏树。
  - **会话面板大改**：分区可见性/排序、概要快照、Statusline 区、hooks 计数。
  - 术语正式化「provider → runtime」；终端 resize 流水线重建（freeze 层 + rAF 限频，消灭白闪/抖动/橡皮筋）。
- **v0.6.0**：**分支收尾流程**（状态感知的 titlebar CTA + 验收/合并/归档面板，本地 squash 合并、AI commit message、冲突解决 agent）；分支显示三档；prompt 历史「百叶窗」；归档项原地审查 + 只读转录；项目级 token 统计可视化；**工作区单一归属**（冲突三选一弹框）。
- **v0.7.0**：**应用内浏览器面板**——终端里点 URL（智能链接 / OSC 8 / 链接手势）在侧栏 webview 打开，带前进后退/地址栏；侧边栏底部账号行换成「logo + 产品名 + 版本」锚点。

### 6/12（229 commit，峰值）— v0.8.0 / v0.9.0 / v0.10.0

- **v0.8.0**：主题阵容（Matrix → 一等 `ydark`、尤达绿II/白II、跟随系统选明暗配对）；**kernel-boot 开机画面**；浏览器升级为常驻卡片；Skills 大修（详情转顶级 tab、30 天趋势图、可 pin）；设置重组（新增 Session tab，worktree 位置二选一）；侧栏 side-pane 无处不在。**命名方向翻转：会话名成为真相源，任务名跟随它。**
- **v0.9.0**：**跨项目 Agent 看板（Alpha）**——拖任务跨状态列、列级可配 hooks、卡片 hover 预览；Skills round two（触发测试、AI 迭代、按前缀树状分组、真实调用统计）；自定义运行原则（Prompts 设置页注入 system prompt）；状态聚合（侧栏按优先级 roll up 会话态）。
- **v0.10.0**：**全新品牌「The Hood」**——矢量 mark（圆角三角robe + 泪滴兜帽负空间 + 内部一束光），全平台 app 图标、in-app lockup、开机画面呼吸 mark、落地页重制、yoda.lovstudio.ai/design 设计系统页全部铺开；**AI Lab**（双引擎 logo/图像生成：ZenMux Vertex 协议 + Codex CLI）；**AI 调用日志**（每次 AI 调用从开始即写 running 行）；Markdown Front Matter 渲染；worktree 路径扁平化。

当天的 commit 流里能看到大量 `fix(tabs)`：sticky tabs、跨 scope 拖回、落点决定激活——标签拖拽这套交互被反复打磨。

### 6/13（123 commit）— v0.10.1 ~ v0.10.4 / v0.11.0

- **导航瘦身**：侧栏 nav 只留四项（官网/文档/设置/反馈），看板/AI Lab/Roadmap 收进设置 tab。
- **打包瘦身**：只装 native deps，其余打进 `out/`（asar 690→42MB 量级）。
- **更新器竞态修复**：release 改成先 draft、所有平台资产传完再 publish，mac 更新检查不再在上传窗口 404；登录 shell env 抓取用哨兵（`__YODA_ENV_START/END__`）包裹，隔离 p10k/oh-my-zsh 横幅噪声污染 PATH——根治 GUI 启动检测不到 `claude`/`tmux` 的老问题。
- **v0.11.0 自动化引擎（P1）**：croner 进程内调度，开机从 DB 重建，手动/cron 触发、时区、`automation_runs` 历史表；**Split view 主内容区并排多任务**。

---

## 第四章 · 收敛与协作范式（6/14 – 6/19）

爆发后开始收敛，主线明确：把零散能力拢成「**多智能体协作平台**」。

- **6/14 v0.11.1 / v0.11.2**：run-mode 改卡片式 + 显式确认；**Review 工作流**编排下沉主进程（marker 兜底 turn-end）；快速建项目（项目选择器即时建库）；「添加父任务」分组容器。修了 worktree provisioning 卡在 git fetch 凭证提示的 bug。
- **6/15 v0.11.3 ~ v0.11.5 / v0.12.0**：
  - **已安装插件管理器**（与 Skills 并列）；**每任务 chrome 状态按 task 隔离**（侧栏/底部面板/抽屉不再跨任务串味）；compare/team 在空仓库/非 git 目录也能跑（seed 初始 commit）；分支轨（per-branch 色条）。
  - **Antigravity CLI** runtime。
  - **v0.12.0 资源库 Library**：新顶级导航，整合 Prompts/Skills/Automation，MCP 和 Agents 也搬进来——设置只留配置；返回启动走 boot 快路径（只显 logo 秒进）。
- **6/16 v0.12.1 / v0.13.0**：
  - Review 第一个可用切面（reviewer 会话跨轮复用、转交 note 而非 raw buffer）；Team rooms phase 1 数据层。
  - **v0.13.0 智能体团队 —— 多智能体协作**：一队 agent 在共享 room 协作的新范式。团队 = 解耦模板（数据+域+RPC）在 Library 管理，从 composer 驱动「多智能体」范式，跑成迭代式 conductor room；内置「Review」团队、game-loop conductor（`@mention` 注入会话）、System 裁判自动路由、常驻可点 roster、内联会话 inspector、心跳+standup 进度。同时 **术语改名：Runtime → 客户端，Agent → 智能体**（代码符号不动）；新增 GLM/Step/xAI Grok 三个客户端（凑齐 31 种）；**Annotations 批注**；**Prompt 泄露提示词参考画廊**。
- **6/18 v0.13.1 ~ v0.13.3**：room 会话先加载再开 tab；更新器暴露失败 + 手动下载兜底 + 代理支持；agent 配置的模型在启动时按 per-runtime flag 生效；修深链白屏、Claude/Codex 卡「awaiting input」、终端滚动重影。
- **6/19 v0.13.4（当前）**：**多配置对比**——composer 下的「+对比」按钮加变体行，每行可覆盖项目/客户端模型/分支策略/prompt；提交后每个配置 spawn 一个任务，在独立窗口并排平铺（列/行切换），关窗后每个任务仍留在各自项目侧栏。取代了原来 agent-only 的 compare run mode。

---

## 主题脉络（贯穿 40 天的几条线）

1. **品牌自立**：5/10 改名 → v0.10.0 The Hood 视觉系统 → 落地页/设计页/README 全面对齐。一条「从换字符串到换灵魂」的线。
2. **运行时抽象**：provider → runtime → 客户端，从 2 种 CLI 扩到 31 种（Claude/Codex/GLM/Step/Grok/Antigravity/Warp…），且坚持「不接 API、全靠 spawn CLI」。
3. **任务/会话模型演化**：projectless → 嵌套子任务 → 父任务容器 → 每任务状态隔离 → split view 并排 → 多配置对比。任务从「单个 worktree」长成「可对比、可分组、可并排的工作单元」。
4. **协作范式跃迁**：单 agent → Review（双方并排）→ Agent Teams（共享 room 多智能体）。这是 Yoda 从工具走向「开发范式」的关键转折。
5. **工程纪律**：35 个 Drizzle 迁移、更新器竞态/签名/打包瘦身/启动性能，反复在「能稳定发布」上投入——bug fix 占了相当比例的 commit。
6. **移动端**：Expo App + token 网关，切网重启/token 持久化，是少数尚未收尾的欠账线。

---

## 数据附录

- 起点 commit：`0b075bb15`（2026-05-10，emdash → yoda）
- 终点 commit：`fa270e539`（2026-06-19，release v0.13.4）
- 净改动：1196 文件，+185,490 / −15,142 行
- `src/` 文件数：1503
- Drizzle 迁移：35
- 正式 release：36（v0.1.0 → v0.13.4）
- 单日峰值：2026-06-12，229 commit
- 三天爆发：6/11–6/13，467 commit（占全期约 45%）

---

*生成于 2026-06-19 · 数据来源：本仓库 git log + CHANGELOG.md*
