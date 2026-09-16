# skillify-runtime

Composio 式的托管执行网关 MVP：托管凭证 + 统一 tool-calling 执行接口，是 [Skillify](../Skillify) 静态知识产品（`SKILL.md` + `references/`）之外补的运行时那一层。设计与范围决策见 `docs/plan.md`（从 Skillify workspace 的规划会话导出，此仓库暂不重复维护）。

线上地址：**https://skillify.carbonleft.com**（REST API + MCP，都要求 `Authorization: Bearer <tenant api key>`）。

当前覆盖两个平台，分别代表两类凭证复杂度：

| 平台 | 凭证模型 | Action |
|---|---|---|
| `bigmodel-cn` | 静态 API Key，无过期 | `bigmodel_chat_completion` |
| `feishu` | app 级 `tenant_access_token`，网关自动换取/刷新（`ConnectedAccountDO`） | `feishu_send_message`、`feishu_bitable_batch_create_records` |

明确不做：支付宝/微信支付（涉资金，MVP 不碰）、feishu 三方 `user_access_token` 用户授权跳转（app 级 token 已够用）、计费/沙箱执行。控制台 UI 已经有了最小版本，见下文。

## 本地开发

```bash
npm install
wrangler d1 create skillify_runtime   # 把返回的 database_id 填进 wrangler.jsonc
npm run d1:migrate:local
wrangler secret put KEK_BASE64        # 32 字节随机密钥的 base64，例如: openssl rand -base64 32
wrangler secret put ADMIN_TOKEN       # 任意随机字符串，用于 POST /v1/tenants
npm run dev
```

## 用户系统：邮箱+密码登录

建 tenant 现在有两条路，互不冲突：管理员用 `ADMIN_TOKEN` 手工建（下面的 API 速览第 1 步），或者真人自助注册——**一个用户对应一个新建的 tenant**，为以后的 Web 控制台准备登录态。登录态是 session cookie，和调 REST/MCP 用的 tenant API Key 是两条独立的认证轨道，不能互换。

```bash
# 注册：自动开一个新 tenant，拿到一次性显示的 api_key，同时种下 session cookie
curl -c cookies.txt -X POST localhost:8787/v1/auth/signup \
  -d '{"email":"you@example.com","password":"at-least-8-chars"}'

# 登录：换一个新 session
curl -c cookies.txt -X POST localhost:8787/v1/auth/login \
  -d '{"email":"you@example.com","password":"at-least-8-chars"}'

# 我是谁（校验 session）
curl -b cookies.txt localhost:8787/v1/auth/me

# 登出：撤销这条 session（服务端删记录，不是纯签名 token 那种没法撤销的）
curl -b cookies.txt -X POST localhost:8787/v1/auth/logout
```

密码用 PBKDF2-HMAC-SHA256 哈希，**100,000 次迭代**——OWASP 现在推荐 210,000，但 Workers 运行时的 WebCrypto PBKDF2 实现硬性上限就是 100,000（`NotSupportedError`，本地 `wrangler dev` 用的 Miniflare 不会拦，只有部署到真实 Workers 才报错，踩过一次坑，见 `src/lib/password.ts` 注释）。登录失败一律返回同一句 `invalid email or password`，不区分是邮箱不存在还是密码错。这轮没做的：密码重置、邮箱验证、登录失败限流、单设备踢旧 session。

`connected-accounts` / `execute` / `audit-log` 这几个原本只认 tenant API Key 的接口，现在**也**认 session cookie（`lib/auth.ts` 的 `authenticateTenant` 两条认证轨道都试）——这样控制台才能用登录态直接管理自己的 tenant，不用先手动去拿一把 key。

## 控制台

`GET /console` 是一个纯静态 HTML + 原生 JS 页面（零依赖、Worker 直接吐，没有前端构建步骤），登录/注册、管理 connected accounts、管理 API Key、看审计日志、复制 MCP 配置片段都在这一页。API Key 现在可以事后补开：`POST /v1/api-keys`（session 认证，返回一次性明文）、`GET /v1/api-keys`（列出 id/创建时间/是否撤销，不含明文）、`DELETE /v1/api-keys/:id`（撤销）——不然注册时那把一次性 Key 一丢，之前就再也拿不到能用的 Key 了。

## API 速览

所有非 admin 接口都要求 `Authorization: Bearer <tenant api key>`。

