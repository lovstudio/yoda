# 智能路径解析：当前对话与实现证据

## 用户原始问题

> 智能路径匹配错误：
> 「这条会话 (https://lovstudio.ai/yoda/session/yss_jwNYhuQC7vOzOuHim41RoMtQgkVwnMxkxOu8T0p5Z6Y)现在会：」
> 匹配成了
> 「https://lovstudio.ai/yoda/session/yss_jwNYhuQC7vOzOuHim41RoMtQgkVwnMxkxOu8T0p5Z6Y)%E7%8E%B0%E5%9C%A8%E4%BC%9A」
> 应该是
> 「https://lovstudio.ai/yoda/session/yss_jwNYhuQC7vOzOuHim41RoMtQgkVwnMxkxOu8T0p5Z6Y」

## 对话中形成的产品判断

> 硬换行似乎没有必要？

讨论结论：普通 xterm 软换行可直接依据 `isWrapped` 重组；Claude Code / Ink 等
TUI 也会主动写入真实换行，因此当前仍需要一层保守的“TUI 视觉折行恢复”兼容。

> 「OSC 8 超链接」是啥

讨论结论：OSC 8 是终端原生超链接控制序列。输出方直接提供可见文字、精确 URL
和链接边界，终端无需根据括号或标点猜测。xterm.js 支持
`OSC 8 ; params ; uri BEL/ST`。

> 了解，那智能匹配还是挺需要的，尤其是结合用户真实磁盘系统的路径校验（甚至辅助匹配）

这句话是本图的决策输入：智能匹配仍是普通文本、历史日志和缺少 OSC 8 元数据时的必要
兼容层；下一阶段重点应从继续堆叠正则，转向真实文件系统校验和上下文辅助解析。

## 当前实现事实（核验于 2026-07-29）

1. `src/renderer/lib/pty/terminal-file-links.ts`
   - 文件路径与 URL 共用 `buildScanChunks()`，处理 xterm 软换行和最多四段保守硬换行恢复。
   - 文件候选覆盖绝对路径、带空格绝对路径、相对路径、尾斜杠目录、Home 路径和常见扩展名裸文件。
   - `resolveTerminalFileLinkTarget()` 解析 `:line:column`，并结合 `workspaceRoot`、Home 和
     `workspaceRootAliases` 计算目标。
   - 当前解析过程没有查询真实文件系统确认目标存在。
2. `src/renderer/lib/pty/terminal-web-links.ts`
   - URL 候选支持 HTTP、HTTPS、FTP 和 file 协议。
   - 中文标点是硬边界；ASCII `()`、`[]`、`{}` 通过配对计数保留合法内容，并在未配对右括号前截断。
3. `src/renderer/lib/pty/use-pty.ts`
   - 文件路径、智能 URL 与 OSC 8 原生链接都接入终端。
   - 工作区内文件进入任务侧栏编辑器；URL 进入任务侧栏驻留浏览器。
4. `src/renderer/features/tasks/terminals/use-workspace-file-links.ts`
   - 当前 worktree 路径与主仓库 alias 已参与路径归属解析。
   - 远程项目保留 SSH connection ID，但磁盘存在性与模糊候选解析尚未形成统一层。

## 外部协议来源

- xterm.js Supported Terminal Sequences：
  https://xtermjs.org/docs/api/vtfeatures/
- xterm.js Link Handling：
  https://xtermjs.org/docs/guides/link-handling/

## 范围限定

- 本图是定性产品与系统设计 Exhibit，不展示没有实测依据的命中率、延迟或准确率。
- 本图不展开具体文件搜索算法、索引实现和性能预算。
- 本图只回答一个问题：智能路径如何从“文本猜测”升级为“真实目标解析”。
