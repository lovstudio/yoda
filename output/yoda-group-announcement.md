Yoda v0.20.1 已发布。

Yoda 是给 Claude Code / Codex 等编程 Agent 配的桌面驾驶舱：多会话并行编排、任务与分支管理、用量统计、技能/提示词/自动化/团队资源库，一个 app 全收。

这版的体感变化：

- 多了一个独立的看板窗口，可以单独拖到一块屏上，直接看每个 Agent 的终端画面，按状态和项目筛选，只看不打扰正在跑的会话。
- 任务就是会话，中间那层概览没了，点进去直接干活。
- 底部运行栏重做，新增 dsh-TUI 客户端；用量卡片能看到额度、这个月花了多少和估算成本。
- 分享出去的会话链接保留完整历史，并带上 token 与成本；失败时会告诉你真正的原因。
- 会话状态判断更准：tmux 重绘、恢复中的 Claude、已经结束的回合，都不会再被误判成「被中断」。
- 设置页按会话生命周期重排，会话摘要和提示词改写可以单独关掉；新增 AI 日志，能看清每次 AI 调用内部发生了什么。
- 手机端同步支持局域网和中继双通道、多端点自动切换，换 Wi-Fi 后能自己找回桌面端。

适合已经在同时跑多个 Agent、多个 worktree、多个模型配置的同学升级。

Mac 直装：
https://github.com/lovstudio/yoda/releases/latest/download/yoda-arm64.dmg

Release Notes：
https://github.com/lovstudio/yoda/releases/tag/v0.20.1

官网：
https://yoda.lovstudio.ai

GitHub：
https://github.com/lovstudio/yoda
