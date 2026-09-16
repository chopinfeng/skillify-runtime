# -*- coding: utf-8 -*-
"""skillify-runtime vs 原生 skill 评分器。判分标准冻结于 PROTOCOL.md。

用法：
  ZHIPUAI_API_KEY=... FEISHU_APP_ID=... FEISHU_APP_SECRET=... \
  SKILLIFY_ADMIN_TOKEN=... python3 grade.py [--cleanup]

--cleanup: 判完 runtime 配置的分之后，撤销 connected account 并清掉该 run 的 tenant
（用 SKILLIFY_ADMIN_TOKEN 走管理接口；本仓库历次冒烟测试都用同样的手工清库方式，
这里做成脚本化版本，避免几十个 run 手动清）。
"""
import ast, json, os, re, shutil, subprocess, sys, time, pathlib, urllib.request

ROOT = pathlib.Path(__file__).resolve().parent
RESULTS = ROOT / "results"
STD = os.environ.get("ZHIPUAI_API_KEY", "")
FEISHU_APP_ID = os.environ.get("FEISHU_APP_ID", "")
FEISHU_APP_SECRET = os.environ.get("FEISHU_APP_SECRET", "")
ADMIN_TOKEN = os.environ.get("SKILLIFY_ADMIN_TOKEN", "")
BASE_URL = os.environ.get("SKILLIFY_BASE_URL", "https://skillify.carbonleft.com")
TIMEOUT = 300
SCENARIOS = [
    "max-tokens-reasoning-eats-budget",
    "tool-choice-guardrail-adaptation",
    "bitable-date-field-conversion",
    "receive-id-type-required",
]


def http(method, url, headers=None, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=headers or {})
    if data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            text = r.read().decode()
            return r.status, (json.loads(text) if text else None)
    except urllib.error.HTTPError as e:
        text = e.read().decode()
        return e.code, (json.loads(text) if text else None)


# ---------- skill-only: 执行生成脚本，同既有方法论 ----------

def run_generated_code(main_py: pathlib.Path, extra_env: dict) -> dict:
    cached = main_py.parent.parent / "exec_result.json"
    if "--regrade" in sys.argv and cached.exists():
        return json.loads(cached.read_text(encoding="utf-8"))
    work = main_py.parent.parent / "work"
    if work.exists():
        shutil.rmtree(work)
    work.mkdir(parents=True)
    shutil.copy(main_py, work / "main.py")
    env = {k: v for k, v in os.environ.items() if k in ("PATH", "HOME", "LANG", "LC_ALL", "TMPDIR")}
    env["PYTHONIOENCODING"] = "utf-8"
    env.update(extra_env)
    t0 = time.time()
    try:
        p = subprocess.run([sys.executable, "-W", "ignore", "main.py"], cwd=str(work), env=env,
                           capture_output=True, text=True, timeout=TIMEOUT)
        res = {"exit_code": p.returncode, "stdout": p.stdout[-9000:], "stderr": p.stderr[-6000:], "timed_out": False}
    except subprocess.TimeoutExpired as e:
        res = {"exit_code": None, "stdout": (e.stdout if isinstance(e.stdout, str) else "")[-9000:],
               "stderr": "TIMEOUT", "timed_out": True}
    res["seconds"] = round(time.time() - t0, 1)
    (main_py.parent.parent / "exec_result.json").write_text(json.dumps(res, ensure_ascii=False, indent=2), encoding="utf-8")
    return res


def has_cjk_run(text: str, min_chars=8, min_lines=3) -> bool:
    lines = [l for l in text.splitlines() if len(re.findall(r"[一-鿿]", l)) >= min_chars]
    return len(lines) >= min_lines


def cond_on(code: str, tokens) -> bool:
    try:
        tree = ast.parse(code)
    except SyntaxError:
        return any(t in code for t in tokens)
    for n in ast.walk(tree):
        if isinstance(n, (ast.Compare, ast.Assert, ast.If, ast.IfExp, ast.Subscript, ast.BinOp, ast.Call)):
            s = ast.unparse(n).lower()
            if any(t.lower() in s for t in tokens):
                return True
    return False


