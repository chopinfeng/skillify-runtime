# evals — runtime vs 原生 skill

回答一个具体问题："同样具备正确的接口知识,调 skillify-runtime 的 MCP 工具是不是比自己写代码调 API 更可靠"。方法论、场景选择依据、冻结判分标准见 [PROTOCOL.md](PROTOCOL.md)——**跑之前先读这份文件**，判分标准跑完不改。

## 现状

方法论已经设计完、脚本已经写完并做过 smoke test（`run_agents.sh` 语法检查、`grade.py` 用假数据跑通了两条路径的判分逻辑），但**还没跑过真实的 40 次批量执行**——需要：

1. `GLM_CODING_PLAN_API_KEY` — Claude Code CLI 作 harness 指向 GLM-5.3 用。
2. `ZHIPUAI_API_KEY` — bigmodel-cn 真实调用用（skill-only 配置的评分阶段执行生成脚本，runtime 配置连接 bigmodel-cn 账号）。
3. `FEISHU_APP_ID` / `FEISHU_APP_SECRET` — 一个自建测试应用，feishu 场景用（还没拿到过，此前几轮的真实调用验证只做过 bigmodel-cn）。
4. `BITABLE_APP_TOKEN` / `BITABLE_TABLE_ID` — 一个真实的多维表格，用来跑 `bitable-date-field-conversion` 场景并做写入后反查。
5. `FEISHU_TEST_OPEN_ID` — 一个测试用户的 open_id，`receive-id-type-required` 场景发消息的目标。
6. `SKILLIFY_ADMIN_TOKEN` — skillify-runtime 部署时设置的管理员 token,用来给 runtime 配置的每个 run 建独立 tenant。

## 跑法

```bash
export GLM_CODING_PLAN_API_KEY=...
export ZHIPUAI_API_KEY=...
export FEISHU_APP_ID=... FEISHU_APP_SECRET=...
export BITABLE_APP_TOKEN=... BITABLE_TABLE_ID=...
export FEISHU_TEST_OPEN_ID=...
export SKILLIFY_ADMIN_TOKEN=...

./run_agents.sh          # 4 场景 × 2 配置 × n=5 = 40 次运行，结果落在 results/
python3 grade.py         # 判分，写 results/**/grading.json + results/summary.json
python3 grade.py --cleanup   # 判完顺带清掉 runtime 配置在生产库里建的测试 tenant
```

全部跑完、判完分之后，按工作区既有约定写 `comparison-report.md`（Markdown，不要 HTML/Artifact——见 `Skillify/CLAUDE.md` 的约定）：顶部指标汇总表，每个场景「任务 / 结果 / skill-only 得分 / runtime 得分」，附 Task 和 Why 两段说明，结尾列出 `PROTOCOL.md` 里已经预先声明的「runtime 结构性优势 / 范围缺口」两节，不要漏。

## 已知限制（诚实记录，不是回避）

- `bitable-date-field-conversion` 和 `receive-id-type-required` 两个场景的 ground-truth 反查（写入记录后真的查一遍日期字段是不是数字、消息是不是真的送达）在 `grade.py` 里标了 TODO——真实 `app_token`/`table_id`/`open_id` 到位、看到第一批真实响应的实际形状之后再补完整,不瞎猜字段名。
- 这套方法论目前只覆盖 runtime 现有的 3 个 action（bigmodel-cn 1 个、feishu 2 个）；`PROTOCOL.md` 里已经列出哪些既有场景因为 action 目录还没覆盖而排除在外——等 runtime 加新 action，这份评测的场景库也要跟着扩。
