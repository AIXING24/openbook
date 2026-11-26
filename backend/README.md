# GainTrace 后端 v0.3.6候选（账本云端仍v0.3.4）

开发分支上的分批存储与计算实现，当前只接受合成账户和 Mock HSBC 账本。Pages 已接入独立邮箱认证及模拟账本接口，真实行情日期与正式前端迁移尚未接入。前端 v1.16.0 继续使用原本地存储。

## 真实市场输入候选

`market-evidence.mjs`处理IANA收盘时间转换与候选输入校验：未复权、常规市场、明确日期、个人来源审批、历史参考FX、已核对企业行动及旧美股日期口径。完整仅返回verified-candidate，不写数据库/调用网络/批准provider或启用生产。`ecb-fx.mjs`逐日有界解析官方参考汇率并标明EUR交叉换算，不冒称成交或精确市场收盘汇率。

公开样例行情和一年ECB参考FX已只读核验。用户已注册Massive Stocks Basic，个人NVDA摘要及一年未复权日线已完成隔离云测；未审批生产，A/H许可、全部日历和企业行动仍未核定。来源评估、旧日期边界及许可要求见[真实日终输入核查](../docs/backend/market-input-readiness-v0.3.5.md)和[真实云测](../docs/backend/massive-cloud-validation-v0.3.6.md)。原模拟账本部署与真实App不变，临时行情Worker及云端源密钥已清理。

## CPU采集诊断

调用级补验与分阶段诊断的脱敏记录、复现代码已获用户授权归档到既有`dev/gaintrace-backend`；各报告保留测试完成时的本机状态。不得将原始日志、账户配置或密钥加入归档，也不以开发分支上传替代生产验收。

历史官方桶CPU曾为16.749ms；两次合成复测分别9.822ms、9.606ms，第二次官方25/26缺样，不能宣称免费CPU验收通过。调用级Workers Logs API返回403、两次免费实时日志采集未连通，资源已清理。用户登录控制台后只读取得59条历史调用的可见整数CPU，并与客户端唯一关联；原峰值由5标的日志可见16ms支持。第二轮缺失的50标的调用日志已找到（可见1ms），但精确CPU桶仍未补，旧结论不覆盖。详见[重复隔离验证](../docs/backend/cpu-repeat-validation-v0.3.6.md)与[采集链路核查](../docs/backend/call-telemetry-validation-v0.3.6.md)。

`market-call-telemetry.mjs`只保留固定探测的脱敏调用字段，明确CPU毫秒才可计入门槛；没有CPU、缺样、重复或错误不能通过。`scripts/probe-market-tail.mjs`仅用于已经授权的限时mock-only隔离探测，最多三次合成请求、90秒截止、退出删除实时日志会话；外层仍必须运行独立Worker清理脚本。不直接运行未清洗的`wrangler tail --format=json`，其原始输出可能包含请求头中的鉴权口令。不要使用付费Tail Worker或为排查自行扩展日志权限。

`market-history-telemetry.mjs`离线关联已脱敏的历史显示行、既有客户端阶段和唯一的单请求CPU桶，不读取浏览器会话或访问云端。显示整数与原微秒桶分开保留，歧义/重复/缺桶不冒称完整精确CPU。历史重放可用`node --test tests/market-history-telemetry.test.mjs`，其中16.749ms峰值必须继续亮红，不能用新低样本覆盖。

2026-11-26获准新增`cpu-phases-01`纯合成18请求：拆分control、5/50样本构造、四个独立市场收盘键、预构造样本门禁与原完整路径。官方18单请求桶和18条可见日志均唯一关联，0运行时错误，第二次5标的门禁仍测到10.754ms；单独时区路径为1.534/0.794ms，不能只凭首次初始化或50标的规模解释全部峰值，亦不证明具体慢函数。诊断入口预构造样本及额外状态鉴权改变共同开销，不得相减冒称纯阶段CPU或提速。原算法未改；临时Worker/secret/会话已独立清理、原Cron0。离线复核`node scripts/correlate-market-phases.mjs`；见[分阶段诊断](../docs/backend/cpu-phases-validation-v0.3.6.md)。本批仍只在本机，未提交/推送。

