# 不提供付款信息、不买域名的邮箱 OTP 候选

2026-11-23。按 research 技能进行窄范围官方文档核查；仅写本文件。未创建账号、进入账单、读取凭据、发送邮件／短信、修改云资源或 commit／push。本文的“已核实”仅指公开文档，不代表本项目已配置或完成生产登录。

用户已拒绝 Cloudflare Zero Trust 所需付款信息。前端继续使用 `https://aixing24.github.io/openbook/`，API／Free D1 继续使用 `https://gaintrace-batch-api.pages.dev/`；API 的蜂窝网络可达性由用户提供。生产保持原状。此前 Access、Clerk、Supabase 默认 SMTP、Firebase Spark 邮件链接的限制见 [email-auth-feasibility.md](email-auth-feasibility.md)，本次不重新推荐。

## 唯一建议：下一步只验证 Kinde Free

**Kinde Free 是最值得用户下一步创建免费账号核验的候选：官方同时列出无需信用卡、免费生产环境、默认 `*.kinde.com` 登录域名、邮箱无密码 OTP 及 Kinde 默认发信。暂不宣布“已满足全部约束、可以上线”。** 尚缺默认发信的明确额度／限速，以及下述生产 SMTP 文档措辞的澄清；不再扩展供应商扫描。[K-Price] [K-Domain] [K-OTP] [K-Sender] [K-Live]

| 核查项 | 官方依据与边界 |
|---|---|
| 付款信息 | 定价明确 Free 为 `$0 forever`、`No credit card required`；入门流程只有账号邮箱验证、业务名、Kinde 子域、地区和应用／登录方式，没有付款步骤。无需启用 Kinde 的收款／Stripe 模块；本次没有执行实际注册，不能证明当地账号不会出现额外审核。[K-Price] [K-Start] |
| 免费规模与生产 | Free 含 **10,500 MAU、1 个 production + 1 个 non-production 环境**，邮箱 passwordless 为 Included。MAU 是用户额度，不是发送邮件额度。定价的通用 FAQ 提及超额收费，但没有清楚说明无卡 Free 超限时的具体行为，因此不承诺超限仍可用或自动硬停。[K-Price] |
| 不买域名 | 注册时分配 `yourbusiness.kinde.com`；生产 checklist 把自定义域名列在 **Recommended steps**，用途为品牌体验，未列为必需。GitHub Pages 与 Pages API 地址无需因此更换。[K-Domain] [K-Live] |
| 数字邮箱 OTP | Passwordless 文档明确使用手动输入的 one-time passcode，并明确不以 magic link 替代；新业务默认启用 email + passwordless。官方默认码有效期为 **2 小时**；定价表的 Custom OTP/MFA code expiration duration 在 Free 为 Not included，不能承诺免费缩短为 5–10 分钟。本次没有核实具体位数、字符集、重发后旧码的处理方式，下一步需核对实际模板／行为。[K-OTP] [K-Price] |
| 通用用户／默认发信 | SMTP 配置文档明确：不配置自有 sender 时，注册、登录、OTP、密码重置邮件来自 **`no-reply@kinde.com`**；没有把该说明限定为团队成员收件箱。交付文档说明 Kinde 负责路由和监控默认邮件；新用户注册流程不要求先购买域名或注册邮件 API。[K-Sender] [K-Delivery] [K-OTP] |
| 生产与开发区别 | 最新 production checklist 把自定义 sender／SMTP 放在 **Recommended steps**，且明确 Live switch 不发布应用、不改变应用行为，关闭时应用也能 live。但 SMTP 配置文档又写 **“You need to set up provider details before making your environment live”**。上下文可能仅指启用自有 SMTP 时须先配好；该解释仍是推断，不能拿开发环境成功发信当生产默认 sender 的完整证明。需用户在 production 配置中确认，或取得官方明确答复。[K-Live] [K-Sender] |
| 发信额度／限速 | 已读定价、OTP、sender、deliverability 文档未找到默认邮箱发信的日／月额度、每地址重发间隔、全局发送限速。**未知，不写成 unlimited，也不按 10,500 MAU 换算登录次数。** 官方 Management API 的 rate limits 是管理接口限制，不能代替邮件额度。[K-Price] [K-OTP] [K-Sender] [K-Delivery] [K-Rate] |
| 防猜码与送达 | 默认 brute-force 设置为 **5 次失败后锁定 5 分钟**，失败包含错误 OTP；与“邮件发送限额”不是同一项。官方承认垃圾箱／企业隔离等送达问题，Google Workspace 扫描可能延迟约 4 分钟。未验证 QQ／163 等目标邮箱及用户蜂窝网络对 Kinde 域名的可达性。[K-Attack] [K-Delivery] |

## 已扫描的另一条路线为何没有成为推荐

只保留会影响选择的证据；未解决的条件不算通过。

