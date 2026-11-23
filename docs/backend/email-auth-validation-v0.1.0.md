# 邮箱登录会话交接本地验证

版本：auth v0.1.0，2026-11-23。模块未接入当前模拟Worker或生产页面。

用户选择通用邮箱／手机验证码，第一版采用邮箱方向。正式发码拟由Cloudflare Access One-time PIN承担；backend/email-auth.mjs和client/email-session.mjs实现OTP成功后的应用会话交接，schema-auth.sql使用独立身份/交接码/会话表。本地仅用合成@example.test身份和即时生成的签名密钥，未发送邮件、未上传真实账本。

## 已实现

- 服务端仅接受固定Cloudflare团队issuer和应用aud的RS256签名，检查人类app类型、subject、白名单邮箱、iat/nbf/exp；不信任请求自报用户ID或未经验签的Access头。公钥只从配置的固定团队获取，缓存并限制未知kid刷新频率。
- /auth/complete将已验证身份映射到自己的稳定user UUID，发放60秒内的一次性交接码；固定返回原站，fragment含交接码和state，不含JWT或长期token。同邮箱换subject需人工核对，不能自动接管原账本；当前最多建立50个身份用户。
- 浏览器生成state与PKCE S256，sessionStorage仅保存待登录verifier；返回后必须先清除fragment，再用credentials:omit兑换。短期会话仅在内存中，不进入账本缓存/离线队列。
- /api/session/exchange原子消费交接码并生成会话，D1只存code/token哈希；会话默认1小时，不能晚于原Access身份到期。响应丢失时交接码不会再次兑换，需重新登录，原本地待同步编辑保留。
- 只向配置的前端origin返回CORS，OPTIONS无认证代答；实际数据请求须通过authenticate取可信user UUID。JSON读取流量限定2KB，拒绝错误请求和重放。
- logout撤销当前会话；过期会话/交接码可清理，用户身份与账本不因此删除。Access端移除席位不会实时撤销已发应用会话，须另行应用撤销或等待短期会话到期。

## 验证结果

backend npm test最终32项全通过：原后端13项、同步队列9项、邮箱交接10项。邮箱覆盖固定issuer取钥与配置、恶意签名/issuer/aud/算法/过期/机器身份拒绝、未知kid与大请求限制、固定返回地址/错误PKCE/state、并发一次性兑换、短身份期限、不同owner/同邮箱新subject拒绝、CORS/登出/过期和客户端凭据存储边界。

该验证使用本机真实Miniflare/D1和WebCrypto；SMTP／Access在线登录未测，CPU不代表Cloudflare Free实测。schema-auth.sql未应用到云数据库，路由未加入公开Worker，旧main/手机页面没有变化。

## 云端启用前提与下一步

2026-11-23只读检查当前Cloudflare Zero Trust页显示Welcome和Get started，尚未启用。官方[setup](https://developers.cloudflare.com/cloudflare-one/setup/)说明Free也要完成付款信息步骤；免费50席，不是必须升级付费。付款信息及相关条款需用户在官方页面处理，不能由代码代填，也不在聊天中收集。

启用后采用Pages官方专用路径配置仅保护/auth入口，添加OTP与首版邮箱白名单，核定团队issuer/AUD；不得先将整个生产域名保护误伤现有模拟API。再把身份映射和应用会话接到正式账本接口，完成分页历史、首次迁移与UI异步提交。需实际手机登录/邮件送达、所有别名鉴权、身份重关联与更多CPU样本验证后，再发布真实账户迁移。

后续约束更新：用户暂不提供付款信息，Cloudflare Access云端启用当前不推进。auth v0.1.0保留为已验证但未接入的候选模块，不因为本地通过就宣称邮箱登录已上线。新的免付款信息方案应复用身份隔离/会话/重放防护约定，并重新验证提供方与账号映射。

选型依据见[email-auth-feasibility.md](email-auth-feasibility.md)，其中路径组合与生产访问仍有待实测。短信需另行接入有计费的发送服务，当前未开通。
