---
"yoda": patch
---

修复"在旁边打开"并排任务时，副面板标题栏显示的是主任务的顶层 tabs：副面板（split-view extra pane）的标题栏此前直接渲染全局 `AppTabStrip`，而该 strip 永远跟随被路由的主任务。现在为任务视图引入 `hosted` 标记，副面板标题栏不再渲染全局 tab strip 与全局导航簇——副面板通过自己的侧边栏切换内容，与设计意图一致。