| 已读候选 | 收敛结论 |
|---|---|
| Auth0 托管登录＋默认邮件 | 官方 Email OTP 文档明确内置 SMTP **“designed solely for testing purposes”**。生产仍需自己的邮件 provider，无法用默认邮件直接满足本题；不继续核查其 Free MAU／注册步骤。[A-OTP] |
| Stytch 托管认证／邮件 API | 官方 Messaging 文档区分 Live `login@stytch.com` 和 Test `login@stytchtest.com`；Email OTP API 文档存在生产服务器定义，但样例使用 Test 与 sandbox，不能仅凭服务器定义证明账号已获得生产 OTP 权限。定价有免费用量，但本次未同时证明 **无付款信息启用 Live、Consumer 邮箱 OTP 的生产权限和发送额度**，故不宣布可用、不继续查。[S-Messaging] [S-OTP] [S-Price] |
| SMTP2GO 单 sender＋自建 OTP | 官方有 **1,000 封／月、无需信用卡、长期 Free**；但同一公开定价页的注册入口明确拒绝 Gmail／Yahoo 等公共域邮箱，要求 **private-domain work email**，并显示手机号 SMS 账号验证步骤。没有私有域邮箱的用户不能据“可验证单 sender”推断可注册；本次单 sender 支持文档也未成功取得，不作推荐。[M-SMTP2GO] |
| Mailjet 单 sender＋自建 OTP | Free 明确 **6,000 封／月、200 封／日、无需信用卡注册**，含 API／SMTP；sender 概览允许验证地址或域名。但同页写需要 SPF／DKIM DNS，Getting Started 明确 Step 2 **Verify Your Domain**。本次未证明仅验证公共邮箱 sender 即可生产发信，也未证明免域名时的 From 改写／DMARC 行为。**不能把“地址验证接口存在”当成免域名生产可用。** 若用该路线，仍需新免费账号、API Key＋Secret Password、受认可的 verified sender，以及自己的 OTP／会话实现。[M-Price] [M-Sender] [M-Start] |

Brevo 未继续展开；已有一个值得核验的 Kinde 候选，本次收敛调查范围以推进实际账号验证。上述扫描不代表这些服务永久不可用，只代表本次未形成更完整的免付款／免域名生产证据。

## 给用户的具体下一步（本次未执行）

1. **仅创建 Kinde Free 账号**，使用用户自己的可收信邮箱完成账号 OTP 验证，选择地区和一个 `*.kinde.com` 子域；创建 email passwordless 应用。若出现要求付款信息的步骤，停止，不进入付费试用／升级。官方入门顺序见 [K-Start]。
2. 在 **production 环境**核对默认 `no-reply@kinde.com` 是否可保留且无需外部 SMTP；核对 Free 计划身份。先查看界面／官方支持答复，不由研究代理发送测试邮件。确认默认 sender 的生产许可、日／月额度、每地址／全局限速及 Free 超额行为；这些若仍未知，保持“候选待确认”，不开始上线。2 小时默认码有效期也需用户接受。
3. 只有上述条件得到确认，才推进提供方接入和真实邮件验收；实际发码应使用用户指定的测试邮箱。未来可采用托管 OTP 顶层登录 → Pages 后端校验身份 → 自有 D1 短期会话；默认 provider 方案**不需要另开邮件服务账号、邮件 API secret 或验证自己的发件地址**。服务端 OAuth 应用会需要 Client ID／Client secret，secret 只放后端；本次没有生成、查看或读取它们。托管界面会离开当前页面，不能承诺在现有表单内嵌原样验证码体验。

现有 Cloudflare Access 专用认证不能因为 Kinde 也发 JWT 就原样替换；后续需要独立适配提供方、会话与用户账本隔离。当前前端、API、D1 和生产认证配置均未修改。**本次没有发送任何邮件或短信；用户下一步账号验证产生的邮件属于用户后续操作。**

## 官方来源

均为本次实际读取的供应商官方页面；未用社区帖子、聚合比较或第三方博客补齐缺项。

[K-Price]: https://www.kinde.com/pricing/
[K-Start]: https://docs.kinde.com/get-started/guides/first-things-first/
[K-Domain]: https://docs.kinde.com/manage-your-account/your-data/kinde-domains/
[K-OTP]: https://docs.kinde.com/authenticate/authentication-methods/passwordless-authentication/
[K-Sender]: https://docs.kinde.com/get-started/connect/customize-email-sender/
[K-Delivery]: https://docs.kinde.com/authenticate/authentication-methods/email-deliverability/
[K-Live]: https://docs.kinde.com/build/environments/production-to-live/
[K-Attack]: https://docs.kinde.com/build/set-up-options/attack-protection/
[K-Rate]: https://docs.kinde.com/developer-tools/kinde-api/api-rate-limits/
[A-OTP]: https://auth0.com/docs/authenticate/passwordless/authentication-methods/email-otp
[S-Messaging]: https://stytch.com/docs/resources/policies/messaging/overview.md
[S-OTP]: https://stytch.com/docs/api-reference/consumer/api/otp/via-email/login-or-create-user.md
[S-Price]: https://stytch.com/pricing
[M-SMTP2GO]: https://www.smtp2go.com/pricing/
[M-Price]: https://www.mailjet.com/pricing/
[M-Sender]: https://dev.mailjet.com/docs/email-api/senders-domains/senders-domains-overview
[M-Start]: https://dev.mailjet.com/docs/email-api/getting-started/prerequisites
