# THROWAWAY PROTOTYPE — GainTrace Cloudflare迁移

问题：旧版localStorage交易/设置与IndexedDB盈亏快照，能否通过分段上传、断点重试、校验后切换，使前端保留数据、历史口径与离线可用性？

仅运行模拟账户、模拟账本、模拟估值行情，不读取真实浏览器存储，不写入线上App。支持Miniflare本地内存D1与独立Cloudflare Worker/远程D1验证。云端使用独立随机Workers secrets；固定mock token仅用于本地。初始导入上限1000笔，正式版本须独立完成用户认证、生产迁移和性能验收。

```sh
npm run verify
```

会自动从`仓库根目录`只读提取旧版纯计算和导入校验逻辑。交互查看迁移状态：`npm start`。

原型保存在独立目录，随 dev/gaintrace-backend 开发分支维护，尚未合入 App 主分支。本地运行结果不能证明Cloudflare CPU限额或真实手机网络可用性。

## 已验证的决定

基于App仓库`fc3a72a`的纯计算、导入校验和真实旧备份结构，17个模拟场景通过，结果见`verification-results.json`。Miniflare版本锁定在package-lock.json。

- 分段暂存与提交后激活，可保持原交易ID、成本、已实现盈亏、清仓交易、排序、币种与主题。
- 以源内容指纹恢复上传，以操作ID避免响应丢失后重复交易，以账本版本拒绝双设备静默覆盖。
- 本地缓存与待同步队列保留离线录入能力；原型队列仅在内存，生产版需要持久化IndexedDB队列。
- 旧盈亏快照作为“当时采集记录”保留，新收盘记录独立保存，不能把旧值升级标记为收盘值。
- scheduled处理器可独立写每日盈亏；缺失/未确认价格或缺汇率保持待补，重试补齐。

尚未实现生产登录、真实前端改造、真实行情计价、交易所日历/跨市场日期规则、完整云端备份与大规模分批导入。最终提交仍做完整旧格式校验；正式版须逐批校验和增量计算。

## prototype v0.2.1 云端结果（2026-11-23）

已在用户新注册的Cloudflare Free账户完成官方设备授权，部署独立 gaintrace-free-validation Worker和D1。迁移、重试、账户隔离、并发和补算通过；实际Cron独立生成两个模拟日期的盈亏点。临时每两分钟Cron在验证后清空，最终配置无Cron，证据见cloud-cleanup-results.json。

免费验收仍未通过：完整导入阶段CPU峰值78.524ms，优化后的读账本峰值7.062ms、局部修改/重试阶段8.844ms，两账户日计算阶段仍出现16.665—27.055ms。官方CPU字段单位为微秒；零运行时错误不代表超过10ms的设计可靠。Cron专用CPU查询返回空，实际Cron落库则有独立证据。

代表性沪/港/美日线和历史汇率从Worker出网均可达，但不等于已经验收真实每日收盘口径。当前电脑正常浏览器访问workers.dev超时；诊断客户端用官方DoH解析、保持原域名TLS验证后可测试，手机网络未验收。不要把该诊断机制直接装进产品。

详细结论见 ../../docs/backend/cloud-validation-2026-11-23.md。

云端脚本：cloud-verify.mjs用于首次空模拟环境验证；现有模拟账本使用cloud-recheck.mjs；cloud-observe.mjs观察实际Cron；cloud-metrics.mjs读取官方CPU；cloud-cleanup.mjs核对调度清空。cloud-configure.mjs默认不启用Cron，只有显式第三参数observe-cron才临时启用。

测试随机密钥文件 .validation-secrets.json 权限0600且忽略提交。CLI凭据通过官方wrangler auth token在进程内调用，报告不保存令牌；不要直接输出或提交该命令的凭据结果。
