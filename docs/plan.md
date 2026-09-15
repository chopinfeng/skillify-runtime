# Skillify Runtime — 托管执行网关 MVP（对标 Composio 的运行时基础设施）

## Context

Skillify 目前只是一个静态知识产品：`SKILL.md` + `references/`，教 Agent 自己写对调用第三方 API 的代码，不托管凭证、不代理请求。用户想补上 Composio 那一层——**托管凭证 + 统一 tool-calling 执行接口**（OAuth/凭证管理、重试/限流、审计日志），做成托管 SaaS。

已确认的范围决策：
- **托管模式**：凭证和调用经过 Skillify 自己的服务器（对标 Composio，非自托管框架）。
- **起步范围**：先打透 1-2 个平台，验证"凭证托管 + 统一执行 + 重试/限流"这条链路本身站不站得住，再决定要不要横向铺开到全部 18 个 skill。
- **仓库**：新建独立仓库（本机路径 `~/Workspace/skillify-runtime`），不并入 `fxp/skillify`。

**选平台**：`bigmodel-cn`（静态 API Key，无 OAuth）+ `feishu`（app 级 `tenant_access_token`，服务端自动换取/刷新，无需用户跳转授权）。这两个正好覆盖两类凭证复杂度——静态密钥 vs. 服务端自动续期的临时令牌——不需要做全套三方 `user_access_token` 用户授权跳转（那是"代表某个真人用户"场景才需要的，bot 发消息、多维表格读写都是 app 级操作，用不上）。**明确排除**支付宝/微信支付：这两个涉及资金和更高合规责任，MVP 阶段不碰，等运行时模型跑通了再单独评估。

这两个 skill 都已经过 `create-doc-skill` 方法论的文档核验（`bigmodel-cn` 更是有 GLM-5.3 实测对照实验），运行时的 action 目录直接从这些已验证的 `references/*.md` 里抠事实，不是重新爬文档——这是相对 Composio 的一个差异化叙事：**目录的准确性有真实调用背书**，不是"接口通了就算数"。

## 架构

技术栈沿用用户已有的 Cloudflare 技能栈（`wrangler`、`durable-objects`、`agents-sdk` 已在技能库里）：**Cloudflare Workers + Durable Objects + D1 + Secrets Store**。

**核心概念**：
- **Tenant**：Skillify 的客户（网关的调用方），持有一个 Skillify API Key。
- **Connected Account**：某个 tenant 在某个平台（bigmodel-cn / feishu）下挂载的一份凭证。
- **Action 目录**：每个平台暴露若干个 action，用 OpenAI/Anthropic 通用的 tool-calling JSON Schema 描述，`GET /v1/tools` 返回，Agent 框架可直接喂给 LLM。
- **Execution Gateway**：`POST /v1/actions/execute`，接 `{tool_name, connected_account_id, input}` → 找凭证 → 组装真实请求 → 打过去 → 按平台真实错误形状归一化 → 落审计日志。
- **Per-account Durable Object**：一个 connected account 一个 DO 实例，职责：
  - feishu：持有 `tenant_access_token` + 过期时间，`expire<30min` 时自动换新（写死复用 `references/auth.md:71-101` 里验证过的刷新阈值），避免并发请求扎堆重复换 token。
  - 两个平台都用：serialize 同一账号下的并发调用，做简单的滑动窗口限流计数（bigmodel-cn 是并发数限制不是 QPS，feishu 是分级 QPS，配置化，不是同一套逻辑硬编码）。
- **凭证加密**：信封加密——每个 tenant 一把 DEK（首次创建 tenant 时生成），DEK 本身用 Secrets Store 里的根 KEK 加密后存 D1；`connected_accounts.encrypted_secret` 用明文 DEK（运行时解密后仅存在于 Worker 内存）加密。API 从不回显明文凭证。
- **审计日志**：每次 execute 落一条记录（tenant、account、tool、状态、耗时、脱敏后的请求/响应摘要），先写 D1，量大后再考虑搬到 Queues+R2。

**错误归一化**（两个平台形状完全不同，这是网关最有价值的部分之一）：
- bigmodel-cn：`{"error":{"code":"1001","message":"..."}}`，HTTP 状态码本身有意义，429 走 `1302/1305`（重试），`1308/1310` 带 `next_flush_time`（按此定时重试）。
- feishu：**HTTP 状态码不可信**，唯一成功信号是 body 里 `code==0`；token 换取和 webhook 失败经常是 HTTP 200 + 非零 code；路径写错是 HTTP 404 纯文本，不是 JSON——网关必须先查 `Content-Type` 再决定怎么解析。429 时读 `x-ogw-ratelimit-reset` 头,按秒数等待。
- 统一对外返回 `{ok, retryable, platform_code, platform_message, http_status}`，Agent 侧不用学两套语义。

## 目录结构（新仓库 `skillify-runtime/`）

