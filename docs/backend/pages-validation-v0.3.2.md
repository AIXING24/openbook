# 免费备用API地址验收

版本：backend v0.3.2，2026-11-23。生产前端仍为v1.16.0。

https://gaintrace-batch-api.pages.dev/ 已部署同一模拟后端与无个人数据的连接测试页，用户确认手机Safari蜂窝网络可打开。电脑浏览器及Node使用普通系统DNS也可打开，不需要产品DNS补丁。Wi-Fi暂未验证；不能据此保证所有网络都可达。

## 授权与部署

Pages原先403缺少pages:write。设备授权在完整官方链接、新页面、新验证码且约一分钟内操作仍返回Could not verify the code，排除仅由旧页面或过期造成的解释，尚未确定外部接口根因。改用标准OAuth，保持127.0.0.1:8976回调运行后，官方Wrangler确认Successfully logged in，Pages创建/配置/部署成功。授权后欢迎页workers.dev仍不可达，未影响已完成的CLI授权。

Wrangler 4.166首次Pages创建默认转交Workers，因未检测到静态目录失败；依照官方提示用--force直接创建Pages。后续命令无需该参数。部署配置仅保留Pages支持的字段，D1为既有隔离模拟数据库，VALIDATION_MODE=mock-only，3个随机测试密钥由生产环境secret_text保存。未添加预览环境密钥或真实数据。

- 项目：gaintrace-batch-api，production branch为dev/gaintrace-backend。
- 部署：73c3c9fe-b73e-4c49-bb05-f37aae754d0d，代码提交72428e2。
- 不可变部署地址：https://73c3c9fe.gaintrace-batch-api.pages.dev 。
- Cron继续留在单独Worker，当前仍为空；Pages不承担调度。

## 只读验收

scripts/cloud-pages-check.mjs于2026-11-23真实运行通过，原始结果为backend/cloud-pages-verification-v0.3.2.json。未写入交易/历史或触发日计算。

| 项目 | 结果 |
|---|---|
| 普通DNS访问根页面 | 200，GainTrace访问正常 |
| 无密钥访问账本/admin；账户密钥访问admin | 均401 |
| 实际接口版本 | backend v0.3.2 |
| ALICE完整分页 | 1001笔，与全量账本一致，revision=4 |
| BOB完整分页 | 100笔，与全量账本一致，revision=1 |
| Pages/Worker账户与历史 | 两账户逐项一致，模拟账户彼此不同 |
| 官方Pages配置 | D1 DB绑定、mock-only和3个secret_text均核实 |
| 官方Worker测试Cron | schedules=[] |
| 用户手机蜂窝网络 | 用户确认可以打开 |
| 用户手机Wi-Fi | 待补测 |

Worker对照读取仅在验证脚本中使用官方DoH诊断，保持原域名TLS，Pages检查采用普通系统DNS。CPU证据仍以v0.3.1的8.788ms样本为准，本次没有重新采集CPU，不能将其改标为Pages生产性能证明。

下一阶段是前端同步适配层、持久化离线队列、生产认证和首次备份迁移，及整年历史分页和真实行情口径。此模拟地址未接入当前手机工具，未迁移个人账本。