```bash
# 1. 用 ADMIN_TOKEN 建一个 tenant，拿到它的 api key（只显示这一次）——运维/脚本化路径，和上面的自助注册并存
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

## MCP：一个 URL 接入任何 Agent

除了 REST API，同一套 action 目录也通过 `POST /mcp`（Streamable HTTP，`@modelcontextprotocol/server` 的 `createMcpHandler`）暴露成标准 MCP 工具——这是看完 Composio dashboard 后补的：它能被任何 agent 一键接入靠的就是一个 MCP endpoint，而不是要求调用方自己写 REST 客户端代码。

在支持自定义 MCP server 的客户端（Claude Code、Cursor、Claude Desktop 等）里配置：

```json
{
  "mcpServers": {
    "skillify-runtime": {
      "url": "https://skillify.carbonleft.com/mcp",
      "headers": { "Authorization": "Bearer <tenant api key>" }
    }
  }
}
```

和 REST 的关键差异：MCP 的 `tools/call` **不需要传 `connected_account_id`**——网关自动挑该 tenant 在对应平台下最近一次创建、未撤销的 connected account（`db.ts` 的 `getMostRecentConnectedAccount`）。这模拟的是 Composio dashboard「连过的 app 直接能用」的体验；账号本身还是走 REST 的 `POST /v1/connected-accounts` 连。一个 tenant 在同一平台下挂多个账号时，MCP 侧目前只会用最新那个——还没做「选哪个账号」的显式入参，这是已知的简化，不是遗漏。

## CLI

`cli/skillify.mjs`（零依赖，Node 18+ 自带的 `fetch` 就够）——对应 Composio 的 `composio search` / `composio execute`：

```bash
export SKILLIFY_API_KEY=sk_live_xxx   # 从 /console 或 POST /v1/api-keys 拿

node cli/skillify.mjs tools                        # 列出所有工具
node cli/skillify.mjs search feishu                 # 按关键字找工具
node cli/skillify.mjs execute bigmodel_chat_completion -d '{"model":"glm-4.6","messages":[{"role":"user","content":"hi"}]}'
node cli/skillify.mjs accounts                       # 列出已连接账号
node cli/skillify.mjs audit-log                      # 最近调用记录
```

`execute` 走的是 `/mcp`（先 `initialize` 再 `tools/call`），不是 REST——这样天然复用 MCP 那条「自动选最新 connected account」的路径，命令行不用管 `connected_account_id`。`npm link` 之后可以直接用 `skillify` 这个命令（`package.json` 已经声明了 `bin`），没做的话就用 `node cli/skillify.mjs`。

## 测试

```bash
npm test                     # 纯逻辑单元测试：信封加密往返、两个平台的错误归一化
BIGMODEL_API_KEY=sk-xxx npm test   # 加上 bigmodel-cn 真实调用联调
FEISHU_APP_ID=... FEISHU_APP_SECRET=... npm test   # 加上 feishu 真实调用联调
```

真实凭证测试复用了 `Skillify/bigmodel-cn/evals/evals.json` 与 `Skillify/feishu/evals/evals.json` 里已经验证过的场景断言口径——网关不应该比 Agent 自己写代码调用更不准。

**这句话本身现在有一套专门的评测方法论去验证，不只是口号**：[evals/PROTOCOL.md](evals/PROTOCOL.md) 设计了 skill-only（Agent 自己写代码）vs runtime（Agent 直接调 MCP 工具）的对照实验，`evals/run_agents.sh` + `evals/grade.py` 是可跑的 harness，方法论已冻结、脚本已 smoke test 过，等真实凭证到位就能跑 40 次批量验证。

## 已知取舍（MVP 阶段）

- 限流是单个 connected account 内的简单节流（`ConnectedAccountDO.throttle`），不是按平台文档表格里的分级 QPS 精确实现。
- 审计日志直接写 D1，没有做量大后搬 Queues/R2 的分流。
- `KEK_BASE64` 是普通 Worker secret，不是 Cloudflare Secrets Store 资源——先够用，后续要升级路径明确（换成从 Secrets Store 读取即可，`lib/crypto.ts` 的接口不用变）。
- MCP 侧的账号选择是「同平台下最新一个」，没有多账号显式选择；也没有做 Composio 那种「团队共享一次连接、全员在 MCP 里直接用」的模式，一个 tenant API key 目前就是唯一的隔离边界。
- 用户系统是「一个用户 = 一个 tenant」，没有团队/多用户共享 tenant；也没有密码重置、邮箱验证、登录限流；session 没做单设备互踢。
- 控制台是纯前端页面调现有 REST 接口，没有独立的控制台专用后端。
- CLI 只有 `tools`/`search`/`execute`/`accounts`/`audit-log` 五个子命令，没有 `composio` 那种一键 install 到各种 agent 客户端的能力（那是 `/console` 里的 MCP 配置片段在做）。

## 相对 Composio 的已知差距（不是本仓库要追平的，是记录清楚在哪）

对着 Composio 实际 dashboard（1540 个应用、仅 GitHub 一家 872 个 action、CLI + 15 个客户端一键装、团队共享连接）核对过一轮：规模（app/action 数量）不打算追——那和这个项目「深度核实优于广度覆盖」的定位冲突，Composio 的目录是自动生成的，我们的是手工核实过真实调用的。已经补上的：控制台 UI、账号自助管理、API Key 自助管理、CLI。明确不做的（用户已确认）：多租户/团队模型。还会考虑的：per-app 的细粒度权限（Composio 叫 "Enhanced Control"）、计费。不考虑：自动生成规模化 action 目录。
