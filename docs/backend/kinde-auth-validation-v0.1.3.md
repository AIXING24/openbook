# Kinde 邮箱登录与隔离模块 auth v0.1.3

2026-11-24。用户完成独立测试用户注册和邮箱验证码登录。本次只读的实际回调报告见 `backend/kinde-local-verification-v0.1.3.json`，截图在私人协作目录 `kinde-login-verified.jpg`，不上传任何邮箱地址、subject、code、verifier 或身份令牌。

## 实际通过的边界

本机使用现有 Kinde Public / Front-end and mobile 应用，原允许回调 `http://localhost:3000`。无 client secret 的 PKCE 兑换通过，实际 ID token 的签名、精确 issuer、client-ID audience、nonce、时间和用户指定测试邮箱匹配检查通过；`email_verified` 为布尔值 true，amr 为 email。没有调用 UserInfo，没有签发 GainTrace 生产会话，没有迁移或读取账本。本机验证服务器已关闭。

这解决了[协议调研](kinde-oidc-contract.md)中该次真实登录的 audience/verified email 疑问：不需要把 issuer-domain audience 当作 client-ID 的替代。公开报告未保存原 token，也未保存具体 audience/azp值；不能扩大成所有 Kinde 客户端配置的保证。

默认 sender 界面是 Kinde default，本次用户已完成该环境的收信验证；没有检查邮箱中的 From 字段、发送时延或垃圾箱情况，也没有核实 Live 开关下的默认 sender 许可、邮件发送额度/限速或无卡超额行为。尚未验证手机上的完整认证与 Cloudflare 新认证 CPU。

## 本地隔离模块

- `backend/kinde-auth.mjs`：固定 HTTPS issuer/client/callback、S256、server nonce、短期浏览器绑定 cookie，OAuth事务原子消费；ID token严格验签、client audience/azp、nonce、时间、邮箱白名单和 boolean verified；稳定 `(issuer,subject)` 映射，匹配邮箱不自动合并账户。
- `backend/schema-kinde.sql`：独立短期 OAuth 事务表，和既有 `schema-auth.sql` 配套；服务端 verifier 只在该短期后端表存储，完成或过期后删除。Cookie/会话/handoff token仅存哈希。表当前仅在本机 Miniflare 测试创建，未执行远程 SQL。
- 返回前端的是60秒一次性 handoff，与前端 PKCE/state绑定；应用会话最多1小时且不超过provider身份到期。退出撤销自有会话，不能据此声称provider SSO/JWT全部撤销。会话不写入账本或离线队列。
- `backend/kinde-pages.mjs` 和 `client/kinde-validation.mjs`：专用 `/auth/test` 登录页与 `/api/session/me` 自有会话检查；只有明确设置测试模式及私有邮箱白名单才启用。未配置返回503，认证路由拒绝生产/预览别名。既有连接页和随机测试secret保护的mock API继续独立。
- `backend/scripts/build-kinde-pages.mjs` 和 `backend/wrangler.kinde.example.json`：候选构建已准备，私有授权邮箱不出现在示例配置/前端/代码中。

完整 `npm test` 在允许本机端口的环境运行，**43项通过**（原32项+Kinde10项+Pages入口1项）。覆盖假签名、错误issuer/aud/azp/nonce/verified email、未知kid取钥限流、错误cookie/state/重复字段/过期事务、并发callback及handoff只能一次获胜、前端PKCE/CORS、账户映射冲突、会话期限与退出、未配置拒绝/别名隔离。初次受限沙箱因Miniflare绑定本机端口EPERM失败，允许端口后通过；不能把环境错误算成代码测试通过。候选Pages bundle成功，diff检查通过；未重用旧mock后端CPU结果作为认证性能结论。

## 云端模拟下一步（尚未执行）

需要在既有 Kinde public app 只增加精确 callback `https://gaintrace-batch-api.pages.dev/auth/kinde/callback`，logout redirect `https://gaintrace-batch-api.pages.dev/auth/test`，保留原本机回调。然后为既有隔离Cloudflare Pages/D1配置候选模块、私有测试邮箱白名单和新auth表，部署后从 `/auth/test` 验证登录/退出/刷新/网络与CPU。届时Cloudflare后端会接收并保存测试身份的issuer/subject及邮箱，应用会话仍只存token哈希；这个新接收方与权限回调改变需要在实际操作时由用户确认。

尚未更改Kinde回调或启用Live，没有上传实际测试邮箱到Cloudflare，也未部署候选到公开Pages。生产main、GitHub Pages前端、个人账本保持原状态；正式迁移、分页历史和新日终行情规则仍按实施计划推进。

Pilot 仅允许最多50个指定邮箱/账户，OAuth同时待处理事务最多100并按10分钟清理。该容量边界不是按客户端/地址的完整防滥用策略，公开多用户上线之前仍需独立的请求限速及邮件额度核定。当前只做有授权的模拟验收。
