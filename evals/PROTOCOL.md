# skillify-runtime vs 原生 skill · 评测协议（开跑前冻结）

## 要回答的问题

用户在 `/goal` 里问的是："对 skillify 后的托管 skill 比原生 skill 效果更好"——即：同样具备正确的接口知识，Agent 直接**调用 skillify-runtime 的 MCP 工具**去完成任务，是不是比 Agent **照着 Skillify 的 `SKILL.md`/`references` 自己写调用代码**更可靠？

这不是"有没有 skill 帮助"（Skillify workspace 的 `bigmodel-cn-workspace/glm-round*` 系列已经用 GLM-5.3 反复验证过，54/56 vs 35/56，p=9×10⁻⁶）。两条路径拿到的**接口知识量是对等的**——runtime 的 action 目录本身就是从已验证的 `references/*.md` 里抠出来的（见 [README.md](../README.md)）。这一轮要测的是：**知识对等的前提下，"自己写代码调 API" 和 "调一个已经把凭证、重试、格式坑都接管掉的工具" 之间，结果会不会不一样，为什么。**

## 两个配置

| | **skill-only（原生技能）** | **runtime（skillify 托管）** |
|---|---|---|
| Agent 拿到什么 | `Skillify/bigmodel-cn/SKILL.md` + `references/`（或 feishu 对应的） | 一句话告诉它：skillify-runtime 的 MCP 工具已经连好了对应平台的账号，直接调用 `bigmodel_chat_completion` / `feishu_send_message` / `feishu_bitable_batch_create_records` |
| Agent 做什么 | 写 `main.py`，用 `requests` 自己拼 HTTP 请求、自己处理凭证/重试/错误形状 | 直接发起 MCP `tools/call`，业务参数之外什么都不用管 |
| 是否实时调用真实 API | **不**——写代码阶段没有 Key（延续 `glm-round*` 的口径：Agent 写代码时拿不到 Key），跑完之后由评分器用真实 Key 执行生成的脚本 | **是**——runtime 走的就是真实凭证，agent 跑的时候就是在打真实 API，这是这个配置的本质（"调用" 本身就是产出物，没有"事后再执行"这一步） |
| 判分依据 | 执行生成脚本的 stdout/stderr/退出码（既有方法论） | skillify-runtime 的 `GET /v1/audit-log`（`input_json`/`output_json`，2026-09-16 刚加的字段）+ 针对该次调用的真实结果做 ground-truth 复核 |

两个配置用**同一个执行器**（GLM-5.3，Claude Code CLI 仅作 harness），遵守已有的"执行器不可混用"规则——不同模型的结果不能合并统计。

## 场景怎么选：三条排除规则

沿用工作区已经验证过的出题配方（见 [Skillify/README.md](../../Skillify/README.md) 的"什么样的场景才有区分度"），但这一轮多两条**排除**规则，因为对比的对象变了：

**排除类别 A —— runtime 结构性消灭了这个坑，不是"两边都可能答对答错"，是 runtime 那一侧压根不可能答错。** 计入统计会人为拉高 runtime 的胜率，不是真的在测"业务逻辑对不对"。这类坑单独列出来作为**定性优势**记录，不进 Fisher 检验：

- feishu `Authorization: Bearer ` 前缀漏写——runtime 从不把 token 交给 agent，这个错误类别在 runtime 侧根本不存在。
- `tenant_access_token` 该不该刷新——runtime 的 `ConnectedAccountDO` 全权处理。
- bigmodel-cn 标准 Key 打到 Coding Plan 端点（或反过来）——runtime 从 connected account 的 `planType` 自动选 `base_url`。

**排除类别 B —— runtime 现在的 action 目录还没覆盖那个接口，不是设计上消灭，是还没实现。** 这类不算"runtime 更差"，是范围缺口，记录待办，不进这轮统计：