## 邮箱与模拟账本联动

`client v0.2.0` 使用既有 `/auth/test` 回调页面；认证保持 `auth v0.1.6` 的测试邮箱白名单和会话期限。新 `/api/ledger/` 路由只接受有效应用会话，账本归属由服务端认证 UUID 决定，账户前缀 `email:` 与原 alice/bob 模拟账户隔离。浏览器提交的 account/用户字段不能选择账本；原模拟凭据不能访问新路由。来源不同的 POST、部署别名及管理路由均拒绝。

- `/api/ledger/meta` 返回版本、迁移代和设置；`trades` 和 `history` 每页最多20条，SQL 同次查询读取页数据和版本。客户端核对跨页版本及末页后的版本，遇到并发变化停止该次读取。完整 `/state` 没有开放到邮箱路由。
- 固定模拟账本在浏览器生成、分段上传、逐段核验和回读比对后激活；测试页没有个人备份导入入口，也不会替换已有云账本。
- 页面使用真实 IndexedDB 缓存/队列及已验证的 `cloudSync`，操作ID与版本持久化；会话只在内存，刷新须重新登录同一邮箱，之后恢复原队列。401保留操作；409暂停提交，允许导出核对记录，不自动覆盖。
- 测试页显示持仓、清仓记录、已实现收益和固定模拟价格下的总盈亏。日终点单独分页读取，仍明确标注模拟；没有启用正式调度或真实账本迁移。
- `node scripts/build-kinde-pages.mjs <独立输出目录>` 构建 Pages 候选和浏览器模块。`node scripts/serve-ledger-preview.mjs` 是本机一次性内存D1/合成会话 UI 验证工具，不能当真实OTP验收，且不把预览文件写入部署目录。

验收状态见 [联动记录](../docs/backend/ledger-link-validation-v0.2.0.md)。

## 模拟日历补算

`gt_mock_schedule_targets` 明确限定测试账本及起始日，`gt_mock_schedule_days` 保存固定模拟日历、可计算时间和休市标记。启用 `gt_control.mock-calendar-enabled=1` 后，Worker Cron 每次只推进一个账户最早缺失日期的一个片段；失败日期等待价格/FX补齐，不跳过缺口，轮转时不阻塞其他账户。未到可计算时间不生成，已确认日期不重复写入。无需浏览器打开或应用会话。

这是合成日历，不是实际交易所日历。测试用 `mock-calendar-until` 截止时间保护；显式关闭后不回退到旧模拟时钟。`scripts/cloud-mock-calendar.mjs` 只对现有唯一邮箱模拟账本验证两个固定日期，临时启用每分钟 Cron，并在 finally 清空调度和关闭开关；不允许覆盖已有日期或重复运行。真实日终调度、自动年度清理和行情接入仍未启用。

v0.3.4已由实际云Cron生成两个模拟日期，并独立核验调度清空。11条已返回官方定时CPU样本（含最终确认分钟）均成功，最高7.926ms；这是当前小账本窗口，不是全容量保证。`scripts/capture-calendar-metrics.mjs` 可只读补查延迟统计，不重新写账本或开启Cron。证据见[模拟日历验收](../docs/backend/mock-calendar-validation-v0.3.4.md)。

## 本地验证

先在仓库根目录执行 `npm ci`，再在本目录执行 `npm ci`、`npm test`。测试使用 Miniflare 的内存 D1，退出后销毁。Cloudflare 配置用 `wrangler.example.json` 为样例生成 `wrangler.local.json`；配置、随机测试密钥和 Wrangler 凭据不提交。

## 接口与约定

