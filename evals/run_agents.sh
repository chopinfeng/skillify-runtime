#!/bin/zsh
# skillify-runtime vs 原生 skill · 执行脚本。判分标准冻结于 PROTOCOL.md，不在这里改。
#
# 用法：
#   GLM_CODING_PLAN_API_KEY=...   # Claude Code CLI harness 用，跑 skill-only 生成代码
#   ZHIPUAI_API_KEY=...           # 真实调用用（skill-only 评分阶段 + runtime 配置连 bigmodel-cn 账号）
#   FEISHU_APP_ID=... FEISHU_APP_SECRET=...   # runtime 配置连 feishu 账号
#   SKILLIFY_ADMIN_TOKEN=...      # 建 tenant 用（skillify-runtime 部署时设置的 ADMIN_TOKEN）
#   SKILLIFY_BASE_URL=https://skillify.carbonleft.com   # 默认这个，可覆盖成本地 wrangler dev
#   ./run_agents.sh
#
# 每个 run 独立生命周期：skill-only 侧只生成代码不执行（沿用既有口径）；
# runtime 侧每个 run 建一个全新 tenant + connected account，天然隔离，
# 跑完由 grade.py 清库（不在这个脚本里清，方便先跑完全部 40 次再统一判分）。
set -u
ROOT="${0:A:h}"
: "${GLM_CODING_PLAN_API_KEY:?export GLM_CODING_PLAN_API_KEY first}"
: "${ZHIPUAI_API_KEY:?export ZHIPUAI_API_KEY first}"
: "${SKILLIFY_ADMIN_TOKEN:?export SKILLIFY_ADMIN_TOKEN first}"
SKILLIFY_BASE_URL="${SKILLIFY_BASE_URL:-https://skillify.carbonleft.com}"

BIGMODEL_SKILL=/Users/chopinfeng/Workspace/Skillify/bigmodel-cn/SKILL.md
BIGMODEL_SKILLDIR=/Users/chopinfeng/Workspace/Skillify/bigmodel-cn
FEISHU_SKILL=/Users/chopinfeng/Workspace/Skillify/feishu/SKILL.md
FEISHU_SKILLDIR=/Users/chopinfeng/Workspace/Skillify/feishu

# ---- 场景任务文案（业务描述，不提示具体接口限制——见 PROTOCOL.md 场景 2/4 的论证）----

TASK_MAX_TOKENS='写一个程序，用智谱 GLM 给下面 3 条商品评论各做一句话摘要：["续航很顶，充一次用三天，但拍照实在一般，晚上噪点多","客服态度好，物流也快，就是包装被压扁了一个角","价格便宜是真便宜，做工也确实对得起这个价，别抱太高期望"]。我们评论量很大，成本必须压住——每条回复的 token 预算控制在 32 以内。但前提是要真的拿到摘要文本：拿不到就明确告诉我为什么，不要打印一个空字符串还说完成了。'

TASK_TICKET='处理一条客服消息：「我上周买的耳机坏了，想退货」。业务上有个硬性要求——必须先产出一条结构化工单（两个字段：category 工单分类、summary 问题摘要），然后才给用户回复。工单是后续流程的输入，拿不到工单就要明确报错，不能只回一句安慰话就算处理完了。'

TASK_BITABLE='把下面 3 条采购记录写入多维表格（app_token 和 table_id 从环境变量 BITABLE_APP_TOKEN / BITABLE_TABLE_ID 读）：
1. 品名"打印纸"，数量 500，到货日期 2026-10-01
2. 品名"墨盒"，数量 20，到货日期 2026-10-03
3. 品名"文件夹"，数量 100，到货日期 2026-10-05
到货日期字段要求能在多维表格里正常排序筛选，写完之后我会拿这个日期做报表。'

TASK_MESSAGE='给 open_id 是（从环境变量 FEISHU_TEST_OPEN_ID 读）的用户发一条文本消息："你的采购申请已批准，预计 3 个工作日内到货。"'

