# GainTrace 邮箱／手机 OTP 登录可行性

2026-11-23。独立调研，仅查官方公开文档；未读取凭据、检查账号、注册服务、发送邮件／短信或修改云资源。
约束由用户提供：前端保留 https://aixing24.github.io/openbook/；Workers + D1 Free API 使用 https://gaintrace-batch-api.pages.dev/，用户蜂窝网络可访问，workers.dev 不可访问；无自有域名、无 Resend／短信服务账号。
下文“已核实”指官方文档能力，不代表当前项目已配置或手机已完成登录实测；“提案”中的云端设置尚未实施。调研后auth v0.1.0已实现独立的验签/PKCE/一次性会话交接并完成本地验证，仍未接入公开路由，见[email-auth-validation-v0.1.0.md](email-auth-validation-v0.1.0.md)。

## 当时建议与最新约束

2026-11-23用户明确暂不提供付款信息，因此下述Cloudflare Access建议当前不采用。保留它的官方能力与实现证据，后续免付款信息选型另见auth-without-payment-info.md；不会反复要求用户启用Zero Trust。

**小规模第一版采用 Cloudflare Access 邮箱 OTP，只保护生产 Pages 的 `/auth` 登录入口；后端验签后交接为 GainTrace 自己的短期会话，账本 API 验证 Bearer 会话。** 无须购买域名或另开邮件发送账号，保留现有前端和 Pages API 地址。
这是有条件可行：必须完成 Zero Trust 激活并提供付款信息，用户规模受 50 席限制，还需实现会话交接和账本隔离。当前用户不接受付款信息步骤，因此不继续该流程；本次已核查的 Supabase／Clerk／Firebase没有完整满足原约束的生产数字邮箱 OTP方案，仍可进一步查其他供应商，不能把这三个候选的限制扩大成所有服务都不可行。

## Cloudflare Access：已核实

- **能保护生产 `项目.pages.dev`，并非只能保护预览。** Pages 的普通“Enable access policy”默认只保护 `<hash>.<project>.pages.dev`；官方另有生产域名操作：启用预览 Access → Manage 对应应用 → Public hostname 的 Subdomain 删除 `*` → Save。此时生产 `项目.pages.dev` 被保护；重新启用预览策略可同时保留两套应用。[CF-Preview] [CF-Pages]
- 普通 Self-hosted 应用教程要求账号内有 active zone；这不能用来否定上述 Pages 专用入口。当前无自有域名应采用 Pages 生成应用的官方路径，而不是假定手动添加任意 pages.dev 域名即可成功。[CF-Self] [CF-Pages]
- Access 支持限定 URL 路径；`/auth/*` **不匹配 `/auth` 本身**，更具体应用优先且不继承上级策略。把 Pages 生成应用限制为 `/auth` 及所需子路径，属于结合两份文档的提案，尚未在此账号验证。[CF-Paths]
- 邮箱 OTP 由 Cloudflare 发送，发件人为 `noreply@notify.cloudflare.com`；PIN 10 分钟过期、单次使用，重发使旧码失效，仅向符合策略的邮箱发送。新 Zero Trust 组织需主动添加 One-time PIN，不应假定默认启用。[CF-OTP]
- 可接受一般邮箱：官方列出的 Allow → Include → Login Methods → One-time PIN 接受所有有效 OTP 邮箱；用户不必成为 Cloudflare 账号成员。个人版可改用邮箱白名单。此处是有意选择开放邮箱策略，仍应由后端控制是否创建账本。[CF-Policy]
- **Free 为 $0，50 个用户上限**；依据当前官方定价页及其公开定价数据中的 `50 user limit`，付费按需计划列为 $7/user/month。[CF-Price] [CF-PriceData]
- 按身份占席，不按请求数／并发数／每月 MAU：一次 Access 登录即占一席，同一用户访问多个应用只占一席；默认持续占用直至移除，满席后新用户登录被阻止。可配置闲置席位到期，不能据此承诺无限免费用户。[CF-Seats]
- **Zero Trust 免费也要求付款信息**：官方 onboarding 明确“Free plan…this step is still needed but you will not be charged”。需 Cloudflare 账号、team name、选计划并完成付款信息步骤；已有 Workers／Pages Free 不证明 Zero Trust 已激活。[CF-Setup]
- “必须绑定信用卡”表述过强：Cloudflare 通用付款文档也列出借记／信用卡、PayPal、钱包等；实际 Zero Trust 免费结账可选方式和当地卡是否通过未核实。能确认的是不应承诺无需付款方式。[CF-Payment]

## 跨域与 `/auth` 交接：事实及提案