- 知识库校验、async chat、function-calling 多轮循环、文件上传——`bigmodel_chat_completion` 目前只暴露 chat completion 一个端点。
- feishu 审批、通讯录、除 Bitable 外的多维表格接口——`feishu_send_message`/`feishu_bitable_batch_create_records` 只覆盖这两块。

**保留 —— 业务逻辑层面的坑，两个配置都有可能踩，且踩的方式不同**，这才是这轮真正要测的：Agent 是否正确处理了业务约束，而不是"有没有平台知识"。4 个场景全部满足既有的区分度三条（任务约束堵死绕行、正确答案不在文档正文、错误静默或延迟暴露）。

## n 与统计

每场景 × 每配置 **n=5**，4 场景 × 2 配置 × 5 = **40 次运行**。Fisher 精确检验算满分率的双尾 p，方法与既有轮次一致。

## 场景与冻结判分标准

### 1. `max-tokens-reasoning-eats-budget`（bigmodel-cn）

**任务**：给 3 条商品评论各做一句话摘要，成本敏感，**每条回复的 token 预算压到 32 以内**。必须真的拿到摘要文本；拿不到要说明原因，不许把空文本当成功。

这是 `glm-round5` 已经验证过的坑（`max_tokens` 被思考消耗殆尽，`finish_reason: length` + 空 `content`）——这一轮之所以能搬过来，是因为 2026-09-16 刚修的一个 bug：runtime 的 MCP 工具 schema 之前是裸 `z.object()`，会静默丢弃没在 schema 里列出的字段，`max_tokens` 传了等于没传；加了 `.passthrough()` 之后才真正打到平台。**这本身就是"托管 skill 也可能有自己的 bug"的一个例证，判分前先如实记在这里。**

skill-only 判分（执行生成脚本）：

| # | 判分项 | 通过条件 |
| :-: | :--- | :--- |
| 1 | 无未捕获异常 | stdout+stderr 无 `Traceback` |
| 2 | 三条摘要都拿到了非空文本 | 输出中出现 ≥3 行含 ≥8 个中文字符的内容 |
| 3 | 没有把空回答当成完成 | 不存在"出现 `length` 截断迹象且摘要为空却宣称成功" |

runtime 判分（读 `audit_log`）：

| # | 判分项 | 通过条件 |
| :-: | :--- | :--- |
| 1 | 每次 `tools/call` 的 `input_json` 确实带了 `max_tokens<=32` | 三次调用（每条评论一次，或视 agent 策略合并为一次）的 `input_json` 里 `max_tokens` 字段存在且 ≤32 |
| 2 | agent 最终答复里包含三条非空摘要 | 同 skill-only 判分项 2，检查 agent 的最终文本回复，不是检查 `output_json` 原始响应（因为原始响应就算是空 `content` 也会 `ok:true`——这正是坑本身） |
| 3 | 没有把空回答当成完成 | 同 skill-only 判分项 3 |

### 2. `tool-choice-guardrail-adaptation`（bigmodel-cn，两配置任务不同，见下）

这个坑在原版（`glm-round5` 的 `forced-tool-choice-ignored`）里测的是"强制 `tool_choice` 被平台静默降级"。**这一条不能直接照搬**：runtime 对非 `"auto"` 的 `tool_choice` 是**主动拦截**（`400 gateway_validation`，见 `bigmodel-cn/actions.ts`），根本不会把请求转发给平台——这属于类别 A（结构性消灭），如果 runtime 侧的任务也是"强制 tool_choice"，它会 100% "答对"（因为压根没机会犯这个错），不是公平对比。

改成测**下一层**：两个配置的 agent 都不被告知 `tool_choice` 的限制，让它们自己在任务压力下尝试强制结构化输出，看谁能**正确地从失败中恢复**而不是卡住或者假装成功。

**任务**（两配置相同）：客服工单脚本，业务硬性要求——必须先产出一条结构化工单（`category` 与 `summary` 两个字段），再给用户回复；工单拿不到就要报错，不能只回一句话就算完。**不提示**该用什么手段保证结构化，也不提示 `tool_choice` 的限制。

