# Infographic brief

Working title: 智能路径从文本猜测升级为真实解析，才能稳定打开正确目标
Template: operating-model
Evidence mode: qualitative

## Audience and decision

- Audience: 设计和实现 Yoda 智能路径体验的产品、工程与独立开发者。
- Decision or use moment: 决定下一阶段继续扩展正则，还是建立真实文件系统参与的路径解析层。
- What should change after reading: 将 OSC 8 作为确定性快车道，将普通文本智能匹配保留为兼容入口；把磁盘校验和上下文排序设为共同解析层。

## Governing message

智能路径从文本猜测升级为真实解析，才能稳定打开正确目标。

Supporting deck: OSC 8 负责精确边界；普通文本经过语法、磁盘与上下文三层求解，按置信度执行。

## Argument and evidence map

| ID | Claim or decision criterion | Exact evidence | Visual encoding | Annotation |
|---|---|---|---|---|
| C1 | 两种输入应保留不同确定性 | S1、S2 | 左侧双轨位置；橙色表示 OSC 8 确定性元数据，灰色表示文本候选 | “协议给边界；文本靠识别” |
| C2 | 真实磁盘是路径成立的 Ground Truth Gate | S3、S5 | 中央三层管线；第二层用橙色门槛与磁盘符号强调 | “存在，才从候选升级为目标” |
| C3 | 上下文用于排序，不替代存在性 | S3、S5 | 第三层连接 cwd、worktree、Git 与近期行为，再流向分级动作 | “在多个真实候选中选最相关” |
| C4 | 置信度应决定交互，而非静默猜测 | S5、S6 | 右侧三档结果按颜色与顺序编码 | “高：直达；中：候选；低：保留文本” |
| C5 | 硬换行只作为输入恢复兼容层 | S4 | 文本输入轨道内的窄灰色标签，不占据核心能力位置 | “TUI 视觉折行恢复” |

## Evidence ledger

- Evidence ID: S1
  - Supports claim: C1
  - Exact source: 用户提供的会话 URL 被匹配为 `URL)现在会`，证明普通文本边界存在歧义。
  - Location: 当前对话；`source.md`“用户原始问题”
  - Type: fact
  - Unit / period: 单个已复现案例；2026-07-29
  - Caveat: 单例用于说明边界类型，不代表总体错误率。

- Evidence ID: S2
  - Supports claim: C1
  - Exact source: xterm.js 支持 `OSC 8 ; params ; uri BEL/ST`，输出方可直接声明 URI 与链接范围。
  - Location: https://xtermjs.org/docs/api/vtfeatures/；https://xtermjs.org/docs/guides/link-handling/
  - Type: fact
  - Unit / period: xterm.js 官方公开协议；检索于 2026-07-29
  - Caveat: 只有输出方实际携带 OSC 8 时，终端才能使用该确定性通道。

- Evidence ID: S3
  - Supports claim: C2、C3
  - Exact source: 当前实现解析路径边界、行列号、workspaceRoot、Home 与 worktree aliases，但解析链路没有访问文件系统验证存在性。
  - Location: `src/renderer/lib/pty/terminal-file-links.ts:144-200,474-588`
  - Type: fact
  - Unit / period: 当前 main 实现；核验于 2026-07-29
  - Caveat: “磁盘校验层”和“模糊排序层”是下一阶段产品设计，不是已交付现状。

- Evidence ID: S4
  - Supports claim: C5
  - Exact source: 文件与 URL 共用 `buildScanChunks()`；软换行直接重组，硬换行只在行满、路径尾部和续行信号成立时保守连接。
  - Location: `src/renderer/lib/pty/terminal-file-links.ts:203-415`
  - Type: fact
  - Unit / period: 当前 main 实现；最多四段硬换行恢复
  - Caveat: 这是 TUI 输出兼容层，仍有启发式边界。

- Evidence ID: S5
  - Supports claim: C2、C3、C4
  - Exact source: 用户明确提出“结合用户真实磁盘系统的路径校验（甚至辅助匹配）”。
  - Location: 当前对话；`source.md`“对话中形成的产品判断”
  - Type: fact
  - Unit / period: 产品方向；2026-07-29
  - Caveat: 具体索引、搜索边界和性能预算仍待设计。

- Evidence ID: S6
  - Supports claim: C4
  - Exact source: 当前对话形成的三档交互建议：高置信度直达，中置信度显示候选，低置信度保留普通文本或搜索入口。
  - Location: 当前对话；本 brief 的解释性设计
  - Type: interpretation
  - Unit / period: 定性产品判断
  - Caveat: 分档阈值需要基于真实使用数据校准。

## Assumptions and gaps

- 假设本地项目可使用受限范围的异步文件查询；SSH 项目需由远端文件系统执行同一契约。
- 假设 worktree、主仓库 alias、当前 cwd、Git 改动与近期文件可作为排序信号。
- 本图没有实际命中率、查询延迟、候选规模或置信度阈值数据。
- “上下文排序提高相关性”是待验证的产品假设；磁盘存在性是确定性事实。

## Exhibit specification

- Primary relationship: system
- Template: operating-model
- Evidence mode: qualitative
- Required encodings: connection 表示信息流；position 表示处理顺序；color 表示确定性；containment 表示层级与责任边界。
- Direct annotations: “协议给边界，磁盘给真相，上下文给优先级”；“存在，才从候选升级为目标”。
- Decision marker: 中央真实磁盘 Gate 与右侧高置信度直达动作。
- Source-reference mapping: S1–S6 映射输入、能力 Gate、输出动作与两条直接注释。

## Copy map

- Figure label: Exhibit 01 · Smart Path Resolution
- Action title: 智能路径从文本猜测升级为真实解析，才能稳定打开正确目标
- Optional deck: OSC 8 负责精确边界；普通文本经过语法、磁盘与上下文三层求解，按置信度执行。
- Visual labels: 信号入口、解析管线、用户动作；边界捕获、真实目标校验、上下文排序。
- Source / note: 当前对话、Yoda main 实现与 xterm.js 官方协议；全部为定性系统设计。

## Deliberate omissions

- 不展开正则细节、扩展名清单和终端单元格映射算法。
- 不展示虚构命中率、延迟、准确率和置信度分数。
- 不展开文件索引技术选型、缓存失效和远程搜索协议。
- 不把智能路径、OSC 8、硬换行分别做成三张并列卡片。

## Human review

- [x] 标题在五秒内表达“从猜测到真实解析”的升级方向。
- [x] 主视觉先显示双轨输入，再经过三层管线，最后落到三档动作。
- [x] 橙色只表示确定性证据或高置信度动作。
- [x] 每个能力、输入和结果都映射到 S1–S6。
- [x] 原图与缩略图均可辨认主流程，无溢出、空容器或卡片墙。

Review evidence: 2026-07-29 检查 3200×1800 `poster.png` 原图与 480×270
缩略图。标题稳定分成“从文本猜测升级为真实解析”与“打开正确目标”两行；缩略图仍能辨认
左侧双轨输入、中央三层顺序管线、橙色真实磁盘 Gate 和右侧三档动作。原图中的能力清单、
直接注释、来源、Logo 与归因均清晰，无断词、溢出、空容器或装饰性卡片墙。
