# Infographic brief

Working title: 开源 MaaS 网关选型指南：统一管理、自动路由与稳定性对比
Template: comparison-matrix
Evidence mode: qualitative

## Audience and decision

- Audience: 手上同时拥有多个 OpenAI 兼容 MaaS、希望用一个入口供 Yoda、Codex 或 OpenAI SDK 使用的独立开发者与小团队。
- Decision or use moment: 在自建统一大模型网关之前，选择默认技术路线，并识别何时应升级到基础设施级网关。
- What should change after reading: 不再围绕单项功能或 GitHub 热度选型；默认采用 LiteLLM，只有既有 K8s、高并发或长连接约束成立时才转向 Higress。

## Governing message

异构 MaaS 默认选 LiteLLM；已有 K8s 且追求数据面稳定时转向 Higress。

Presentation rule: 大标题说明本图的用途与主题；选型建议置于矩阵尾部，作为完成比较后的决策读出。

## Supporting claims

1. LiteLLM 同时覆盖自定义 OpenAI 兼容端点、统一模型入口、管理界面、虚拟密钥、路由、主动健康检查和高可用部署，最贴合个人或小团队的完整需求。
2. Higress 的 Envoy/Istio 数据面、Kubernetes 部署和无损配置更新更适合高并发、SSE 长连接及已有网关运维体系的团队。
3. Portkey 的嵌套路由表达力强，但完整治理能力与企业/托管版本存在边界；New API 的优势主要在中文渠道、用户和计费运营。
4. 对当前场景，先实现确定性的优先级、健康检查和故障转移；语义选模应等待真实质量、延迟和成本数据。

## Argument and evidence map

| ID | Claim or decision criterion | Exact evidence | Visual encoding | Annotation |
|---|---|---|---|---|
| C1 | LiteLLM 是异构 MaaS 的默认路线 | S1、S2 | 第一行位置、橙色决策标记、完整能力标签 | “默认路线”直接标在决策列 |
| C2 | Higress 只在基础设施约束成立时反超 | S3 | 第二行位置、稳定性单元格橙色、条件决策标记 | “K8s / 高并发 / SSE”标在决策列 |
| C3 | Portkey 更适合配置驱动的复杂路由 | S4 | 中性行、路由单元格强调“嵌套策略” | “路由表达力优先”标在边界列 |
| C4 | New API 更适合渠道运营 | S5 | 中性行、管理单元格强调“用户·渠道·计费” | “运营后台优先”标在边界列 |
| C5 | 客户端只连接一个 Gateway | S1、S3 | 底部单一方向读出条 | “固定 Base URL”直接标注 |

## Evidence ledger

- Evidence ID: S1
  - Supports claim: C1、C5
  - Exact source: LiteLLM 官方文档说明 Proxy 是集中式 LLM Gateway，支持自定义 OpenAI 兼容端点、管理界面、虚拟密钥、负载均衡、优先级、重试和 Fallback；健康检查路由可主动移除异常部署。
  - Location: https://docs.litellm.ai/ ; https://docs.litellm.ai/docs/providers/openai_compatible ; https://docs.litellm.ai/docs/proxy/load_balancing ; https://docs.litellm.ai/docs/proxy/health_check_routing
  - Type: fact
  - Unit / period: 官方公开功能；检索于 2026-07-29
  - Caveat: 官方功能声明不等同于本场景下的统一性能压测。

- Evidence ID: S2
  - Supports claim: C1
  - Exact source: LiteLLM 官方生产部署建议无状态服务运行两个以上副本；PostgreSQL 保存密钥、团队、使用与配置，Redis 在多实例时共享限流和路由状态。v1.94.0 提供签名镜像；2026 年 3 月曾发生 PyPI 供应链事件，官方 Docker 镜像未受影响。
  - Location: https://docs.litellm.ai/docs/proxy/deploy ; https://github.com/BerriAI/litellm/releases/tag/v1.94.0 ; https://docs.litellm.ai/blog/security-update-march-2026
  - Type: fact
  - Unit / period: v1.94.0；检索于 2026-07-29
  - Caveat: “默认路线”是基于完整度与运维门槛的选型判断；生产部署仍需固定镜像 digest 并验证。

- Evidence ID: S3
  - Supports claim: C2、C5
  - Exact source: Higress 官方资料说明其基于 Envoy 和 Istio，提供控制台、统一多模型访问、模型负载均衡、Fallback、Token 限流和可观测性；项目强调无损热更新、SSE 流式处理和 Kubernetes 部署。
  - Location: https://github.com/higress-group/higress ; https://higress.io/en/ai-gateway ; https://higress.io/en/docs/latest/user/quickstart/
  - Type: fact
  - Unit / period: 官方公开功能；检索于 2026-07-29
  - Caveat: “基础设施级稳定”是架构与公开采用信息的定性判断，不代表与其他方案完成了同条件压测。

