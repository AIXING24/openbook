# GainTrace Cloudflare 云端模拟验证

日期：2026-11-23。结论：迁移、同步和关闭页面后的定时落库在真实云端可行；**当前原型尚不能通过免费方案的稳定运行验收**。主要障碍是完整导入、批量日计算的 CPU，以及当前网络对 workers.dev 的默认访问。

## 实际环境与范围

- Cloudflare 控制台已核实 Current plan 为 Free，$0，100,000 请求/日、10ms CPU/请求；没有升级或购买服务。
- 独立 Worker：`gaintrace-free-validation`；独立数据库：`gaintrace-free-validation-db`。没有修改 GitHub Pages 的 GainTrace 页面，没有读取或上传真实账本。
- D1 使用 APAC 提示，实际查询响应为 KIX；这不保证香港位置。
- Alice：初始 1000 笔模拟交易、50 个标的，含 1 个清仓标的、2 个旧采集快照。Bob：100 笔、10 个标的。修订与并发实验后 Alice 为 1002 笔。
- 正式登录尚未实现。原型使用本机生成的独立随机测试密钥及 Workers secrets；公网无凭据、公开旧 mock token 和账户 token 访问管理测试接口均被拒绝。

## 功能结果

真实 Worker + 远程 D1 验证了未完整上传不切换、分段续传、重复提交、冲突拒绝、保留原交易与设置、独立账户、已有云数据不被另一份备份覆盖、离线队列与丢响应重试、并发版本控制、旧快照保留、回溯修订与归档、缺行情/汇率/未收盘行情不生成确认值、补算恢复。

Cloudflare 的真实 Cron 独立生成了模拟估值日 2026-11-23 和 2026-11-24 的两账户记录。观察依据是 scheduled 处理器写入的 scheduledTime、Cron 字符串和 D1 中新增点；最新模拟日没有通过手动 run 接口计算。前端没有参与。2026-11-24 是人为设置的模拟日期，不是真实市场收盘记录。

本地原型的 17 项场景在优化后再次通过，云端优化复测的账本、旧快照和历史盈亏比较也通过。原型离线队列仅在内存；正式版仍需 IndexedDB 持久化。

## 免费额度实测

CPU 来自 Cloudflare 官方 GraphQL `workersInvocationsAdaptive`，单位经官方 schema 确认为微秒，以下除以 1000 转为毫秒。网络耗时和 D1 SQL duration 没有被当作 Workers CPU。

| 项目 | 结果 | 判断 |
| --- | --- | --- |
| 完整导入阶段，1000 笔 | 出现 78.524ms 峰值 | 未拆分；不满足 10ms 的稳定设计目标 |
| 优化后读取完整账本，10 次 | 分秒桶最大 CPU 4.421—7.062ms | 本次样本内低于 10ms |
| 优化后交易局部修改、重复重试及最终读取 | 分秒桶最大 CPU 5.212—8.844ms | 本次样本内低于 10ms |
| 优化后日计算测试阶段，两账户批次 | 出现 16.665—27.055ms 的计算峰值 | 仍需按账户/日期或更小单位拆分 |
| 远程 D1 文件 | 1,064,960 字节，约 1.02MiB | 当前存储量很小，包含模拟账本、暂存块及历史 |
| 本次 HTTP 指标 | 141 请求，运行时 errors=0 | 包含授权拒绝等测试；不等于 HTTP 全部成功，也不代表长期稳定 |

分秒桶可能聚合多个请求，表中不是整体 P99 或每个请求的完整分布。日计算阶段有单独计算请求的 16.665ms 记录，已足以证明这一批次超过 10ms。Cron 专用 `workersInvocationsScheduled` 本次返回空，不能宣称已取得 Cron 自身完整 CPU 数据；其实际执行和落库已经单独证实，HTTP 触发的是同一日计算函数。

Cloudflare 官方说明存在 CPU 余量结转机制，因此超 10ms 的请求可能暂时成功。不能以本次 errors=0 宣称超限设计合格。

个人使用量距离 Workers 100,000 请求/日、D1 5,000,000 读行/日和 100,000 写行/日有较大空间；这是个人量级估算，不是多用户容量压测。D1 Free 单库 500MB、账户总 5GB；50 标的每日快照按已有本地样本估算，近一年约 2MB。云端全年滚动清理、备份恢复及大量用户尚未验收。

## 行情出网与用户访问

从 Worker 访问腾讯不复权日线：沪股 600519、港股 00700、美股 NVDA，均返回 HTTP 200、500/501 根日线。Frankfurter 的 2025-11-03—05 历史 USD/CNY、USD/HKD 也返回 200、3 个日期。

这仅证明代表性接口可达；末根日线没有被认定为已收盘，不能代替市场日历、复权/拆股处理、汇率日期和行情可靠性验收。50 个标的逐一请求再加汇率会超过免费每次 50 外部子请求的边界，行情采集也需分批或批量接口。

当前电脑的普通 Chrome、curl、Node 访问 workers.dev 连接超时；通过 Cloudflare 官方 DNS-over-HTTPS 取得地址后，测试客户端可访问同一原域名并验证 HTTPS 证书。未修改系统 DNS、浏览器设置或关闭 TLS 校验。不能把诊断客户端的成功当作用户手机访问合格。正式接入前应验证手机 Wi-Fi/蜂窝网络，并评估可达的自定义 API 域名。

## 已做的优化与下一步边界

prototype v0.2.1 对账本读取避免大 JSON 的重复解析/序列化；交易输入只校验修改项，用 D1 JSON 局部更新，避免重写整份账本；日计算避免加载无关历史。以上通过本地和云端复测。

继续免费方案，需要将交易逐条存储并建立索引，导入逐批校验、核验后激活，日计算按账户/日期分批和增量更新，失败持久化重试。冷启动、大账本、全年补齐和 Cron CPU 还需再次验收。不是简单增加一个计时器就可正式发布。

**云端数据库可以成为权威数据源。** 现有前端通过带身份校验的 API 读写 D1，数据库管理凭据不放进页面。本地缓存可以只用于显示与离线支持；已同步数据以数据库为准，未同步离线编辑仍须本机队列保存。真实迁移应保留当前网址，先备份，再暂存上传、验证账本和旧快照、确认后激活，防止清空本机数据或误覆写云端。

测试用高频 Cron 验证后已移除，官方 API 返回远程 schedules=[]。独立模拟 Worker/D1 保留供复查；最终远程调度核验与部署 ID 见原型目录的 cloud-cleanup-results.json 和 cloud-deployment.json。没有接入真实行情计算、改造现有页面或迁移真实数据。

## 证据

原型目录：`prototypes/cloudflare-migration/`。

- cloud-verification-results.json：初始真实云端功能验证、请求时间和 DNS 诊断说明。
- cloud-recheck-results.json：v0.2.1 四组复测及请求时间。
- cloud-metrics-baseline.json / cloud-metrics-results.json：官方实际 CPU 指标。
- cloud-cpu-schema.json：官方 CPU 字段单位。
- cloud-scheduler-baseline.json / cloud-scheduler-results.json：实际 Cron 及独立落库观察。
- verification-results.json：17 项本地场景。

官方资料：[Workers 限额](https://developers.cloudflare.com/workers/platform/limits/)、[指标及 CPU 余量说明](https://developers.cloudflare.com/workers/observability/metrics-and-analytics/)、[GraphQL 查询](https://developers.cloudflare.com/analytics/graphql-api/tutorials/querying-workers-metrics/)、[D1 限额](https://developers.cloudflare.com/d1/platform/limits/)、[D1 计费](https://developers.cloudflare.com/d1/platform/pricing/)。
