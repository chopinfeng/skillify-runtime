/**
 * Public landing page at GET / — describes the product for a first-time
 * visitor. Same philosophy as console.ts: one dependency-free HTML file,
 * no build step, Worker-served directly.
 */
const HTML = `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>skillify-runtime</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #ffffff;
    --bg-alt: #f6f7f9;
    --fg: #16181d;
    --fg-muted: #5b6270;
    --border: #e3e5e9;
    --accent: #5b47e0;
    --accent-fg: #ffffff;
    --code-bg: #14151a;
    --code-fg: #e8e9ec;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --bg: #0e0f13;
      --bg-alt: #16181f;
      --fg: #eceef2;
      --fg-muted: #9aa1b0;
      --border: #2a2d38;
      --accent: #8a7bff;
      --accent-fg: #101018;
      --code-bg: #08090c;
      --code-fg: #d9dbe3;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--fg);
    font: 15px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  a { color: var(--accent); }
  .wrap { max-width: 880px; margin: 0 auto; padding: 0 20px; }
  header.top {
    display: flex; align-items: center; justify-content: space-between;
    padding: 20px 0;
  }
  .brand { font-weight: 700; font-size: 16px; letter-spacing: -0.01em; }
  nav a { margin-left: 20px; font-size: 14px; text-decoration: none; color: var(--fg-muted); }
  nav a:hover { color: var(--fg); }

  .hero { padding: 56px 0 40px; }
  .hero h1 { font-size: clamp(28px, 5vw, 40px); line-height: 1.15; margin: 0 0 16px; letter-spacing: -0.02em; }
  .hero .lede { font-size: 17px; color: var(--fg-muted); max-width: 620px; margin: 0 0 28px; }
  .cta-row { display: flex; gap: 12px; flex-wrap: wrap; }
  .btn {
    display: inline-block; padding: 10px 20px; border-radius: 8px; font-size: 14px; font-weight: 600;
    text-decoration: none; border: 1px solid transparent; cursor: pointer;
  }
  .btn-primary { background: var(--accent); color: var(--accent-fg); }
  .btn-secondary { background: transparent; color: var(--fg); border-color: var(--border); }

  section { padding: 40px 0; border-top: 1px solid var(--border); }
  section > h2 { font-size: 22px; margin: 0 0 8px; letter-spacing: -0.01em; }
  section > .sub { color: var(--fg-muted); margin: 0 0 28px; max-width: 640px; }

  .grid3 { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; }
  .card { background: var(--bg-alt); border: 1px solid var(--border); border-radius: 10px; padding: 18px; }
  .card h3 { font-size: 15px; margin: 0 0 8px; }
  .card p { font-size: 13.5px; color: var(--fg-muted); margin: 0; }

  .gotcha-list { display: flex; flex-direction: column; gap: 14px; }
  .gotcha { background: var(--bg-alt); border: 1px solid var(--border); border-radius: 10px; padding: 16px 18px; }
  .gotcha .tag { font-size: 11px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: var(--accent); }
  .gotcha p { margin: 6px 0 0; font-size: 13.5px; color: var(--fg-muted); }
  .gotcha code { font-size: 12.5px; }

  table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
  th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--border); }
  th { color: var(--fg-muted); font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.03em; }
  code { background: var(--bg-alt); border: 1px solid var(--border); border-radius: 4px; padding: 1px 5px; font-size: 0.9em; }

  .steps { counter-reset: step; display: flex; flex-direction: column; gap: 4px; }
  .step { display: flex; gap: 14px; padding: 14px 0; }
  .step::before {
    counter-increment: step; content: counter(step);
    flex: none; width: 26px; height: 26px; border-radius: 50%;
    background: var(--accent); color: var(--accent-fg); font-size: 12px; font-weight: 700;
    display: flex; align-items: center; justify-content: center;
  }
  .step div h3 { margin: 0 0 4px; font-size: 14.5px; }
  .step div p { margin: 0; font-size: 13.5px; color: var(--fg-muted); }

  pre {
    background: var(--code-bg); color: var(--code-fg); border-radius: 10px; padding: 16px;
    overflow-x: auto; font-size: 12.5px; line-height: 1.6;
  }
  .code-wrap { position: relative; }
  .copy-btn {
    position: absolute; top: 10px; right: 10px; font-size: 11px; padding: 4px 10px;
    border-radius: 6px; border: 1px solid #ffffff33; background: #ffffff14; color: var(--code-fg); cursor: pointer;
  }

  footer { padding: 32px 0 48px; color: var(--fg-muted); font-size: 13px; }
  footer a { color: var(--fg-muted); }
</style>
</head>
<body>
<div class="wrap">
  <header class="top">
    <div class="brand">skillify-runtime</div>
    <nav>
      <a href="#coverage">支持的平台</a>
      <a href="#for-agents">给 Agent</a>
      <a href="#mcp">MCP 接入</a>
      <a href="/console">控制台</a>
    </nav>
  </header>

  <section class="hero" style="border-top:none;padding-top:20px;">
    <h1>给 AI Agent 用的第三方 API 执行层</h1>
    <p class="lede">
      托管凭证、统一 tool-calling 接口、一个 URL 接入任何 MCP 客户端。
      Action 目录不是自动生成的——每一条都从真实调用里验证过，连带记下了官方文档没写清楚的坑。
    </p>
    <div class="cta-row">
      <a class="btn btn-primary" href="/console">免费注册</a>
      <a class="btn btn-secondary" href="#mcp">看 MCP 配置</a>
    </div>
  </section>

  <section>
    <h2>是什么</h2>
    <p class="sub">Agent 不用再自己写 HTTP 客户端代码——凭证托管、重试、错误归一化、审计留痕都在网关这一层做掉。</p>
    <div class="grid3">
      <div class="card">
        <h3>凭证托管</h3>
        <p>信封加密存储，密文从不回显明文；网关代你处理 token 换取、刷新、header 格式这些容易踩坑的细节。</p>
      </div>
      <div class="card">
        <h3>统一执行</h3>
        <p>不同平台的错误形状被归一化成同一种结果——不用再单独学"这个平台信不信 HTTP 状态码"这种细节。</p>
      </div>
      <div class="card">
        <h3>MCP 一键接入</h3>
        <p>Claude Code、Cursor、Claude Desktop 等任何支持自定义 MCP server 的客户端，配一个 URL 就能用。</p>
      </div>
    </div>
  </section>

  <section>
    <h2>真实踩过的坑，不是编的例子</h2>
    <p class="sub">每个 action 的行为都对着真实 API 调用验证过，下面是几个已经在网关这一层挡掉、或者明确记录下来的例子。</p>
    <div class="gotcha-list">
      <div class="gotcha">
        <span class="tag">bigmodel-cn</span>
        <p><code>tool_choice</code> 只接受 <code>"auto"</code>，其它值平台会静默降级——网关在请求发出前就拦下来，返回明确的校验错误，而不是让 Agent 自己在事后发现模型没按预期强制调用工具。</p>
      </div>
      <div class="gotcha">
        <span class="tag">feishu</span>
        <p>多维表格的日期字段要求毫秒级时间戳，传人类可读格式会被当成不合规数据——网关接受 <code>date_fields</code> 参数，替调用方做单位转换，不用在业务代码里手写这段容易出错的换算。</p>
      </div>
      <div class="gotcha">
        <span class="tag">feishu</span>
        <p>发消息接口的 <code>receive_id_type</code> 没有默认值，漏传直接失败——MCP 工具 schema 把它标成必填枚举字段，模型在决定怎么调用之前就会被提醒。</p>
      </div>
    </div>
  </section>

  <section id="coverage">
    <h2>目前支持的平台</h2>
    <p class="sub">规模不是这个项目要追的指标——每一条都经过真实调用验证，比自动生成的大而全目录更值得信任。</p>
    <table>
      <thead><tr><th>平台</th><th>凭证模型</th><th>Action</th></tr></thead>
      <tbody>
        <tr><td>bigmodel-cn（智谱 GLM）</td><td>静态 API Key</td><td><code>bigmodel_chat_completion</code></td></tr>
        <tr><td>飞书</td><td>app 级 token，网关自动续期</td><td><code>feishu_send_message</code>、<code>feishu_bitable_batch_create_records</code></td></tr>
      </tbody>
    </table>
  </section>

  <section>
    <h2>怎么用</h2>
    <div class="steps">
      <div class="step"><div><h3>注册</h3><p>邮箱密码或 Auth0 登录，自动开一个属于你的账号空间。</p></div></div>
      <div class="step"><div><h3>连接账号</h3><p>在控制台挂上第三方平台的凭证——加密存储，密文从不回显。</p></div></div>
      <div class="step"><div><h3>调用</h3><p>REST API、MCP、或者命令行 CLI，选一种顺手的方式接入 Agent。</p></div></div>
      <div class="step"><div><h3>看审计日志</h3><p>每次调用的参数、结果、耗时都留痕，出问题不用靠猜。</p></div></div>
    </div>
  </section>

  <section id="for-agents">
    <h2>给 Agent：不用人先注册</h2>
    <p class="sub">
      上面"怎么用"那四步是给人看的。如果你是一个 Agent，不需要先等人给你开账号——自己调一个接口就能拿到能用的凭证，
      机器可读版本在 <a href="/llms.txt"><code>/llms.txt</code></a>。
    </p>
    <div class="steps">
      <div class="step">
        <div>
          <h3>先解一道工作量证明</h3>
          <p><code>GET /v1/auth/pow-challenge</code> 拿一个 challenge，算出一个 <code>solution</code> 让 <code>sha256(challenge + ":" + solution)</code> 前面有足够多的 0 比特——默认难度在普通机器上一般 2 秒以内能解出来。这一步和按 IP 限流（每小时 5 次）是两道独立的防刷关卡，同时生效，换 IP 绕不过工作量证明。完整算法和代码示例见 <a href="/llms.txt"><code>/llms.txt</code></a>。</p>
        </div>
      </div>
      <div class="step">
        <div>
          <h3>自主注册</h3>
          <p><code>POST /v1/auth/agent-register</code>，附上上一步的 <code>challenge</code> 和 <code>solution</code>，不用邮箱密码。返回一个 <code>tenant_id</code> 和一次性显示的 <code>api_key</code>，立刻就能拿去调 <code>/v1/tools</code>、<code>/mcp</code>。</p>
        </div>
      </div>
      <div class="step">
        <div>
          <h3>未认领 ≠ 可长期依赖</h3>
          <p>这样开出来的 tenant 处于"未认领"状态——没有邮箱找回，丢了这把 key 就找不回来了。这个项目对外报的 tenant/调用数字只统计已认领的，不靠未认领账号刷量。</p>
        </div>
      </div>
      <div class="step">
        <div>
          <h3>认领（可选，转正）</h3>
          <p>想长期用的话，用这把 <code>api_key</code> 当 Bearer token 调 <code>POST /v1/auth/claim</code>，附上邮箱密码，转成正式账号——这一步通常该由人来做，而不是 Agent 替自己做主创建密码。</p>
        </div>
      </div>
    </div>
    <div class="code-wrap">
      <pre>curl https://skillify.carbonleft.com/v1/auth/pow-challenge
# -&gt; {"challenge": "...", "difficulty_bits": 20, "expires_at": ...}

# ...solve it (see /llms.txt for the algorithm + a worked example)...

curl -X POST https://skillify.carbonleft.com/v1/auth/agent-register \\
  -H "Content-Type: application/json" \\
  -d '{"name": "your-agent-name", "description": "what you do", "challenge": "...", "solution": "..."}'

# -&gt; {"tenant_id": "...", "api_key": "sk_live_...", "claimed": false}</pre>
    </div>
  </section>

  <section id="mcp">
    <h2>MCP 接入</h2>
    <p class="sub">在支持自定义 MCP server 的客户端里配置，把 <code>&lt;your api key&gt;</code> 换成控制台里生成的 API Key：</p>
    <div class="code-wrap">
      <button class="copy-btn" id="copy-mcp">复制</button>
      <pre id="mcp-snippet"></pre>
    </div>
  </section>

  <footer>
    skillify-runtime · <a href="/console">控制台</a> · <a href="/v1/tools">工具目录</a> · <a href="/llms.txt">llms.txt</a>
  </footer>
</div>

<script>
const snippet = JSON.stringify(
  { mcpServers: { "skillify-runtime": { url: location.origin + "/mcp", headers: { Authorization: "Bearer <your api key>" } } } },
  null, 2
);
document.getElementById("mcp-snippet").textContent = snippet;
document.getElementById("copy-mcp").onclick = () => {
  const btn = document.getElementById("copy-mcp");
  const flash = (text) => { btn.textContent = text; setTimeout(() => { btn.textContent = "复制"; }, 1500); };
  navigator.clipboard.writeText(snippet).then(
    () => flash("已复制"),
    () => {
      // clipboard-write can be denied (permissions policy, non-secure
      // context, older browsers) — fall back to selecting the text so the
      // user can still Cmd/Ctrl+C instead of the button silently doing
      // nothing.
      const range = document.createRange();
      range.selectNodeContents(document.getElementById("mcp-snippet"));
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      flash("已选中，请手动复制");
    },
  );
};
</script>
</body>
</html>`;

export function handleLanding(): Response {
  return new Response(HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
