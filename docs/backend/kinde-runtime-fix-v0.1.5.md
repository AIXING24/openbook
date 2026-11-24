# Kinde 原生运行时回调修复 auth v0.1.5

2026-11-24。用户完成云端OTP后，Pages显示“登录未能完成”，D1没有生成用户/会话。尚不能声称云端真实登录通过。

## 原因与修复

`providerJson`原使用`redirect: "error"`。Node支持这个参数，但Cloudflare Workers / Workerd只支持`follow`或`manual`，请求会在发送之前抛TypeError。之前认证单测注入了fetch替身、Pages入口检查在Node调用模块，没有穿过原生运行时的实际fetch边界，因此46项新增前的43项检查遗漏了这个差异。

最小Workerd原生探针用固定公开地址和无效参数复现“Invalid redirect value”错误；新`kinde-workerd.test.mjs`运行真实Pages模块及原生fetch，网络只使用官方Miniflare fetchMock合成响应，无外部发信、无真实身份。修复前有效合成IDtoken回调仍返回gt_error，修复后得到handoff并兑换应用会话，意外的302兑换响应仍被拒绝。

修复仅将参数改成`manual`，沿用`response.ok`拒绝3xx。不修改签名、issuer、audience、nonce、邮箱验证、PKCE、会话期限和登录事务10分钟期限。

## 验证与清理

新增原生运行时3项检查通过，完整`npm test` **46项通过**。脱敏结果见[运行时报告](../../backend/kinde-runtime-verification-v0.1.5.json)。临时模拟阶段诊断代码已移除；仅为本轮创建的`gt_kinde_diagnostics`表已清理，身份/会话/账本表未删除。早前临时诊断部署的CPU不能用于最终性能结论。

## 尚待云端确认

部署修复候选后需使用新的浏览器登录事务完成OTP，再验证D1稳定身份映射、应用会话、退出撤销、刷新行为与完整流程CPU。当前仍只模拟环境，真实前端和个人账本没有接入。手机蜂窝/Wi-Fi完整登录、默认sender的Live许可、发送额度/重发限速和无卡超额行为仍待核定。