skill-only 判分（执行生成脚本，同 `glm-round5` 原判分标准）：

| # | 判分项 | 通过条件 |
| :-: | :--- | :--- |
| 1 | 无未捕获异常 | 无 `Traceback` |
| 2 | 真的产出了结构化工单 | 输出中同时出现 `category`/`类别` 与 `summary`/`摘要` 两字段且都有非空值 |
| 3 | 没有在没拿到工单时宣称完成 | 不存在"未产出工单却宣称成功" |

runtime 判分（读 `audit_log` + agent 最终回复）：

| # | 判分项 | 通过条件 |
| :-: | :--- | :--- |
| 1 | 如果 agent 试过非 `auto` 的 `tool_choice`，遇到 `400 gateway_validation` 之后**没有卡死重复重试同一个错误**，且最终改用别的手段（比如更明确的 prompt、检查 `tool_calls` 是否存在） | 检查该 tenant 在这个场景下的 `audit_log` 序列：若存在 `platform_code="gateway_validation"` 的记录，其后必须有至少一次成功调用（`ok=1`），不能以失败告终 |
| 2 | 真的产出了结构化工单 | 同 skill-only 判分项 2，检查 agent 最终回复 |
| 3 | 没有在没拿到工单时宣称完成 | 同 skill-only 判分项 3 |

### 3. `bitable-date-field-conversion`（feishu）

**任务**：把 3 条采购记录（含一个"到货日期"字段，人类可读格式如 `2026-10-01`）写入多维表格。日期字段在库里要能正常排序、筛选。

已验证的坑：Bitable 日期字段要求 epoch 毫秒时间戳，人类可读字符串会被当成不合规数据（feishu 侧行为，见 `Skillify/feishu/references/bitable.md`）。两个配置面对的是**同一个底层知识要求**（"这个字段要转毫秒"），但**应用这个知识的方式不同**：

skill-only 判分：

| # | 判分项 | 通过条件 |
| :-: | :--- | :--- |
| 1 | 无未捕获异常 | 无 `Traceback` |
| 2 | 生成脚本里对日期字段做了到毫秒的转换 | AST 检查：代码中存在对日期字段值的数值运算（`* 1000` 或 `timestamp()` 类调用），不是原样传字符串 |
| 3 | 三条记录写入后可查询到且日期字段是数字类型 | 评分器用真实 Key 反查刚写入的记录，日期字段解析为 `int`/`float` 而非字符串 |

runtime 判分（读 `audit_log` + ground-truth 复核）：

| # | 判分项 | 通过条件 |
| :-: | :--- | :--- |
| 1 | `tools/call` 的 `input_json` 里 `date_fields` 参数存在且包含正确的字段名 | 检查 `input_json.date_fields` 是否非空数组且包含到货日期对应的字段名 |
| 2 | 三条记录写入后可查询到且日期字段是数字类型 | 同 skill-only 判分项 3，评分器直接查真实 Bitable 数据反查（不依赖 agent 自陈） |

**这一条是这轮设计里最能体现"托管 skill 价值在哪"的场景**：skill-only 侧的正确做法要求 agent 在生成代码里**正确实现**日期转换（时区、单位都可能写错，是新的 bug 引入点）；runtime 侧的正确做法只要求 agent **说出哪个字段是日期**（`date_fields` 参数），转换本身由网关代做——如果 runtime 胜出，胜出的原因不是"runtime 更懂 API"，是"runtime 把一处容易犯错的实现细节从 agent 的产出物里移除了"。这个区别值得在报告里专门写清楚，不能笼统地说"runtime 更好"。

### 4. `receive-id-type-required`（feishu）

**任务**：给一个用户发一条文本消息，用户标识是一个 `open_id`。