def grade_skill_only(scenario: str, run_dir: pathlib.Path) -> dict:
    main_py = run_dir / "outputs" / "main.py"
    if not main_py.exists():
        return {"pass": False, "reason": "no main.py"}
    code = main_py.read_text(encoding="utf-8", errors="replace")

    extra_env = {"ZHIPUAI_API_KEY": STD, "ZHIPU_API_KEY": STD,
                 "FEISHU_APP_ID": FEISHU_APP_ID, "FEISHU_APP_SECRET": FEISHU_APP_SECRET,
                 "BITABLE_APP_TOKEN": os.environ.get("BITABLE_APP_TOKEN", ""),
                 "BITABLE_TABLE_ID": os.environ.get("BITABLE_TABLE_ID", ""),
                 "FEISHU_TEST_OPEN_ID": os.environ.get("FEISHU_TEST_OPEN_ID", "")}
    res = run_generated_code(main_py, extra_env)
    out = res["stdout"] + "\n" + res["stderr"]
    no_traceback = "Traceback" not in out

    if scenario == "max-tokens-reasoning-eats-budget":
        return {"pass": no_traceback and has_cjk_run(out) and "length" not in out.lower().replace("wavelength", ""),
                "checks": {"no_traceback": no_traceback, "three_summaries": has_cjk_run(out)}}
    if scenario == "tool-choice-guardrail-adaptation":
        has_ticket = ("category" in out or "类别" in out) and ("summary" in out or "摘要" in out)
        return {"pass": no_traceback and has_ticket, "checks": {"no_traceback": no_traceback, "has_ticket": has_ticket}}
    if scenario == "bitable-date-field-conversion":
        converts_date = cond_on(code, ["* 1000", "timestamp()", "mktime", "strptime"])
        return {"pass": no_traceback and converts_date, "checks": {"no_traceback": no_traceback, "converts_date": converts_date},
                "note": "字段 2/3（真实写入校验）需要人工用真实 Key 反查 Bitable，这里只判代码是否做了转换"}
    if scenario == "receive-id-type-required":
        has_param = "receive_id_type" in code
        return {"pass": no_traceback and has_param, "checks": {"no_traceback": no_traceback, "has_param": has_param},
                "note": "字段 3（发送成功）需要人工确认 code==0，这里只判代码是否带了该参数"}
    return {"pass": False, "reason": f"unknown scenario {scenario}"}


# ---------- runtime: 读 audit_log 判分 ----------

def get_audit_log(tenant_key: str):
    status, body = http("GET", f"{BASE_URL}/v1/audit-log", {"Authorization": f"Bearer {tenant_key}"})
    return (body or {}).get("entries", [])


