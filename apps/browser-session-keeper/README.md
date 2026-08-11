# Yoda 会话健康

一个直接运行在真实 Chrome Profile 内的 Manifest V3 扩展。它按计划在非激活标签中打开用户配置的只读受保护页面，等待页面脚本完成，再根据最终 URL 判断当前登录状态。

## 它解决什么

- 复用当前 Chrome 的 Cookie、LocalStorage 和站点自身的静默续期逻辑。
- 对采用滑动空闲过期的站点，定期受保护请求可能延后 idle deadline。
- 发现跳转到登录页时只保留一个接管标签，并发送一次 Chrome 通知。
- 查询参数和 fragment 不进入诊断记录；扩展不读取、导出或保存 Cookie、Token、表单和页面正文。

站点仍可采用 absolute timeout、Refresh Token 总寿命、设备确认或风控复验。遇到这些边界时，扩展会进入“需要登录”，用户完成认证后后续探针会恢复。

## 安装

1. 在实际用于 Codex 的同一个 Chrome Profile 中打开 `chrome://extensions`。
2. 打开“开发者模式”，选择“加载已解压的扩展程序”。
3. 选择本目录：`apps/browser-session-keeper`。
4. 点击工具栏中的“会话健康”，添加目标并先运行一次“立即检查”。
5. 新目标默认停用。确认状态判断正确后，启用该目标，再打开“运行后台检查”。

Chrome 必须保持运行。电脑睡眠期间 alarm 不会唤醒设备；唤醒后 Chrome 会恢复后续调度。

## 目标配置

- **只读页面网址**：登录后可查看、刷新不提交业务动作的稳定页面。探针只有仍停留在同域同路径时才记为“有效”；避开付款、退款、发布、删除、提交审核等页面。
- **登录页标记**：登录后跳转地址中稳定出现的 URL 子串，例如 `/login` 或 `passport.example.com`。
- **检查间隔**：至少 1 分钟。先依据实际 idle timeout 取其约一半到三分之二，并观察是否触发额外验证。

### 腾讯云 ICP 示例

```text
名称：腾讯云 ICP 备案
只读页面：https://console.cloud.tencent.com/beian/manage/process/30178537319491747/review
登录页标记：cloud.tencent.com/login
             login.tencent.com
```

先在同一 Profile 手工完成一次腾讯云登录，再用“立即检查”确认最终状态。现有每日 ICP 巡检保持不变，本扩展只维护会话和报告登录失效，不追加巡检记录。

### 支付宝示例

选择与实际任务对应的商家后台“概览”或“查询”页面，并从一次正常过期跳转中取得稳定的登录 URL 标记。不要把收银台、付款确认、转账、退款提交页用作探针。支付宝的扫码、App 确认、人脸或 absolute timeout 仍会进入人工接管。

## 开发检查

```bash
pnpm --filter @yoda/browser-session-keeper check
pnpm --filter @yoda/browser-session-keeper test
```

策略测试覆盖登录跳转分类、跨站跳转、间隔抖动、状态证据和诊断脱敏。