- 导入：`/import/start` 创建 manifest；`/import/part` 每次最多 10 笔交易或一条旧快照，片段不超过 24KB，按序断点续传；`/import/verify` 每次仅校验一个已上传片段，返回 verifying 时续调；全部片段完成后才检查完整链、数量和一致性并返回 verified；客户端下载所有暂存片段比对，再 `/import/activate`。云端已有账本则拒绝另一次静默替换。
- `packImport` 在客户端完整旧格式校验后拆分。原备份的 `sourceHash` 用于标识源和续传；服务端验证的是规范化内容的分段哈希链。客户端比对每个片段保证原交易、设置和旧历史一致，不声称服务端收到了整个原始 JSON 文件。旧快照、baseline 与 ledger 作为原采集证据保留，绝不改标为收盘价。
- 账本：交易逐条入库，以账户、迁移代、交易 ID 隔离；`/operation` 用操作 ID 保证幂等，用 `expectedRevision` 避免双设备静默覆盖；修改设置与后续交易不改变已上传片段。
- `/state` 在同一 SQL 查询读取版本、完整账本与每日历史，并由 SQL 生成 JSON，避免 Worker 全量解析/序列化；`/trades` 可按 20 笔分页。分页客户端需检查每页 revision 一致，否则重新读取。
- `dailyStep` 每次只做一个持久化片段：启动、最多 10 笔交易、最多 5 个标的估值或最终确认。跨片段采用与旧 Core 一致的移动平均成本，保存全部标的状态，包括清仓收益、空头、分红和累计买入分母。下一日期复用最近有效状态，不重复处理旧交易。
- 上传与语义校验分属独立请求，减小首次调用 CPU。进度和结果在同一 D1 batch 原子保存，竞争的片段用一次性 token 拒绝重复输出。账本版本变更后重建未完成任务；有缺失或未确认价格/历史汇率则保持待补，不写假点。
- 已确认历史保持冻结；回溯修改使受影响日期失效，重算前归档旧值。`retainDaily` 保留近 365 自然日和前一有效基准，保留全部交易和累计已实现收益。
- 模拟 Cron 每次仅推进一个账户的一个片段，轮转账户。验证完成后清空测试 Cron。生产调度仍需交易所日历、收盘口径、估值日期与补算队列设计；模拟北京时间日终不代表真实混合市场收盘。

## 当前边界

初始导入验证容量 1000 笔 / 50 标的、366 条历史快照，每条最多 50 个估值持仓；日常交易逐条增加，上限 100000 笔 / 50 标的。这些上限是当前模拟实现的保护值，未验证 100000 笔或大量用户的容量，不能用于推断免费额度仍足够。生产端需要持久化离线队列、用户认证、真实价格/FX日期与企业行动、备份恢复、数据清理和更大备份的拆分策略。

云端验证脚本 `scripts/cloud-verify.mjs` 只用于空的 gt_* 模拟表。脚本完成后不要反复运行初始导入和修订场景，应使用专用复测。`scripts/cloud-metrics.mjs` 读取官方 CPU 微秒字段，不能把墙钟等待、SQL 耗时或部署 startup time 当调用 CPU。

## 免费地址备用部署

`npm run build:pages` 生成忽略提交的 `.pages-output`，含连接测试页和同一模拟接口的 `_worker.js`。`wrangler.pages.example.json` 提供 Pages 配置样例；实际数据库绑定与测试密钥仅在本机/云端配置。Pages 仅提供备用 API 域名，日终 Cron 仍由 Worker 执行。

2026-11-23已部署 https://gaintrace-batch-api.pages.dev/ ，用户确认手机蜂窝可打开；Wi-Fi仍待补测。标准浏览器OAuth成功补充pages:write；设备验证码在新页面及有效期内也失败，未确定Cloudflare设备接口的根因。Wrangler 4.166首次创建须按官方提示加`--force`以直接使用Pages；后续部署无需此参数。Pages配置不支持Worker的account_id/observability字段，账户可用CLOUDFLARE_ACCOUNT_ID设置。

只读验收使用`NODE_EXTRA_CA_CERTS=/etc/ssl/cert.pem node scripts/cloud-pages-check.mjs`（在本目录运行）。它检查普通系统DNS下页面与鉴权、两个模拟账户分页与Worker数据一致性、官方D1绑定和测试密钥类型，以及测试Cron仍为空；测试密钥只在内存中读取，不输出。证据见cloud-pages-verification-v0.3.2.json。该验证不改变账本，也不代表生产认证或真实前端迁移已完成。