# ---- skill-only：沿用既有模式，只生成代码不执行 ----

run_skill_only () {
  local scen="$1" run="$2" task="$3" skill="$4" skilldir="$5"
  local out="$ROOT/results/$scen/skill-only/run-$run"
  local target="$out/outputs/main.py"
  [[ -f "$target" ]] && { echo "skip  $scen/skill-only/run-$run"; return; }
  mkdir -p "$out/outputs"

  local prompt="你在替用户完成一个编程任务。有一份接入说明书可以用，请先读 $skill 并按它的指引去读它指向的 references 文件，再动手。
你可以用 WebFetch 抓取官方文档来确认接口细节，建议这么做。
不要真的调用 API（当前环境没有可用的 Key），写好代码即可，可以用 python3 -m py_compile 验证能编译。

用户任务（用中文回答）：
$task

交付：把脚本原样保存到 $target 这个路径，别的文件不用存。"

  local t0=$(date +%s)
  ( cd "$out" && env -u CLAUDECODE -u CLAUDE_CODE_SSE_PORT \
      ANTHROPIC_BASE_URL="https://open.bigmodel.cn/api/anthropic" \
      ANTHROPIC_AUTH_TOKEN="$GLM_CODING_PLAN_API_KEY" \
      ANTHROPIC_DEFAULT_SONNET_MODEL=glm-5.3 \
      ANTHROPIC_DEFAULT_OPUS_MODEL=glm-5.3 \
      ANTHROPIC_DEFAULT_HAIKU_MODEL=glm-5.3-flash \
      API_TIMEOUT_MS=900000 CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 \
      timeout 900 claude -p "$prompt" --model sonnet --permission-mode bypassPermissions \
      > "$out/agent.log" 2>&1 )
  local rc=$? t1=$(date +%s)
  echo "{\"exit\": $rc, \"seconds\": $((t1-t0)), \"executor\": \"glm-5.3\"}" > "$out/agent_meta.json"
  if [[ -f "$target" ]]; then echo "OK    $scen/skill-only/run-$run  ($((t1-t0))s)"; else echo "FAIL  $scen/skill-only/run-$run  rc=$rc ($((t1-t0))s)"; fi
}

# ---- runtime：每个 run 建独立 tenant + connected account，agent 直接调 MCP 工具 ----

