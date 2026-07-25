---
'yoda': patch
---

启用 MaaS 时通过 `auth.json` 将 Codex App 切换到平台对应的第三方 Provider 与文件型 API Key 登录，且不在 `config.toml` 中写入密钥；停用时精确恢复原始登录、凭据存储方式和配置。
