# Kinde 云端模拟部署 auth v0.1.4

2026-11-24。用户明确授权精确云端回调和测试身份在既有 Cloudflare D1 中保存。本轮只验证模拟环境，GitHub Pages 的 v1.16.0 页面与真实账本未接入。

## 已执行与通过

- Kinde 现有 public app 的 callback 增加 `https://gaintrace-batch-api.pages.dev/auth/kinde/callback`，logout redirect 增加 `https://gaintrace-batch-api.pages.dev/auth/test`，均保留 `http://localhost:3000`。保存后重载确认值持久化；未启用 Live、付费或手机号登录。
- 对既有隔离 D1 应用 `schema-auth.sql`、`schema-kinde.sql` 的 `CREATE IF NOT EXISTS`，没有删除或迁移账本表。
- 既有 Pages 配置 `kinde-test-only`、固定 issuer/client/API origin 与私密测试邮箱白名单。3个原随机模拟凭据仍为 secret。正式可用域为 [模拟邮箱登录页](https://gaintrace-batch-api.pages.dev/auth/test)，部署 ID `815f1aeb-0033-4650-bb63-2704067870a3`，运行代码 `30de881`。
- [云端基础验收](../../backend/kinde-cloud-verification-v0.1.4.json) 7组通过：连接页/登录页/模块资源200，匿名401，模拟凭据不能用于自有会话、随机自有凭据不能用于mock账本，两原模拟账户仍可访问，部署别名认证403，错误callback/外部Origin/伪造exchange被拒绝，固定Kinde S256跳转与Secure/HttpOnly/Lax cookie成立。探针仅删除自己创建的临时登录事务，Cron仍为空。
- 已从云端页面进入 Kinde、向用户明确指定的邮箱发送验证码。当前停在用户输入验证码步骤，尚未完成真实云端callback或创建云端用户/应用会话；基础验收时users/identities/active_sessions均为0。

完整43项本地检查已在auth v0.1.3通过；本轮没有修改认证运行代码，仅新增部署/验收工具和报告，不无故重复该测试。新增脚本语法检查和提交diff检查通过。

## 配置修复记录

首次回写 Pages 环境配置沿用 API 读取的secret对象，旧模拟凭据认证出现401；读取secret返回的隐藏值不能作为原值回写。已从忽略的本机0600凭据文件恢复3个原随机值并重新部署；随后两模拟账户访问200且跨凭据拒绝通过。新增 `configure-kinde-cloud.mjs` 从本机原值构造secret，并从私有环境变量接收邮箱白名单，公开代码和报告不含邮箱或凭据。不能仅凭secret_text类型判断原值已保留，必须实际认证验收。

## 免费CPU：当前只能得到初步结果

[官方采样](../../backend/kinde-cloud-metrics-v0.1.4.json) 使用真实 Pages dataset `pagesFunctionsInvocationsAdaptiveGroups`，schema说明CPU单位为微秒。02:52:39—02:56:19 UTC的23次入口请求，运行时错误0，最高分钟桶P99为5.125ms。

这不是逐请求最高CPU，也没有完整登录callback、会话兑换和退出的样本；不能把该结果、无错误或旧mock Worker的8.788ms当作全流程满足Free10ms的证明。数据按分钟桶聚合，仍需新登录完成后的采样和冷启动/重复调用验收。

## 下一步

1. 用户在已打开的官方验证码页输入OTP；不在聊天提供验证码。返回Pages后确认页面与 `/api/session/me`，在D1只输出身份映射/会话哈希的计数或布尔结果。
2. 测试退出撤销、刷新不保留内存token、旧会话重用失败，再补完整认证CPU采样。不能声称自有退出撤销了Kinde全部SSO/JWT。
3. 手机蜂窝/Wi-Fi验证完整登录。此前蜂窝仅证实连接页可达，不等同邮箱认证全流程可用。
4. 核定默认sender的Live许可、邮件发送限额/重发限速、无卡超额行为，再按实施计划推进真实行情日历/历史汇率/企业行动和前端迁移。正式个人账本尚未切换。
