# 前端云同步适配层 v0.1.0

该模块处于开发分支，未被现有HTML或构建脚本引用。当前手机页面仍使用原本地账本，未接入真实云账户。

## 存储与接口

`indexeddb-store.mjs`在独立gaintrace-cloud-cache-v1数据库中按已认证身份存储一条账户记录。同一记录包含已确认账本、待同步操作、已发送操作的固定expectedRevision及冲突状态；IndexedDB事务完成后才报告保存成功。旧cj.v1和gaintrace-pnl-history不由此模块修改。缓存键必须包括API环境和认证后的稳定用户ID；认证令牌由API对象持有，不能写入账户记录。

`sync.mjs`接受store、identityKey和绑定同一身份的api。api提供`operation(wire) -> {status,body}`与`readSnapshot() -> {generation,revision,state}`；生产实现需要先认证并验证身份，分页加载账本，而不是直接套用测试的全量/state。每日历史另用分页历史仓库，不能放入这个账本/队列记录。

- `initialize(snapshot)`首次激活已核验的云账本；有待同步编辑时不静默覆盖。
- `enqueue(edit)`支持upsert-trade、delete-trade和完整preferences；返回已持久化的本地展示状态和待同步数量。异步失败时调用者不能提示已保存。
- `snapshot()`先读缓存；mode区分synced、pending、offline、auth-required、conflict、rejected。
- `flush({limit:20})`每次有界提交队列；首笔发送前原子保存操作ID和expectedRevision。服务器确认及后续读成功后才移出队列。断网/响应丢失时关闭再开仍重发原操作。
- `refresh()`获取云账本后，在本地事务中重新检查最新队列，防止并发编辑被刷新覆盖。
- `exportPending()`提供本地冲突核对资料，不自动发送或清空。

一个页面内flush串行；多标签页可发送同一队首，借助后端幂等与本地队首ID检查避免重复提交/误删后续编辑。401/403保留队列等待登录；409和422保留本地编辑并停止自动提交。另一设备修改时不自动改用新revision提交旧编辑。已提交响应丢失后若另一设备又修改，先确认旧操作，剩余编辑仍进入冲突核对。

## 验证

在仓库根目录安装现有依赖，并在backend目录安装后执行`npm test`。新增9项同步检查使用真实Miniflare/D1和fake-indexeddb：关闭重开、账户隔离、丢失响应、同时标签页、失效登录、丢失确认读取、另一设备插入后的剩余队列阻断、明确冲突与存储失败。既有13项后端检查同时通过。

真实浏览器检查：在backend目录运行`node scripts/serve-client-validation.mjs`，打开http://127.0.0.1:8789/，首次页面将一笔模拟编辑留在离线队列；刷新后用真实IndexedDB恢复并同步到模拟API。2026-11-23在Codex内置浏览器验证通过，刷新后待同步由1变0、确认revision=2。此测试不等于iOS Safari验证，也未连接线上数据库；本地测试服务器验证后已关闭。

## 接入现有页面之前

现有save()是同步localStorage写入；云模式应由交易/设置入口await enqueue后更新S和提示，不能先改S、异步fetch失败仍声称成功。云模式下不要另写一份localStorage账本冒充与队列原子提交。迁移入口仍需在原存储实例内冻结源备份、分批核验激活，再初始化此模块，保留旧数据。

后续必须补齐生产身份验证、迁移状态与迁移期间队列、冲突核对UI、分页历史/旧证据适配，以及移动端关闭重开、离线与免费额度实测。用户已选择通用邮箱/手机验证码，优先评估邮箱；不使用GitHub登录作为既定方案。

auth v0.1.0的email-session.mjs已提供PKCE开始/返回兑换/内存短期会话/登出接口，与backend/email-auth.mjs做本地验证。此模块尚未由生产页面调用，仍需Cloudflare Access OTP配置与手机实测。详见docs/backend/email-auth-validation-v0.1.0.md。
