# skillify-runtime

Composio 式的托管执行网关 MVP：托管凭证 + 统一 tool-calling 执行接口，是 [Skillify](../Skillify) 静态知识产品（`SKILL.md` + `references/`）之外补的运行时那一层。设计与范围决策见 `docs/plan.md`（从 Skillify workspace 的规划会话导出，此仓库暂不重复维护）。

当前覆盖两个平台，分别代表两类凭证复杂度：

| 平台 | 凭证模型 | Action |
|---|---|---|
| `bigmodel-cn` | 静态 API Key，无过期 | `bigmodel_chat_completion` |
| `feishu` | app 级 `tenant_access_token`，网关自动换取/刷新（`ConnectedAccountDO`） | `feishu_send_message`、`feishu_bitable_batch_create_records` |

明确不做：支付宝/微信支付（涉资金，MVP 不碰）、feishu 三方 `user_access_token` 用户授权跳转（app 级 token 已够用）、计费/控制台 UI/沙箱执行。

## 本地开发

```bash
npm install
wrangler d1 create skillify_runtime   # 把返回的 database_id 填进 wrangler.jsonc
npm run d1:migrate:local
wrangler secret put KEK_BASE64        # 32 字节随机密钥的 base64，例如: openssl rand -base64 32
wrangler secret put ADMIN_TOKEN       # 任意随机字符串，用于 POST /v1/tenants
npm run dev
```

## API 速览

所有非 admin 接口都要求 `Authorization: Bearer <tenant api key>`。

```bash
# 1. 用 ADMIN_TOKEN 建一个 tenant，拿到它的 api key（只显示这一次）
curl -X POST localhost:8787/v1/tenants \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"name":"acme"}'

# 2. 挂一个 bigmodel-cn 凭证
curl -X POST localhost:8787/v1/connected-accounts \
  -H "Authorization: Bearer $TENANT_KEY" \
  -d '{"platform":"bigmodel-cn","label":"prod","secret":{"apiKey":"...","planType":"standard"}}'

# 3. 看工具目录（OpenAI/Anthropic tool-calling 兼容的 JSON Schema）
curl localhost:8787/v1/tools

# 4. 执行一次调用
curl -X POST localhost:8787/v1/actions/execute \
  -H "Authorization: Bearer $TENANT_KEY" \
  -d '{"tool_name":"bigmodel_chat_completion","connected_account_id":"acct_xxx","input":{"model":"glm-4.6","messages":[{"role":"user","content":"hi"}]}}'

# 5. 审计日志
curl localhost:8787/v1/audit-log -H "Authorization: Bearer $TENANT_KEY"
```

## 测试

```bash
npm test                     # 纯逻辑单元测试：信封加密往返、两个平台的错误归一化
BIGMODEL_API_KEY=sk-xxx npm test   # 加上 bigmodel-cn 真实调用联调
FEISHU_APP_ID=... FEISHU_APP_SECRET=... npm test   # 加上 feishu 真实调用联调
```

真实凭证测试复用了 `Skillify/bigmodel-cn/evals/evals.json` 与 `Skillify/feishu/evals/evals.json` 里已经验证过的场景断言口径——网关不应该比 Agent 自己写代码调用更不准。

## 已知取舍（MVP 阶段）

- 限流是单个 connected account 内的简单节流（`ConnectedAccountDO.throttle`），不是按平台文档表格里的分级 QPS 精确实现。
- 审计日志直接写 D1，没有做量大后搬 Queues/R2 的分流。
- `KEK_BASE64` 是普通 Worker secret，不是 Cloudflare Secrets Store 资源——先够用，后续要升级路径明确（换成从 Secrets Store 读取即可，`lib/crypto.ts` 的接口不用变）。
