# Cloudflare 免费 CPU 限制证据记录

记录日期：2026-11-24。主线程当日通过 HTTPS 获取下列官方 Markdown，后台核对 Limits 与 Pages Pricing 快照，主线程补查 Workers Pricing 与 Errors。以下更新日期来自快照的 `dateModified`，不代表抓取日期。

官方来源：

- [W：Workers Limits](https://developers.cloudflare.com/workers/platform/limits/)，页面更新日期：2026-11-19。
- [P：Pages Functions Pricing](https://developers.cloudflare.com/pages/functions/pricing/)，页面更新日期：2026-09-08。
- [Workers Pricing](https://developers.cloudflare.com/workers/platform/pricing/)。
- [Workers Errors](https://developers.cloudflare.com/workers/observability/errors/)。

核对结果：

1. **免费 10 ms CPU**：[W 的 CPU time](https://developers.cloudflare.com/workers/platform/limits/#cpu-time) 表格明确写有 `CPU time per HTTP request | 10 ms`（Workers Free）；Cron Trigger 同为 10 ms。CPU 指执行代码的时间，等待网络请求、KV 读取或数据库查询不计入，不能将其等同于请求总耗时。
2. **buffer/burst**：同节原文为每个 isolate 有 “some built-in flexibility”，允许 Worker “infrequently runs over the configured limit”；若持续触及限制，则 “its execution will be terminated”。这支持偶发超限存在弹性容忍，但快照未将其命名为 CPU buffer/burst，也未给出额度、恢复周期、次数或保证，不能据此认定可稳定使用超过 10 ms 的 CPU。
3. **CPU 超限错误**：同节明确返回 Cloudflare `Error 1102`，消息为 `Worker exceeded resource limits`；控制台显示 `Exceeded CPU Time Limits`，analytics/Logpush 的 outcome 为 `exceededCpu`。1102 也可能由内存超限引起，单凭错误码不能确定是 CPU 问题。每日请求额度超限另见 [W 的 Daily requests](https://developers.cloudflare.com/workers/platform/limits/#daily-requests)：免费计划 100,000 次/日，UTC 午夜重置，超额为 `Error 1027`；路由可配置 fail open（绕过 Worker）或 fail closed（返回 1027 错误页）。
4. **Pages 关联**：[P 的 Free Plan](https://developers.cloudflare.com/pages/functions/pricing/#free-plan) 明确写 “Requests to your Pages Functions count towards your quota for the Workers Free plan”，Pages Functions 与 Workers 共用免费每日请求额度。P 同时说明不调用 Functions 的静态资源请求免费且不限量。P 未直接重述 Pages Functions 的 10 ms CPU 限制；仅凭此价格页，对 Pages CPU 限制的直接证据不足。
5. **免费 CPU 超限与收费**：Workers Pricing 明确默认提供 Workers Free，该计划包括 Pages Functions，并将 Free 的单次 CPU 标为 10ms；Paid 为独立计划，账户最低每月5美元。结合 W 明确描述超限终止/报错，可判断当前 Free 下 CPU 超限按执行限制处理，而非按超额 CPU 自动收费。所读页面没有逐字声明“永不自动升级”；这里不是对其他服务、付费账户或未来政策的承诺，也没有再次核查账户套餐。

本记录仅保留公开政策、原文短引与官方 URL，不含账户、项目配置或凭据。