**已核实的直接跨域问题：** GitHub Pages 与 Pages API 跨站。Access 浏览器认证使用 `CF_Authorization` Cookie；未登录的 fetch 会遇到登录跳转／CORS 错误；即使已登录，预检 OPTIONS 不带 Cookie，默认被 Access 返回 403。官方支持旁路 OPTIONS 或代答预检，但第三方 Cookie 仍可能被浏览器隐私设置阻止。[CF-CORS]
官方“Worker 加 service token”示例要求两个站点都在 Access 后面，与当前 GitHub Pages 前端不匹配；机器 service token 也不能代替逐用户账本身份。[CF-CORS] [CF-Token]

**提案流程：**

1. 前端生成随机 `state`、PKCE verifier／S256 challenge，verifier 暂存于本页的 sessionStorage；以顶层导航进入 `https://gaintrace-batch-api.pages.dev/auth/complete`，附带 state／challenge。采用顶层登录，避免登录依赖第三方 Cookie。
2. 仅 `/auth` 相关路径由 Access OTP 保护。Pages Function 收到 `Cf-Access-Jwt-Assertion` 后，用固定团队的公钥验签；验签失败立即拒绝，不因头存在或 JWT 可解码而放行。
3. 成功后生成约 60 秒有效、仅一次可兑换的随机交接码，D1 保存其哈希、用户、PKCE challenge、state 和到期时间；重定向到固定允许的 `https://aixing24.github.io/openbook/`，fragment 仅带交接码／state。**不在 URL 放 Access JWT、长期 token 或任意用户提供的返回地址。**
4. 前端核对 state，并立即清除 fragment；POST 到未由 Access 拦截的 `/api/session/exchange`，提交交接码和 verifier。后端原子核销交接码并验证 PKCE，发放自己的短期、不透明 Bearer 会话，D1 只存会话 token 哈希。
5. 后续 `/api/*` 使用 `Authorization: Bearer …`，后端每次检查会话有效期／撤销状态并从可信身份确定账本 owner。会话到期不晚于原 Access JWT；重新登录通过 `/auth`，初版不发无期限刷新凭据。

**验证和隔离要求：**

- 官方验签要求：RS256 签名、固定 `iss=https://<team>.cloudflareaccess.com`、`aud` 包含指定 `/auth` 应用 AUD、`exp` 未过期、`nbf` 不在未来；固定团队 JWKS 地址 `/cdn-cgi/access/certs`，按 kid 缓存／刷新，不能信任 token 自带 issuer 指定取钥地址。Pages 有官方验签插件。[CF-JWT] [CF-Plugin]
- 只接受人类身份的 `type=app`、非空 sub／已验证 email，拒绝机器 service token。Access 的 sub 在用户被移除后重新添加时可能改变；D1 使用自己的永久用户 ID，保留经过验证的邮箱／外部身份映射并制定重关联规则，不能把席位移除当删除账本。[CF-Token]
- API 的 CORS 仅允许 **origin `https://aixing24.github.io`**，不是含 `/openbook/` 的 URL；允许必要方法以及 Authorization／Content-Type，返回 `Vary: Origin`，OPTIONS 可无认证代答，实际数据请求仍必须验会话。CORS 不代替授权，不接受客户端自报 email／userId 作为账本归属。[CF-CORS]
- 交接码兑换和会话放行使用短期 Bearer、`credentials: omit`，不依赖跨站 Cookie；前端尽量仅内存持有会话。交接响应禁缓存，兑换限速；登出／封禁撤销 D1 会话。只验离线 JWT 不会自动同步 Access 的实时撤销，此提案需自行处理。[CF-JWT] [CF-Seats]
- `/api` 在 Access 外的含义是 **由应用会话认证**；所有账本路由和生产／预览／其他别名都必须经过同一校验。不得仅保护登录页就把现有 mock API 当作安全账本。

## 其他邮箱方案：已核实

| 提供方 | 免费／域名／发送能力 | 对当前约束的结论 |
|---|---|---|
| Supabase Auth | 有邮箱数字 OTP；默认 SMTP 只向项目组织团队成员发信，目前 2 封／小时，官方明确非生产用途；一般用户需自配 SMTP。[SB-SMTP] | Auth 本身不要求自有域名也不足以解决一般邮箱送达；无发送服务账号时受阻。不能拿免费 MAU 额度当邮件发送额度。 |
| Clerk | Hobby 免费、无需信用卡、每应用 50,000 MRU，含六位邮箱码；生产部署明确要求自有域名且能添加 DNS 记录。[CL-Price] [CL-Prod] | 域名是实质阻碍；开发实例能发邮件不证明满足生产要求。 |
| Firebase Auth | Spark 无需付款信息；邮箱无密码方式是邮件链接，默认使用 `PROJECT_ID.firebaseapp.com`，可允许现有前端域名；Spark 发送登录链接仅 5 封／日，超过需账单支付工具。[FB-Plans] [FB-Link] [FB-Limits] | 无自有域名可用的低量邮件链接方案，但不是用户要求的数字邮箱 OTP；不能宣称是等价替代。 |