- Evidence ID: S4
  - Supports claim: C3
  - Exact source: Portkey 开源网关支持自动重试、Fallback、负载均衡、条件路由和自定义 Host；官方仓库同时标注 Gateway 2.0 仍为预发布，组织治理和高级能力存在托管或企业版本边界。
  - Location: https://github.com/Portkey-AI/gateway ; https://portkey.ai/docs/product/ai-gateway
  - Type: fact
  - Unit / period: 官方公开功能；检索于 2026-07-29
  - Caveat: 未对其托管版本进行成本和数据驻留评估。

- Evidence ID: S5
  - Supports claim: C4
  - Exact source: New API 官方文档提供渠道优先级、权重、多密钥轮询、自动禁用、用户和计费管理；仓库采用 AGPLv3 并带品牌保留要求，项目文档提示开源版本不承诺稳定性和技术支持。
  - Location: https://docs.newapi.pro/en/docs/guide/feature-guide/admin/channel ; https://github.com/QuantumNous/new-api/blob/main/README.md
  - Type: fact
  - Unit / period: 官方公开功能；检索于 2026-07-29
  - Caveat: 本图评估的是自用统一网关，不是否定 New API 的渠道运营价值。

## Assumptions and gaps

- 假设上游 MaaS 提供 OpenAI 兼容 Base URL 和 API Key。
- 假设主要使用者是个人或小团队，而非对外售卖 API 的渠道商。
- 矩阵为定性判断，不展示上一轮的主观综合分数，也不暗示完成了统一负载压测。
- “稳定性上限”综合考虑数据面架构、长连接、热更新和高可用部署，不是单一可用率指标。
- 同名模型可能来自不同真实版本；上线前仍需以 Responses、流式输出、工具调用和错误码做兼容性测试。

## Visual job

- Primary relationship: compare and decide
- Template: comparison-matrix
- Evidence mode: qualitative
- Required encodings: 行位置表示方案；列位置表示一致的决策条件；橙色仅表示改变选择的优势或条件；边框形态区分默认决策与条件决策。
- Direct annotations: LiteLLM 默认路线；Higress 条件触发；固定单一 Gateway Base URL。
- Decision marker: LiteLLM 默认、Higress 在 K8s/高并发/SSE 条件下反超。
- Source-reference mapping: S1–S5 映射全部数据单元格、决策标记和底部读出。

## Copy map

- Figure label: Exhibit 01 · MaaS Gateway Selection
- Display title: 开源 MaaS 网关选型指南：统一管理、自动路由与稳定性对比
- Optional deck: LiteLLM、Higress、Portkey 与 New API；面向个人/小团队自托管；资料截至 2026-07-29。
- Tail recommendation: 默认 LiteLLM；已有 K8s，且高并发/SSE 稳定优先时选择 Higress。
- Visual labels: 异构接入与管理、自动路由、稳定性上限、运维门槛、选择边界。
- Source / note: S1–S5 官方文档清单、检索日期和定性判断限定。

## Deliberate omissions

- 不展示上一轮的 4.35、4.18 等主观综合分数。
- 不展示完整部署架构、成本明细和实施路线，避免形成第二个故事。
- 不比较全部新兴网关项目，只保留四个最相关候选。
- 不使用装饰性 AI 插图、厂商 Logo 拼贴和无法由来源支持的性能数字。

## Human review

- [x] 标题可在五秒内说明本图的用途与比较主题。
- [x] 具体选型建议位于尾部区域，符合“先比较、后建议”的阅读顺序。
- [x] 矩阵不依赖逐字阅读即可看出 LiteLLM 与 Higress 的选择边界。
- [x] 橙色只表示决策性差异。
- [x] 每个可见判断都映射到 S1–S5。
- [x] 原图与 480×270 缩略图均无溢出、空洞容器或伪数据图形。

Review evidence: 2026-07-29 检查 3200×1800 `poster.png` 原图及 480×270 缩略图；大标题稳定分成两行，先说明“开源 MaaS 网关选型指南”，再交代统一管理、自动路由与稳定性三个比较维度；具体建议位于矩阵尾部深色区域，原图可直接阅读，缩略图仍能辨认“先比较、后建议”的层级；全部矩阵标签、来源和限定无溢出。
