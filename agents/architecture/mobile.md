# Mobile

手机客户端**不在本仓库**，在 [`lovstudio/yoda-mobile`](https://github.com/lovstudio/yoda-mobile)（本地一般是
`../yoda-mobile`）。本仓库负责另外两层：桌面 connector 和公网中继。

## 三层

| 层 | 位置 | 职责 |
| --- | --- | --- |
| Client | `lovstudio/yoda-mobile` | Expo 应用，只说 wire 协议 |
| Relay | `services/relay/` | 公网中继，按路由白名单转发 |
| Connector | `src/main/core/mobile-gateway/` | 桌面 HTTP gateway，唯一能碰项目/任务/PTY 的一层 |

契约是 `packages/protocol/`，发布为 npm 包 `@lovstudio/yoda-protocol`：

- `mobile-api.ts` —— JSON API 契约
- `mobile-relay.ts` —— Relay 路由白名单与配对 URL
- `mobile-session-events.ts` —— SSE 分帧与会话失效契约

改协议要连带发版，客户端才能拿到。协议包必须零 `@shared` / `@main` import，
`packages/protocol/src/self-contained.test.ts` 守着这条。

## 架构规则

- 协议包是路由白名单的唯一来源。`services/relay/src/route-policy.ts` 从协议包 import 判定函数，
  **不要**在 relay 侧重新抄一份——新增 gateway 路由只改协议包，加上匹配的 allow/reject 测试。
- 客户端拿不到桌面 registry，凡是需要桌面知识的东西由 gateway 预计算后随响应下发：
  权限模式走 `MobileConfigurationSnapshot.accessModePermissionModes`（在
  `mobile-permission-modes.ts` 算好），Skill 命令走 skill 响应里的 `insertText`（在 `mobile-skills.ts` 算好）。
  不要把 `runtime-registry.ts` 的概念漏进协议。
- 手机只能通过 gateway 说话。不要把裸 RPC 或终端控制暴露到 gateway 上。
- Tailscale 活跃时，连接信息优先给它的 `100.64.0.0/10` 地址，这样同一 tailnet 的手机在物理 LAN 外也能连；
  LAN 地址作为回退。
- gateway 默认开启，非 health 端点必须校验 token。允许用
  `YODA_MOBILE_GATEWAY_DISABLED=1`、`YODA_MOBILE_GATEWAY_ENABLED=0`、`YODA_MOBILE_GATEWAY=0` 显式关掉。
- 桌面侧栏的移动端弹窗必须支持扫码安装与扫码连接，安装目标可用 `YODA_MOBILE_INSTALL_URL` 覆盖。
- 会话详情实时更新走带鉴权的 SSE，只发范围化失效通知，客户端重新拉取原有 detail 接口。
  不要退回几秒一次的轮询。
- 移动端读 Codex 详情只读有界的 rollout 尾部；不要为每次实时失效重新全文解析。
- 会话续接要区分「进程还在跑」（`running`/`acceptsInput`）和「会话可恢复」（`resumable`）。
  冷的可恢复会话在输入框里依然可操作：input 路由负责打开项目、provision 任务、恢复原会话，然后才注入输入。
- 图片输入走 `/v1/attachments` 分块 base64 上传，桌面把生成的文件名存在应用数据目录下并复用
  `injectConversationPrompt`；**永远不要**把手机传来的文件名当作可信的桌面路径。
  在 gateway 有明确的 SSH 传输通道之前，图片只支持本地项目。

## 本地 Metro 自启

开发模式下打开移动端连接视图时，gateway 会懒启动 Expo Metro（Metro 约 450MB RSS，所以不在启动时拉起）。
客户端源码已不在本仓库，所以必须告诉它 checkout 在哪：

```bash
YODA_MOBILE_REPO_PATH=/path/to/yoda-mobile pnpm run dev
```

没设这个变量就跳过自启并 log 一行提示——这是正常的开发配置，不是故障，gateway 照常服务已配对的手机。
其他开关：`YODA_MOBILE_METRO_DISABLED=1` 彻底关掉自启，`YODA_MOBILE_EXPO_URL` 指向别处已经跑着的 Metro。

也可以直接在客户端仓库里 `pnpm start`。

## 开发

启动桌面。开发模式下 gateway token 默认 `dev-mobile-token`，这样 Expo Go 在桌面重启后还能连上：

```bash
pnpm run dev
```

需要时用 `YODA_MOBILE_GATEWAY_TOKEN=<token>` 覆盖。打包/生产构建在未设该变量时生成随机 token。

iOS 本地联调先用 Expo Go，在 app 里手填网关地址与 token。桌面侧栏的移动端弹窗在开发模式下会给出本地
Expo Go 二维码（按 `exp://<gateway-host>:8081` 推断）。因为 Expo Go 会吃掉本地 QR 的 query 参数，
app 在开发模式下还会回退到 `http://<gateway-host>:3879` + `dev-mobile-token`。

`yodamobile://connect` 这种产品化配对需要原生构建，构建命令在客户端仓库里。

## 客户端改动的验收

界面和客户端行为的验收条件是「装进手机的 Yoda Mobile 能做什么」，不是本仓库测试通过——
详见客户端仓库的 `AGENTS.md`。本仓库改 gateway/relay 时，若改动会影响手机上的可见行为，
同样要在真机上验证一遍。