若后来选用第三方身份 token，Pages 后端仍须用提供方固定公钥、issuer、audience 和期限验签，并按可信用户 ID 隔离 D1。Firebase 官方明确可用第三方 JWT 库验证 ID token，无需把 Admin SDK 私钥放前端；普通验签不检查 token 撤销。[FB-Verify]

## 短信：当前价格及免费限制

- **Firebase：真实验证码 SMS 仅 Blaze 付费计划开放**，Spark 不支持；Blaze 要关联账单账号。Identity Platform 官方 SMS 价格为每日前 10 条不计费，之后中国 CN $0.01／条、美国 US $0.01／条；按发送计费，不是验证码成功后计费，也不是无需付款方式的免费短信。地区允许策略／reCAPTCHA 和手机号限速仍适用；测试号码固定码不发送真实短信。[FB-Limits] [FB-Plans] [FB-SMS] [FB-Phone]
- **Clerk：Hobby 不含 SMS，需 Pro 或更高计划并另收 SMS 费**；当前美国／加拿大 $0.01／条，国际地区 market rate，不能据此给中国报同价。Pro 页面列年付折算 $20／月，短信并非免费邮箱额度的一部分。[CL-Price]
- **Supabase：需另配 MessageBird／Twilio／Vonage 等短信服务**，并承担该服务的费用；免费 Auth 不包可向任意真实手机号发送的短信，固定测试码不能当生产 OTP。[SB-Phone]

## 实质阻碍与验证边界

推荐成立的前提：接受 Zero Trust 所需付款信息、首版保持 ≤50 席、实际完成 Pages 生产 `/auth` 路径配置和应用会话实现。若任一前提不接受，应先放宽约束，而不是改选同样受阻的供应商。
已知 Pages API 在用户蜂窝网络可达，不证明 `<team>.cloudflareaccess.com` 登录页／公钥域名、邮件送达或其他供应商域名可达。上线前必须用该手机网络完成一次完整登录与跨域兑换，并验证错误／过期 JWT、交接码重放、跨用户账本读取拒绝、登出／封禁及所有别名一致鉴权。
还需在 Workers Free 实测验签与 D1 会话查询的 CPU／配额；本次没有改资源或迁移真实账本，所有交接流程均为待验证提案。

## 官方来源

文中链接均指向供应商官方原文；Cloudflare 免费席位同时核对了定价页的公开 JSON 数据。

[CF-Preview]: https://developers.cloudflare.com/pages/configuration/preview-deployments/
[CF-Pages]: https://developers.cloudflare.com/pages/platform/known-issues/#enable-access-on-your-pagesdev-domain
[CF-Self]: https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/
[CF-Paths]: https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/
[CF-OTP]: https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/
[CF-Policy]: https://developers.cloudflare.com/cloudflare-one/access-controls/policies/#include-all-valid-emails
[CF-Price]: https://www.cloudflare.com/plans/zero-trust-services/
[CF-PriceData]: https://www.cloudflare.com/page-data/plans/zero-trust-services/page-data.json
[CF-Seats]: https://developers.cloudflare.com/cloudflare-one/team-and-resources/users/seat-management/
[CF-Setup]: https://developers.cloudflare.com/cloudflare-one/setup/
[CF-Payment]: https://developers.cloudflare.com/billing/get-started/create-billing-profile/
[CF-CORS]: https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/cors/
[CF-JWT]: https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/
[CF-Token]: https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/application-token/
[CF-Plugin]: https://developers.cloudflare.com/pages/functions/plugins/cloudflare-access/
[SB-SMTP]: https://supabase.com/docs/guides/auth/auth-smtp
[SB-Phone]: https://supabase.com/docs/guides/auth/phone-login
[CL-Prod]: https://clerk.com/docs/guides/development/deployment/production
[CL-Price]: https://clerk.com/pricing
[FB-Plans]: https://firebase.google.com/docs/projects/billing/firebase-pricing-plans
[FB-Link]: https://firebase.google.com/docs/auth/web/email-link-auth
[FB-Limits]: https://firebase.google.com/docs/auth/limits
[FB-SMS]: https://cloud.google.com/identity-platform/pricing#for-phone-authentication-and-multi-factor-authentication
[FB-Phone]: https://firebase.google.com/docs/auth/web/phone-auth
[FB-Verify]: https://firebase.google.com/docs/auth/admin/verify-id-tokens
