# 日终输入补验与隔离云测：v0.3.6候选

记录日期：2026-11-25。本轮仍是候选：现有Worker/Pages/main未改，真实账本未迁移。Massive密钥仍仅保存在本机，未上传Cloudflare。本轮创建并完成清理一个独立测试Worker，没有D1绑定或定时任务。

## 1. 同日数据重复观察

在上轮NVDA只读验收约17分钟后，重复请求2026-11-24摘要和一年未复权日线，间隔13秒，均HTTP200。

- 摘要选定字段的SHA256与上轮一致。
- 一年仍为251条、2025-11-25至2026-11-24，明确未复权；选定数据SHA256与上轮一致。
- 仅记录哈希/日期/行数，不发布价格序列；证据见[补读报告](../../backend/massive-stability-v0.3.6.json)和[首次报告](../../backend/massive-free-probes-v0.3.5.json)。

这只能证明两个观察时间之间选定内容未变化，不能推出供应商不修订、所有日线最终性、所有标的完整性或北京时间07:00前必定就绪。

2026-11-25本轮观察发生在该日美股常规收盘前；收盘为21:00UTC，候选下一晨评估点为23:00UTC（北京时间11/26 07:00）。这些未来窗口尚未发生，不能补造过去的采集时间。代码在常规收盘前明确返回pending且不调用上游；收盘后也只要求进一步来源观察，不宣称ready/final。

## 2. 独立云测候选的防护

新增`backend/market-validation.mjs`与独立配置模板`backend/wrangler.market.example.json`，已使用单独`gaintrace-market-validation`完成测试，不覆盖现有应用。

- 没有D1、KV或生产账本绑定，没有Cron、写入路由或CORS放行。
- 每次请求必须携带独立64位十六进制测试口令，并有受控开始/截止时间；有效期最多1小时。无授权、过期或缺少源secret都不调用上游。
- 仅GET及固定NVDA摘要/一年日线、固定ECB参考日、5/50个混合市场合成证据和当前收盘时间检查；不接收用户自定义上游URL、标的或许可标志。
- 上游正常TLS、不跟随重定向，20秒超时；日线响应最多256KiB、ECB最多24KiB。失败/429只返回pending，不复制错误正文或密钥。
- 实际源只返回元数据和hash；合成证据明确synthetic。没有把Massive标记为批准源，也不将其转换为final记录。
- 5/50标的是US/HK/SH/SZ混合的合成CPU负载，不是对50只真实股票、A/H行情或个人账本的验收。源调用仍需客户端全局串行限速，本模板不作为公开生产行情代理。

本次部署采用`deploy-market-validation.mjs --mock-only`，默认模式不读取本机Massive密钥，云端只配置独立`VALIDATION_TOKEN`。`--with-massive-secret`仅为后续工具入口，须用户明确同意将该密钥以Cloudflare Secret存储后才可运行；本轮没有执行。临时会话及部署配置均为gitignored的0600本机文件。

## 3. CLI连接和运行时兼容修复

CLI连接最初失败的直接证据为Node报`UNABLE_TO_GET_ISSUER_CERT_LOCALLY`。对本轮CLI进程追加系统既有CA：`NODE_EXTRA_CA_CERTS=/etc/ssl/cert.pem`后，官方`wrangler whoami`和授权读取恢复，无需用户重新登录。未关闭TLS验证、安装证书或改变系统信任配置。账户设置接口HTTP200返回`default_usage_model=standard`；订阅接口HTTP403，因此当前账户计费套餐没有完整核定，也没有据此升级或增加权限。

首次云测ECB返回pending，不能把“0运行时错误”解释为功能全部通过。定位到原生Workerd拒绝`redirect: "error"`，报`Invalid redirect value, must be one of "follow" or "manual"`。两个上游fetch均改为`redirect: "manual"`，非2xx直接返回pending，仍不跟随跳转或转发密钥。增加原生Workerd模拟ECB请求/CSV解析回归，以及重定向拒绝测试；临时调试日志已删除，仅保留不含正文的fetch/read/parse阶段标记。

本轮最终定向纯检查52项、原生Workerd父测试及3子测试共4项通过，合计56项；并非全后端回归重跑。原生检查不使用真实源密钥或D1；ECB网络在本机测试中为模拟，在下一节云测中为真实公开源。测试耗时不当作Cloudflare CPU。

## 4. 云端复验和CPU口径

修复部署版本`ba6b1b42-156b-41f9-ae71-dda283cbcb18`；受保护窗口12:14:56.802—13:14:56.802UTC，最长1小时。复验客户端窗口为2026-11-25 12:30:08.107—12:31:19.875UTC，六次请求：

- 50/5个混合市场合成证据均HTTP200、verified-candidate，无真实持仓写入。
- Cloudflare到ECB的真实公开CSV读取和解析HTTP200、valid-candidate，参考日2026-11-24，包含CNY/USD/HKD；为ECB_REFERENCE而非成交汇率，未发布具体汇率。
- 今日收盘前就绪门禁为pending，明确regular-session-not-closed，上游请求0。
- 未授权返回401，Massive源secret缺失返回503；两者均不调用Massive。

客户端使用官方Cloudflare DoH解析配合原主机名和正常TLS作诊断访问。这证明测试Worker可通过该诊断链路调用ECB，不证明普通手机网络对workers.dev可达；此前Pages的手机蜂窝成功结论不扩大到此Worker。

官方`workersInvocationsAdaptive`在12:30—12:32UTC外扩窗口报告6次请求、0运行时错误，最大观测桶CPU **4.676ms**。`max.cpuTime`为微秒，除1000转为毫秒，不是请求/网络耗时。当前小样本低于10ms参考线，但请求数相同不能证明逐次采样完整性；没有证明全部冷启动、路由级归因、真实Massive一年日线云端CPU或所有负载的免费余量。首次失败阶段的6.698ms单独保留，不替代修复后的结果。

证据：[修复后请求](../../backend/market-cloud-checks-v0.3.6.json)、[官方CPU](../../backend/market-cloud-cpu-v0.3.6.json)、[部署记录](../../backend/market-cloud-deployment-v0.3.6.json)。首次请求/CPU另存`market-cloud-checks-initial-v0.3.6.json`和`market-cloud-cpu-initial-v0.3.6.json`供复盘。

## 5. 清理和待补项

2026-11-25 12:33:42.063UTC独立检查确认测试Worker已删除、其测试secret随资源移除；本机临时会话/部署配置已删除，Massive本机密钥保留。现有Worker仍存在、Cron仍为0，未写真实账本。见[清理证据](../../backend/market-cloud-cleanup-v0.3.6.json)。

仍缺用户明确授权后的Cloudflare到Massive真实fetch/一年日线CPU、下一交易日实际收盘至北京时间07:00的数据就绪观察、多时段修订抽样、企业行动官方对账、A/H许可与日历、TARGET休市沿用规则、年度维护/备份回滚和正式迁移确认。本轮不启用后台真实日终或真实账本迁移，也不创建未来自动任务。