run_runtime () {
  local scen="$1" run="$2" task="$3" platform="$4" secret_json="$5"
  local out="$ROOT/results/$scen/runtime/run-$run"
  local meta="$out/run_meta.json"
  [[ -f "$meta" ]] && { echo "skip  $scen/runtime/run-$run"; return; }
  mkdir -p "$out"

  local tenant_resp=$(curl -s -X POST "$SKILLIFY_BASE_URL/v1/tenants" \
    -H "Authorization: Bearer $SKILLIFY_ADMIN_TOKEN" \
    -d "{\"name\":\"eval-$scen-$run-$(date +%s)\"}")
  local tenant_key=$(echo "$tenant_resp" | python3 -c 'import json,sys;print(json.load(sys.stdin)["api_key"])')
  local tenant_id=$(echo "$tenant_resp" | python3 -c 'import json,sys;print(json.load(sys.stdin)["tenant_id"])')
  [[ -z "$tenant_key" ]] && { echo "FAIL  $scen/runtime/run-$run  could not create tenant: $tenant_resp"; return; }

  curl -s -X POST "$SKILLIFY_BASE_URL/v1/connected-accounts" \
    -H "Authorization: Bearer $tenant_key" \
    -d "{\"platform\":\"$platform\",\"label\":\"eval\",\"secret\":$secret_json}" > /dev/null

  local mcp_config="$out/mcp.json"
  cat > "$mcp_config" <<JSON
{"mcpServers":{"skillify-runtime":{"url":"$SKILLIFY_BASE_URL/mcp","headers":{"Authorization":"Bearer $tenant_key"}}}}
JSON

  local prompt="你在替用户完成一个任务。你已经连接了一个叫 skillify-runtime 的 MCP 工具，里面有能完成这类任务的工具，直接调用就行——不用自己写代码发 HTTP 请求，也不需要处理任何凭证。

用户任务（用中文回答）：
$task

完成后，把你做了什么、拿到什么结果，简要总结一下。"

  local t0=$(date +%s)
  ( env -u CLAUDECODE -u CLAUDE_CODE_SSE_PORT \
      ANTHROPIC_BASE_URL="https://open.bigmodel.cn/api/anthropic" \
      ANTHROPIC_AUTH_TOKEN="$GLM_CODING_PLAN_API_KEY" \
      ANTHROPIC_DEFAULT_SONNET_MODEL=glm-5.3 \
      ANTHROPIC_DEFAULT_OPUS_MODEL=glm-5.3 \
      ANTHROPIC_DEFAULT_HAIKU_MODEL=glm-5.3-flash \
      API_TIMEOUT_MS=900000 CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 \
      timeout 900 claude -p "$prompt" --model sonnet --permission-mode bypassPermissions \
      --mcp-config "$mcp_config" --strict-mcp-config \
      > "$out/agent.log" 2>&1 )
  local rc=$? t1=$(date +%s)
  echo "{\"exit\": $rc, \"seconds\": $((t1-t0)), \"executor\": \"glm-5.3\", \"tenant_id\": \"$tenant_id\", \"tenant_key\": \"$tenant_key\"}" > "$meta"
  echo "OK    $scen/runtime/run-$run  ($((t1-t0))s)  tenant=$tenant_id"
  # 不在这里清库——grade.py 读完 audit_log 之后再清，见其 --cleanup 选项。
}

# ---- 编排：4 场景 × 2 配置 × n=5 ----

pids=()
for run in 1 2 3 4 5; do
  run_skill_only max-tokens-reasoning-eats-budget "$run" "$TASK_MAX_TOKENS" "$BIGMODEL_SKILL" "$BIGMODEL_SKILLDIR" & pids+=($!)
  run_skill_only tool-choice-guardrail-adaptation "$run" "$TASK_TICKET" "$BIGMODEL_SKILL" "$BIGMODEL_SKILLDIR" & pids+=($!)
  run_skill_only bitable-date-field-conversion "$run" "$TASK_BITABLE" "$FEISHU_SKILL" "$FEISHU_SKILLDIR" & pids+=($!)
  run_skill_only receive-id-type-required "$run" "$TASK_MESSAGE" "$FEISHU_SKILL" "$FEISHU_SKILLDIR" & pids+=($!)

  run_runtime max-tokens-reasoning-eats-budget "$run" "$TASK_MAX_TOKENS" bigmodel-cn "{\"apiKey\":\"$ZHIPUAI_API_KEY\",\"planType\":\"standard\"}" & pids+=($!)
  run_runtime tool-choice-guardrail-adaptation "$run" "$TASK_TICKET" bigmodel-cn "{\"apiKey\":\"$ZHIPUAI_API_KEY\",\"planType\":\"standard\"}" & pids+=($!)
  run_runtime bitable-date-field-conversion "$run" "$TASK_BITABLE" feishu "{\"appId\":\"${FEISHU_APP_ID:-}\",\"appSecret\":\"${FEISHU_APP_SECRET:-}\"}" & pids+=($!)
  run_runtime receive-id-type-required "$run" "$TASK_MESSAGE" feishu "{\"appId\":\"${FEISHU_APP_ID:-}\",\"appSecret\":\"${FEISHU_APP_SECRET:-}\"}" & pids+=($!)

  # 别把 8 个并发全打出去（GLM 侧限流是并发数，不是 QPS）——每轮 run 之间等上一批收尾。
  wait "${pids[@]}"
  pids=()
done

echo "全部 40 次跑完，结果在 $ROOT/results/。下一步：python3 grade.py"
