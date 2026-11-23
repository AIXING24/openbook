# Kinde 账号与本机验证准备 auth v0.1.2

2026-11-23。用户已完成 Kinde Free 管理账号及 GainTrace 业务的注册，并授权继续操作。只使用隔离测试身份；真实 App、个人账本和 Cloudflare 数据库保持原状态。

## 实际账号界面核实

- 业务名称 GainTrace，认证域名 `https://gaintrace.kinde.com`，当前环境 Production / Not live。未切换 Live。
- Plan & payments 页面显示 **Free**、固定 **$0 USD/月**、当前预估下一张账单 $0。列出的限制为 **10,500 MAU、2 个环境、2,000 M2M tokens、10 条 SMS**。这些不是邮件发送额度；界面注明账单可能随使用量变化，尚未核实无卡 Free 超额处理，不承诺自动硬停。
- Authentication 页面显示 Email Code 在 1 个应用启用；Email Password、Phone Code 和 Username 登录均为 0 个应用启用，未配置社交连接。
- Messaging / Email Sender 页面显示 **Kinde default**；自有 SMTP 未配置。该页面在 Production 环境可访问，不证明 Live 默认发信许可、生产邮件发送限额或真实送达已验收。
- 现有 My JavaScript App 类型为 **Front-end and mobile**，公开 client ID 为 `aa0b21876d724d4482f6d1af6cc8181e`。界面明确没有 client secret；允许的登录与登出回调均仍为 `http://localhost:3000`，未添加云端回调。
- 该应用显示 ID token 3,600 秒、access token 86,400 秒、refresh token 1,296,000 秒。测试不请求 offline scope，不持久化任何 provider token。

账号页截图保存在私人协作目录，不上传收件人、私有账户 URL 或个人进度文件。免费计划与默认 sender 的界面证据不替代实际登录和移动端验证。

## 公开协议与本机探针

实际读取公开 `.well-known/openid-configuration`：issuer、auth、token、JWKS、UserInfo 和 logout 路径与[官方协议调研](kinde-oidc-contract.md)一致；S256、RS256 已列出。Metadata 的 token endpoint auth methods 只列 `client_secret_post`，而应用界面及官方 PKCE 合同支持无 secret；实际兑换仍需验证，不把 discovery 列表当作已完成兑换。

新增 `backend/scripts/serve-kinde-validation.mjs`，只监听 `127.0.0.1:3000`，请求 Host 固定为 `localhost:3000`。收件人由私有环境变量 `GAINTRACE_TEST_EMAIL` 提供，不写入代码或报告。它使用现有允许回调，不创建云资源、不改线上前端、不签发生产会话。

起始表单使用 HttpOnly / SameSite=Lax cookie 与随机 CSRF；固定 Origin、state、nonce、S256 verifier，并将 cookie/交易限制为10分钟。初始页面 referrer policy 使用 same-origin（no-referrer 会使导航表单 Origin 变为 null），回调保持 no-referrer；表单仅允许本机与指定 Kinde 认证域跳转。兑换使用固定 endpoint、callback、client ID，无 secret。返回 ID token 必须通过签名、issuer、client-ID audience、nonce、时间和测试邮箱检查。身份报告只记录协议布尔值/公开字段名，不写邮箱、subject、code、verifier、JWT 或 refresh token。

源码语法与 diff 检查通过；独立本机 HTTP 验证5项通过：错误 Host、外部 Origin、错误 CSRF 均拒绝；有效起始交易有固定 issuer/callback、state/nonce/S256 且无 secret/offline scope；错误 callback state 在 token exchange 前被拒绝。检查不跟随外部跳转、不发送邮件。原32项后端/同步/Access认证检查不因这个独立未接入的探针而重复运行，其结果不能视为新的 Kinde 登录验收。

## 当前真实登录阶段与待验收项

本机表单已成功进入指定应用的 Kinde 官方邮箱登录页。用户明确指定的测试邮箱未在应用用户库登记，登录页面返回 `No account found with this email`；管理账号与应用身份独立。已打开应用测试用户注册页，等待用户确认注册并自行输入验证码。代理尚未完成真实验证码登录、token兑换、Live邮件或手机网络验收，不据此宣布邮箱登录已上线。

控制台 Send test email 操作被自动审批阻止：页面未显示收件人，按钮可能立即发送到未授权地址。未绕过该按钮；改用明确显示授权收件人的应用登录流程。注册及验证码步骤交给用户，不索取聊天验证码。

仍需：真实邮箱送达/verified email与audience合同、默认sender的Live许可与邮件限额/重发限制/超额行为、手机蜂窝和Wi-Fi完整流程、提供方适配与隔离会话、云端回调确认、认证新增CPU实测。通过后才推进原页面迁移，不把本机脚本当作生产架构。