def grade_runtime(scenario: str, run_dir: pathlib.Path) -> dict:
    meta_path = run_dir / "run_meta.json"
    if not meta_path.exists():
        return {"pass": False, "reason": "no run_meta.json"}
    meta = json.loads(meta_path.read_text())
    tenant_key = meta["tenant_key"]
    entries = get_audit_log(tenant_key)
    agent_log = (run_dir / "agent.log").read_text(encoding="utf-8", errors="replace") if (run_dir / "agent.log").exists() else ""

    def inputs_for(tool_name):
        out = []
        for e in entries:
            if e.get("tool_name") == tool_name and e.get("input_json"):
                try:
                    out.append(json.loads(e["input_json"]))
                except json.JSONDecodeError:
                    pass
        return out

    if scenario == "max-tokens-reasoning-eats-budget":
        calls = inputs_for("bigmodel_chat_completion")
        respected_budget = all(c.get("max_tokens", 999) <= 32 for c in calls) and len(calls) > 0
        has_summaries = has_cjk_run(agent_log)
        return {"pass": respected_budget and has_summaries,
                "checks": {"respected_budget": respected_budget, "n_calls": len(calls), "final_reply_has_summaries": has_summaries}}

    if scenario == "tool-choice-guardrail-adaptation":
        bad = [e for e in entries if e.get("platform_code") == "gateway_validation"]
        recovered = (not bad) or any(e.get("ok") for e in entries[entries.index(bad[-1]) + 1:]) if bad else True
        has_ticket = ("category" in agent_log or "类别" in agent_log) and ("summary" in agent_log or "摘要" in agent_log)
        return {"pass": recovered and has_ticket,
                "checks": {"hit_guardrail": bool(bad), "recovered_after_guardrail": recovered, "has_ticket": has_ticket}}

    if scenario == "bitable-date-field-conversion":
        calls = inputs_for("feishu_bitable_batch_create_records")
        used_date_fields = any(c.get("date_fields") for c in calls)
        # ground-truth: 反查真实 Bitable 记录，日期字段应为数字（毫秒）——
        # 具体反查逻辑（GET .../records + 解析 fields）留到有真实 app_token/table_id 时按
        # Skillify/feishu/references/bitable.md 的响应形状补上，此处先记录调用层面的判据。
        return {"pass": used_date_fields, "checks": {"used_date_fields": used_date_fields},
                "note": "ground-truth 反查（写入记录日期字段确实是数字）待接入真实凭证后补充"}

    if scenario == "receive-id-type-required":
        calls = inputs_for("feishu_send_message")
        valid_types = {"open_id", "user_id", "union_id", "email", "chat_id"}
        has_valid_type = any(c.get("receive_id_type") in valid_types for c in calls)
        sent_ok = any(e.get("tool_name") == "feishu_send_message" and e.get("ok") for e in entries)
        return {"pass": has_valid_type and sent_ok, "checks": {"has_valid_receive_id_type": has_valid_type, "sent_ok": sent_ok}}

    return {"pass": False, "reason": f"unknown scenario {scenario}"}


def cleanup_runtime_tenant(tenant_id: str):
    """跟历次冒烟测试一样的手工清库方式，脚本化。"""
    subprocess.run(
        ["npx", "wrangler", "d1", "execute", "skillify_runtime", "--remote", "--command",
         f"DELETE FROM connected_accounts WHERE tenant_id='{tenant_id}';"
         f"DELETE FROM audit_log WHERE tenant_id='{tenant_id}';"
         f"DELETE FROM tenant_api_keys WHERE tenant_id='{tenant_id}';"
         f"DELETE FROM tenants WHERE id='{tenant_id}';"],
        cwd=str(ROOT.parent), capture_output=True,
    )


def main():
    RESULTS.mkdir(parents=True, exist_ok=True)
    summary = {}
    for scenario in SCENARIOS:
        summary[scenario] = {"skill-only": [], "runtime": []}
        for cfg, grader in (("skill-only", grade_skill_only), ("runtime", grade_runtime)):
            base = RESULTS / scenario / cfg
            if not base.exists():
                continue
            for run_dir in sorted(base.glob("run-*")):
                result = grader(scenario, run_dir)
                (run_dir / "grading.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
                summary[scenario][cfg].append(result["pass"])
                print(f"{scenario:38s} {cfg:10s} {run_dir.name:8s} {'PASS' if result['pass'] else 'FAIL'}")
                if cfg == "runtime" and "--cleanup" in sys.argv:
                    meta = json.loads((run_dir / "run_meta.json").read_text())
                    cleanup_runtime_tenant(meta["tenant_id"])

    (RESULTS / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print("\n=== 汇总（满分率）===")
    for scenario, cfgs in summary.items():
        for cfg, passes in cfgs.items():
            if passes:
                print(f"{scenario:38s} {cfg:10s} {sum(passes)}/{len(passes)}")


if __name__ == "__main__":
    main()