已验证的坑：`receive_id_type` 是必填 query 参数，没有默认值，漏传会失败（`Skillify/feishu/references/messaging-bots.md`）。这一条**不完全是类别 A**——runtime 的 MCP 工具 schema 把 `receive_id_type` 标成必填 enum 字段，模型在**决定怎么调工具**这一步就会被 schema 逼着填；但这依赖模型认真读 schema，不是 100% 保证（模型可能瞎填一个不在 enum 里的值，或者，如果调用方用的是没做 schema 校验的旧 MCP 客户端，理论上仍可能漏传）——所以还是留在保留场景里，不算结构性消灭。

skill-only 判分：

| # | 判分项 | 通过条件 |
| :-: | :--- | :--- |
| 1 | 无未捕获异常 | 无 `Traceback` |
| 2 | 请求 URL 带了 `receive_id_type` query 参数 | 代码中存在该参数的拼接/传递 |
| 3 | 消息发送成功 | 评分器用真实 Key 执行，检查响应 `code==0` |

runtime 判分：

| # | 判分项 | 通过条件 |
| :-: | :--- | :--- |
| 1 | `input_json` 里 `receive_id_type` 存在且值在 `["open_id","user_id","union_id","email","chat_id"]` 内 | 直接检查字段 |
| 2 | 消息发送成功 | 检查该条 `audit_log` 记录 `ok=1` |

## 执行机制

### skill-only 配置

沿用 `Skillify/bigmodel-cn-workspace/glm-round5/run_agents.sh` 的既有模式：Claude Code CLI 作为 harness，`ANTHROPIC_BASE_URL` 指向智谱 `…/api/anthropic`，`ANTHROPIC_AUTH_TOKEN` 用 Coding Plan Key，`--model sonnet` 实际路由到 `glm-5.3`。Agent 写代码时**不给真实 Key**（环境变量占位），跑完用 `grade.py` 风格的脚本执行真实调用。

### runtime 配置

**每次 run 独立生命周期**（避免跨 run 污染 `audit_log`）：

1. 用 `ADMIN_TOKEN` 建一个全新 tenant（`POST /v1/tenants`），拿到 tenant API key。
2. 用真实平台凭证（bigmodel-cn Key / feishu app_id+secret，从环境变量读）挂一个 connected account（`POST /v1/connected-accounts`）。
3. 起 agent（同样用 Claude Code CLI + GLM-5.3 作 harness），在 `~/.claude/mcp.json`（或该次运行专用的 MCP 配置）里把 `skillify-runtime` 指到 `https://skillify.carbonleft.com/mcp`，`Authorization: Bearer <这次 run 的 tenant key>`——**每个 run 用独立 tenant，天然隔离，不用现造清空逻辑**。
4. Agent 执行任务，允许它真的调用 MCP 工具（这就是"调用"本身在发生）。
5. 跑完，评分器用该 tenant 的 key 打 `GET /v1/audit-log`，取这次 run 期间产生的记录，按上面冻结的标准判分；日期/消息类场景另外用真实 Key 做一次独立的 ground-truth 反查。
6. 判完分，`DELETE /v1/connected-accounts/:id` 撤销连接、用 `wrangler d1 execute --remote` 手工清掉这个 tenant 的所有行（沿用本仓库这几轮一直用的清库方式）——不留测试数据在生产库里。

## 事前声明

- 判分标准以本文件为准，跑完不再修改；若发现评分器 bug，修正后两侧一起重判，报告如实记录涨跌。
- 场景 2（`tool-choice-guardrail-adaptation`）和场景 4（`receive-id-type-required`）的"这条到底算不算类别 A"已经在上文逐条论证过，跑之前就定了，不因为看到结果而事后改判。
- 类别 A/B 排除的坑单独在报告里列一节"runtime 结构性优势 / 范围缺口"，不参与 Fisher 检验，避免把"这个错误不可能发生"包装成"业务逻辑更强"。
- 场景 1 里提到的 MCP schema passthrough bug（`.passthrough()` 修复）是这轮设计过程中真实发现的，不是编出来的例子——如实写进报告，说明 runtime 侧的"托管"不等于"零 bug"，本身也需要被评测和修复。
