# 调用级CPU采集链路核查：v0.3.6候选

归档授权：用户在分阶段诊断完成后明确同意上传结果记录，本批脱敏证据与复现代码归档到既有`dev/gaintrace-backend`，不合并main或改变线上部署。下文仅在本机/未推送描述保留各轮测试完成时的状态。

日期：2026-11-26。继续前一轮性能诊断，目标是补调用级CPU及采样缺口，而不是先修改计算代码。用户随后登录控制台，第5节补齐59条历史调用的可见CPU及关联证据；第二轮缺失的精确GraphQL桶仍未恢复，CPU预算验收未完成。代码和新增脱敏报告目前仅在本机，尚未提交或推送。第1至4节保留登录前的采集失败事实。

## 1. 官方能力与边界

- [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)支持调用级CPU；本机Cloudflare官方SDK 5.2.0的`workers/observability/telemetry.ts`明确包含`$workers.cpuTimeMs`、`wallTimeMs`及没有CPU字段的另一种事件结构，不能假设每条事件都有CPU。
- 当前官方文档列出Free每天200,000日志事件、保留3天，并提示2026-12-01改用Cloudflare Observability计价。这里只记录2026-11-26所见规则，不保证长期额度，也不冒称已经完整核定本账户套餐。
- [实时日志](https://developers.cloudflare.com/workers/observability/logs/real-time-logs/)可用Wrangler实时查看，非持久存储且可能采样；文档示例没有CPU字段，不能用网络/墙钟耗时替代CPU。实时会话不能回补之前缺失的历史事件。
- [Tail Workers](https://developers.cloudflare.com/workers/observability/logs/tail-workers/)仅面向Paid/Enterprise。本轮未创建Tail Worker、升级套餐或开通付费服务；测试的是普通Wrangler实时日志会话。

## 2. 历史日志只读探测

使用既有Wrangler OAuth凭据，只读查询前一轮`gaintrace-market-validation`的03:26—03:29UTC窗口，限制100条。请求为`POST /accounts/{account_id}/workers/observability/telemetry/query`，按`$workers.scriptName`过滤，并要求`$workers.cpuTimeMs`存在。

服务端返回HTTP403、success=false，没有取得事件或CPU数据。没有创建新token、扩展OAuth权限或输出原始响应/凭据。403本身不足以确定账户套餐、具体权限条件或历史日志可用性。现有内置浏览器打开Cloudflare后转到登录页；本轮未代登录、访问其他账本日志或更改控制台配置。

## 3. 极小量实时日志探测

新增两个固定mock-only命名空间，与原`cpu-repeat-01/02`及真实源报告分开；26请求复测脚本拒绝这些探测命名空间。候选计算入口仍为`market-validation.mjs`，SHA256仍为`434a9edb023cbf9951a69655a3a4160ff2cb3b88a923af7873ee70974f7b57af`。

每次计划最多三次合成5、50、5标的请求，无真实行情请求、Massive密钥、D1绑定、Cron或真实账本写入。随机鉴权口令及会话配置仅用于限时隔离Worker。实时采集90秒截止，退出时删除会话，外层脚本再删除Worker并独立核查。

`probe-market-tail.mjs`按本机官方Wrangler实现使用`trace-v1`协议及`debug:false`。消息只在内存白名单提取固定探测的序号/类别、有限结果状态、明确CPU毫秒及字段存在性；不保存完整URL、探测随机标识、签名WebSocket地址、请求头、日志正文、身份标识或未知单位的CPU值。仅`$workers.cpuTimeMs`可作为CPU证据。

| 探测 | 限时Worker起始UTC | 日志会话创建 | 合成请求 / 匹配日志 | 结果 | 独立清理UTC |
| --- | --- | --- | --- | --- | --- |
| cpu-tail-probe-01 | 05:48:24.299 | HTTP200，成功创建 | 0 / 0 | 采集失败；原报告未记录足够细的失败阶段，不倒推原因 | 05:49:02.640 |
| cpu-tail-probe-02 | 05:50:31.701 | HTTP200，成功创建 | 0 / 0 | 明确失败于websocket-connection阶段；具体底层错误未确定 | 05:51:11.073 |

第一次命令未追加既有系统CA，在生成临时配置/部署报告之前失败；之后用`NODE_EXTRA_CA_CERTS=/etc/ssl/cert.pem`重试，没有关闭TLS证书校验。第二次采集增加失败阶段和有限错误码白名单，使用新命名空间保留第一次失败事实。两次会话的DELETE均成功；独立Worker清理均确认测试Worker及随机secret已删、原Worker仍存在、原Cron为0，临时本机会话/配置已删。

本轮实际发送合成行情请求为0，也没有取得实时日志。因此不能声称“实时日志不含CPU”、采样完整、性能通过或已复现/修复峰值。只证明既有权限允许创建/删除实时日志会话，采集链路尚未打通；没有对同一失败无限重试。

证据：两个命名空间各有[01部署](../../backend/market-cpu-tail-probe-01-deployment-v0.3.6.json)、[01调用探测](../../backend/market-cpu-tail-probe-01-calls-v0.3.6.json)、[01清理](../../backend/market-cpu-tail-probe-01-cleanup-v0.3.6.json)以及[02部署](../../backend/market-cpu-tail-probe-02-deployment-v0.3.6.json)、[02调用探测](../../backend/market-cpu-tail-probe-02-calls-v0.3.6.json)、[02清理](../../backend/market-cpu-tail-probe-02-cleanup-v0.3.6.json)。

## 4. 回归与结论

7项新增检查连同相关既有纯检查共67项通过，覆盖隔离命名、序号/路由关联、隐私白名单、CPU单位、无CPU不能通过、缺样/重复/错误不能通过，以及局部16.749ms峰值仍亮红灯。语法和空白检查通过。不是全后端回归，也未将本机运行耗时当作云CPU。

`assessMarketCalls`要求三个序号各唯一、结果正常且每个都有明确CPU，才能给出当前样本`no-peak-observed`；即使如此仍保留coldStartsProven=false/universalFreeHeadroomProven=false。发现超过10ms的明确CPU，即使其他调用缺失也必须保留`peak-reproduced`；没有CPU或缺样则inconclusive。

前一轮16.749ms峰值、9.822ms的窄余量、第二轮25/26观测缺口均继续有效。下一步优先由用户登录既有Cloudflare控制台后，只读查看隔离Worker的Workers Logs及CPU字段；若历史记录已不可用，再申请极小量合成重采，不读取其他服务日志。若最终需要新的账户级日志权限，必须先明确权限范围并单独征得同意，不能借“继续”扩大凭据访问面。

采集链路未打通之前不修改计算算法、不宣称免费容量满足，也不启用真实日终、迁移、永久密钥或付费Tail Worker。新增遥测如需推送到可能公开的GitHub仓库，应先告知内容范围并取得本批确认。

## 5. 登录后只读补验：59条历史调用

用户确认已登录后，通过控制台Observability / Logs选择Workers数据集，并用界面生成的`$metadata.service = "gaintrace-market-validation"`过滤三个已知历史窗口。没有读取其他账本详情、获取浏览器凭据、扩展OAuth权限或创建云资源。此前API403、实时WebSocket失败仍是各自链路的事实，不冒称它们已修复。

表格只保留测试时间、已知请求类别、执行结果、CPU、日志级别和服务名。读取摘要中的固定URL仅在内存校验测试主机/路径并提取kind，不持久保存URL、请求头、日志正文、账户信息或请求标识，也没有展开原始日志。滚动补齐表格下方记录，三个窗口分别为7、26、26条，共59条。

| 窗口UTC | 日志数 / 客户端数 | 最大可见CPU | 关联的原GraphQL最大桶 | 最大桶对应阶段 |
| --- | --- | --- | --- | --- |
| 11-25 13:06—13:08 | 7 / 7 | 16ms | 16.749ms | evidence-5，合成5标的 |
| 11-26 03:22—03:24 | 26 / 26 | 9ms | 9.822ms | evidence-50，合成50标的 |
| 11-26 03:26—03:29 | 26 / 26 | 9ms | 9.606ms（原数据仍25桶） | evidence-5，合成5标的 |

所有CPU单元格只显示整数毫秒；没有取得小数或舍入规则。可见0不能解释为CPU为零，9不能冒称9.000。原GraphQL微秒值继续单独保留，不用显示整数覆盖它们。

`market-history-telemetry.mjs`离线以已知kind、相对客户端完成时间不超过1秒且唯一的候选关联日志与请求；59条全部一对一。再以客户端开始至日志时间的秒区间关联唯一的单请求GraphQL桶，共58条可关联。真实源等待可能跨秒，例如FX的日志在13:07:10.900，而原CPU桶在13:07:08，不能把日志时间当CPU开始或把网络等待当CPU。关联不依赖请求ID，不能冒称独立的逐请求精确遥测或算法因果证明。

原峰值日志为11-25 13:06:26.444UTC，kind=evidence-5、outcome=ok、可见CPU16ms；唯一关联桶为13:06:26、16.749ms。至此不仅有时间接近，而且有已知路由和可见CPU支持峰值位于合成5标的阶段。第一轮最大9.822ms却对应50标的阶段；第二轮9.606ms对应5标的。不能因此认定标的越少越慢、5标的算法恒定超额，或已排除初始化/共享处理/运行时波动。

### 缺样定位

第二轮原GraphQL没有关联桶的是客户端第23笔：evidence-50，日志时间03:28:08.407UTC，可见CPU1ms、outcome=ok、客户端HTTP200。历史调用日志已找到，但该笔精确微秒CPU仍缺失；因此旧25/26事实、inconclusive及免费余量未验结论不改。没有确定GraphQL缺样机制，不把缺桶当请求失败、CPU为零或超额中断。

该窗口控制台图表有25条Success、1条Errors；这不等于1次运行时异常。最后的源secret缺失保护请求03:28:18.199UTC显示logLevel=error、outcome=ok，对应客户端预期503及原GraphQL0.311ms桶。真正缺桶的是另一笔50标的请求，不是这笔503保护。HTTP状态来自原客户端报告；表格中的嵌套响应状态字段没有显示值，未冒称已从服务端日志复核HTTP状态。

### 验证与下一步

新增7项历史关联测试，连同相关检查共74项定向纯检查通过；原峰值缺部分日志仍必须亮红，缺样/重复/歧义/错误单位/其他服务/多请求桶不能被当作完整逐调用证明。计算入口及旧报告未改。证据为[脱敏可见日志](../../backend/market-history-dashboard-v0.3.6.json)与[离线关联结果](../../backend/market-history-correlation-v0.3.6.json)。

下一步是获准后仅对合成输入做最小化、分阶段的CPU隔离，区分共享初始化、证据构造、IANA时间转换和门禁计算；先测再改。新增采集优先使用已验证的控制台，只读权限足够，不要求新账号、付费服务、账户级token或真实Massive密钥。新的云资源创建/请求批次及可能公开的遥测推送须另行说明并确认；本轮没有这些动作。
