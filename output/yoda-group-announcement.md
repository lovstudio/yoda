Yoda v0.20.2 已发布。

Yoda 是给 Claude Code / Codex 等编程 Agent 配的桌面驾驶舱：多会话并行编排、任务与分支管理、用量统计、技能/提示词/自动化/团队资源库，一个 app 全收。

这版的体感变化：

- 连接 MaaS（如 GLM 这类兼容服务）时，连接状态直接显示在配置里，点开能看到详情，不再依赖开关的启停。
- 模型 ID 支持带上下文后缀（比如写 `[1m]` 表示长上下文），保存后不会丢。
- 任务分类的排序能直接拖拽调整，切换排序方向时菜单也不会再弹关。
- 顶部「+」新建和项目添加菜单，会遵循你设置的「新任务打开方式」。
- 快捷操作里的 capture 复用统一的输入流程，行为更一致。

适合已经在同时跑多个 Agent、多个 worktree、多个模型配置的同学升级。

Mac 直装：
https://github.com/lovstudio/yoda/releases/latest/download/yoda-arm64.dmg

Release Notes：
https://github.com/lovstudio/yoda/releases/tag/v0.20.2

官网：
https://yoda.lovstudio.ai

GitHub：
https://github.com/lovstudio/yoda