```
skillify-runtime/
├── README.md
├── wrangler.jsonc
├── package.json
├── migrations/0001_init.sql        # D1 schema
├── src/
│   ├── index.ts                    # Worker 入口 + 路由
│   ├── routes/
│   │   ├── accounts.ts             # POST/GET/DELETE /v1/connected-accounts
│   │   ├── execute.ts              # POST /v1/actions/execute
│   │   ├── catalog.ts              # GET /v1/tools
│   │   └── audit.ts                # GET /v1/audit-log
│   ├── platforms/
│   │   ├── bigmodel-cn/
│   │   │   ├── actions.ts          # chat_completion 的 schema + 请求构建，直接对应 bigmodel-cn/references/chat.md
│   │   │   └── auth.ts             # 静态 key 校验/透传
│   │   └── feishu/
│   │       ├── actions.ts          # send_message、bitable_batch_create_records
│   │       └── auth.ts             # tenant_access_token 获取与刷新逻辑
│   ├── durable-objects/
│   │   └── ConnectedAccountDO.ts   # token 缓存 + 刷新 + 限流计数
│   ├── lib/
│   │   ├── crypto.ts               # 信封加密 helpers
│   │   ├── retry.ts                # 按平台错误归一化结果做退避重试
│   │   └── errors.ts               # 两个平台的错误归一化实现
│   └── db.ts                       # D1 查询封装
└── test/
    ├── bigmodel-cn.integration.test.ts   # 复用 Skillify/bigmodel-cn/evals/evals.json 里可复用的场景
    └── feishu.integration.test.ts        # 复用 Skillify/feishu/evals/evals.json 里的 3 个场景
```

## D1 Schema（核心表）

```sql
CREATE TABLE tenants (id TEXT PRIMARY KEY, name TEXT, dek_wrapped BLOB, created_at INTEGER);
CREATE TABLE tenant_api_keys (id TEXT PRIMARY KEY, tenant_id TEXT, key_hash TEXT, created_at INTEGER, revoked_at INTEGER);
CREATE TABLE connected_accounts (
  id TEXT PRIMARY KEY, tenant_id TEXT, platform TEXT, label TEXT,
  encrypted_secret BLOB,        -- bigmodel-cn: 加密后的 API key；feishu: 加密后的 app_id+app_secret
  cached_token TEXT, cached_token_expires_at INTEGER,  -- feishu tenant_access_token 缓存
  created_at INTEGER, revoked_at INTEGER
);
CREATE TABLE audit_log (
  id TEXT PRIMARY KEY, tenant_id TEXT, account_id TEXT, tool_name TEXT,
  ok INTEGER, http_status INTEGER, platform_code TEXT, duration_ms INTEGER, created_at INTEGER
);
```

## MVP 覆盖的 3 个 action

1. `bigmodel_chat_completion` → `POST {base_url}/chat/completions`，透传 `model`/`messages`/`tools` 等；服务端强制 `tool_choice` 只接受 `"auto"`（否则 400 拦截，而不是让平台报错才发现）；Coding Plan / 标准 Key 两个 base_url 由 connected_account 的凭证类型决定，不让调用方选错。
2. `feishu_send_message` → `POST /open-apis/im/v1/messages?receive_id_type=...`，网关内部拿缓存的 `tenant_access_token` 注入 `Authorization: Bearer `（显式带前缀，文档里验证过漏了前缀等于没传），`content` 按 schema 校验后 `JSON.stringify`。
3. `feishu_bitable_batch_create_records` → `POST /bitable/v1/apps/:app_token/tables/:table_id/records/batch_create`，网关侧做 ≤1000 条校验、日期字段自动转毫秒时间戳（这是 reference 里验证过的坑，替调用方挡掉）。

## 验证方式

1. `wrangler dev` 本地起服务，先用假凭证跑通 400/401/限流分支的单元测试。
2. 真实凭证联调：用户按记忆里的约定在对话里粘贴 bigmodel-cn 测试 Key（走环境变量，不落盘）；feishu 需要用户提供一个测试用的自建应用 `app_id`/`app_secret`。跑通后：
   - 直接复用 `Skillify/bigmodel-cn/evals/evals.json` 和 `Skillify/feishu/evals/evals.json` 里的场景作为 `test/*.integration.test.ts` 的断言基础（这些场景已经是判分标准明确的真实调用用例）。
   - 对照：同一个 action 分别用旧方式（Agent 自己写代码调用）和新方式（走网关 execute）各跑一遍，确认网关没有引入新的正确性问题，且挡住了 reference 里记录的那些坑（比如漏 `Bearer` 前缀、日期没转毫秒）。
3. 确认审计日志、限流退避、token 自动刷新在真实调用下按预期工作（故意在 feishu token 快过期前发起调用，验证 DO 会提前换新而不是等 401）。

## 本次不做（明确排除，避免范围膨胀）

- 支付宝 / 微信支付等涉及资金的平台。
- feishu 完整三方 `user_access_token` 用户授权跳转（app 级 `tenant_access_token` 已够 MVP 的两个 action 用）。
- 计费/用量计量、控制台 UI、沙箱代码执行、人工审批链——这些是 Composio 的重活，等运行时模型本身验证过再排期。
- 推送到 GitHub / 创建远程仓库——本地 `git init` 即可，是否建远程仓库、要不要公开，实现完之后单独确认。
