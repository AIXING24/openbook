# Kinde 云端模拟验收 auth v0.1.6

2026-11-24。电脑端和手机Safari蜂窝网络的邮箱登录/应用会话/退出已通过。本轮只验证模拟环境；原前端v1.16.0与个人账本尚未接入。当前Pages运行bbb2f75，部署`3a38d033-5611-464f-9229-e5e2958155f6`。

## 真实链路与设备证据

电脑端使用v0.1.5完成指定测试邮箱OTP、PKCE/签名/issuer/audience/nonce/boolean verified校验、一次性交接、应用会话及 `/api/session/me` 确认；页面显示成功。退出后D1有效会话由1降0，用户/身份映射各1保留，刷新显示登录入口。首次观察到的expiry减身份创建时间为3,598,652ms，小于1小时；该首次差值不能用于后来重复登录的会话期限评估。

手机Safari在v0.1.6部署后完成同一测试邮箱登录。用户明确确认成功提示，D1对应1个有效会话，用户和身份映射仍各1，复用原归属。用户随后确认蜂窝网络退出成功；D1会话降到0。Wi-Fi尚未实测。

证据：[电脑退出前](../../backend/kinde-session-before-logout-v0.1.6.json)、[电脑退出后](../../backend/kinde-session-after-logout-v0.1.6.json)、[手机退出前](../../backend/kinde-phone-before-logout-v0.1.6.json)、[手机退出后](../../backend/kinde-session-phone-after-logout-v0.1.6.json)、[阶段报告](../../backend/kinde-cloud-verification-v0.1.6.json)。报告不含实际邮箱、subject、UUID、token或验证码。截图只在私人协作目录保存。

未提取原始应用token进行直接云端重放；云端会话删除有D1证据，旧token重用拒绝由本地认证回归覆盖。两项证据不混成一次直接云端重放测试。自有退出不代表撤销Kinde全部SSO/JWT。

## 免费CPU观察

v0.1.5的[首次用户真实登录窗口](../../backend/kinde-cloud-metrics-v0.1.5-login.json)有11请求、0运行时错误，最高分钟桶P99为10.924ms，高于Free10ms。不能因请求成功而判定该旧样本有稳定余量。

v0.1.6的[独立优化窗口](../../backend/kinde-cloud-metrics-v0.1.6.json)从官方部署创建时间起统计，覆盖基础验收、真实手机登录/兑换/会话确认及退出：**31请求、0运行时错误、最高分钟桶P99 8.283ms**，本次样本在10ms内。使用真实Pages dataset与官方schema微秒单位；不是逐请求最大值，也没有路径维度。

优化前首次创建用户、优化后复用原用户，两次负载不同；不能声称固定加速比例。新用户首次和更多冷启动仍需补测，不能把一个复用账户的结果扩大成整个工具已稳定适合免费方案。认证与账本API合并后的读写/导入/日终CPU还需端到端验收。

## 实现与本地验证

- 身份查找、必要创建和归属核验合并成一个原子批次；新subject只能关联刚创建UUID，同邮箱不同subject不自动合并，独立并发回调复用同一归属。
- 成功handoff写入与已消费浏览器事务删除合并；失败路径仍清理已消费事务。
- 新登录按索引清理过期浏览器事务、handoff、应用会话，在同批次创建新事务。访问时始终验证到期；无新登录时不承诺物理行即时删除，但没有新认证行继续累积。[清理时快照](../../backend/kinde-cleanup-proof-v0.1.6.json)保留身份且清空过期handoff。
- 沿用Workerd支持的manual redirect并拒绝3xx，不改签名、issuer/audience/nonce、邮箱白名单/verified、PKCE、10分钟事务与最多1小时会话。50人是本工具pilot边界。

完整本地检查 **49项通过**，含真实Workerd原生fetch/错误302、独立并发无孤立用户、50人边界和过期清理保留身份。[7组基础云验收](../../backend/kinde-cloud-basics-v0.1.6.json)通过，原随机mock凭据仍可读、匿名/错误交换/别名拒绝、Cron仍为空。没有新增收费资源。

## 后续

进入认证身份与模拟账本API/前端联动；真实数据迁移前核定完整性能、Wi-Fi、行情日期/历史汇率/企业行动及恢复。Kinde默认sender的Live许可、邮件发送额度/重发限速和无卡超额行为仍未核实，保持Not live和现有免费方案。没有启用真实账本迁移或真实定时任务。
