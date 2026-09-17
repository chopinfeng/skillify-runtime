/**
 * Minimal, dependency-free web console — one static HTML page with vanilla
 * JS, served directly by the Worker. No build step, no framework: the
 * project's whole philosophy has been "keep the surface small and
 * verified", and a console is no exception. It talks to the same REST
 * endpoints everything else uses; nothing here is a special backend path.
 */
const HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>skillify-runtime console</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; max-width: 760px; margin: 40px auto; padding: 0 16px; }
  h1 { font-size: 18px; }
  h2 { font-size: 15px; margin-top: 32px; border-bottom: 1px solid #8883; padding-bottom: 4px; }
  section { margin-bottom: 24px; }
  input, select, button { font: inherit; padding: 6px 8px; margin: 2px 0; }
  input, select { display: block; width: 100%; max-width: 360px; box-sizing: border-box; }
  button { cursor: pointer; }
  form { display: flex; flex-direction: column; gap: 6px; max-width: 360px; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; }
  td, th { border-bottom: 1px solid #8883; padding: 4px 6px; text-align: left; }
  .row { display: flex; gap: 8px; align-items: center; }
  .muted { opacity: 0.65; font-size: 12px; }
  .err { color: #d33; }
  .ok { color: #2a2; }
  pre { background: #8881; padding: 8px; overflow-x: auto; white-space: pre-wrap; word-break: break-all; }
  .tabs button { border: 1px solid #8886; background: none; }
  .tabs button.active { font-weight: 600; }
  .hidden { display: none; }
</style>
</head>
<body>

<h1>skillify-runtime</h1>

<div id="auth-view">
  <div class="tabs row">
    <button id="tab-login" class="active">Log in</button>
    <button id="tab-signup">Sign up</button>
  </div>

  <form id="login-form">
    <input name="email" type="email" placeholder="email" required />
    <input name="password" type="password" placeholder="password" required />
    <button type="submit">Log in</button>
  </form>

  <form id="signup-form" class="hidden">
    <input name="email" type="email" placeholder="email" required />
    <input name="password" type="password" placeholder="password (min 8 chars)" minlength="8" required />
    <button type="submit">Sign up</button>
  </form>

  <p id="auth-msg" class="err"></p>

  <p class="row"><a href="/v1/auth/auth0/start">Sign in with Auth0</a></p>
</div>

<div id="dashboard-view" class="hidden">
  <p class="row">
    Logged in as <strong id="me-email"></strong> (<span id="me-tenant" class="muted"></span>)
    <button id="logout-btn">Log out</button>
  </p>

  <section>
    <h2>API keys</h2>
    <p class="muted">Used as <code>Authorization: Bearer &lt;key&gt;</code> for REST calls and the MCP endpoint below. Shown once, at creation.</p>
    <button id="create-key-btn">Create new key</button>
    <pre id="new-key-box" class="hidden"></pre>
    <table id="keys-table"><thead><tr><th>id</th><th>created</th><th>status</th><th></th></tr></thead><tbody></tbody></table>
  </section>

  <section>
    <h2>Connected accounts</h2>
    <form id="connect-form">
      <select name="platform">
        <option value="bigmodel-cn">bigmodel-cn (static API key)</option>
        <option value="feishu">feishu (app_id + app_secret)</option>
      </select>
      <input name="label" placeholder="label" required />
      <div id="secret-fields"></div>
      <button type="submit">Connect</button>
    </form>
    <p id="connect-msg" class="err"></p>
    <table id="accounts-table"><thead><tr><th>platform</th><th>label</th><th>connected</th><th></th></tr></thead><tbody></tbody></table>
  </section>

  <section>
    <h2>Connect via MCP</h2>
    <p class="muted">Any MCP-compatible client (Claude Code, Cursor, Claude Desktop, …):</p>
    <pre id="mcp-config"></pre>
  </section>

  <section>
    <h2>Audit log</h2>
    <button id="refresh-log-btn">Refresh</button>
    <table id="log-table"><thead><tr><th>tool</th><th>ok</th><th>status</th><th>ms</th><th>when</th></tr></thead><tbody></tbody></table>
  </section>
</div>

<script>
const $ = (sel) => document.querySelector(sel);
const fetchJson = (url, opts) => fetch(url, { credentials: "same-origin", ...opts }).then(async (r) => ({ status: r.status, body: r.status === 204 ? null : await r.json().catch(() => null) }));

const SECRET_FIELDS = {
  "bigmodel-cn": [
    { name: "apiKey", placeholder: "API key" },
    { name: "planType", placeholder: "standard or coding", value: "standard" },
  ],
  feishu: [
    { name: "appId", placeholder: "app_id" },
    { name: "appSecret", placeholder: "app_secret" },
  ],
};

function renderSecretFields() {
  const platform = $('select[name="platform"]').value;
  const container = $("#secret-fields");
  container.innerHTML = "";
  for (const f of SECRET_FIELDS[platform]) {
    const input = document.createElement("input");
    input.name = "secret_" + f.name;
    input.placeholder = f.placeholder;
    if (f.value) input.value = f.value;
    input.required = true;
    container.appendChild(input);
  }
}

async function checkAuth() {
  const { status, body } = await fetchJson("/v1/auth/me");
  if (status === 200) {
    $("#auth-view").classList.add("hidden");
    $("#dashboard-view").classList.remove("hidden");
    $("#me-email").textContent = body.email;
    $("#me-tenant").textContent = body.tenant_id;
    await Promise.all([loadKeys(), loadAccounts(), loadLog()]);
  } else {
    $("#auth-view").classList.remove("hidden");
    $("#dashboard-view").classList.add("hidden");
  }
}

$("#tab-login").onclick = () => {
  $("#tab-login").classList.add("active");
  $("#tab-signup").classList.remove("active");
  $("#login-form").classList.remove("hidden");
  $("#signup-form").classList.add("hidden");
};
$("#tab-signup").onclick = () => {
  $("#tab-signup").classList.add("active");
  $("#tab-login").classList.remove("active");
  $("#signup-form").classList.remove("hidden");
  $("#login-form").classList.add("hidden");
};

async function submitCreds(form, path) {
  const fd = new FormData(form);
  const { status, body } = await fetchJson(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: fd.get("email"), password: fd.get("password") }),
  });
  if (status >= 200 && status < 300) {
    $("#auth-msg").textContent = "";
    if (body && body.api_key) alert("Your API key (shown once): " + body.api_key);
    await checkAuth();
  } else {
    $("#auth-msg").textContent = (body && body.error) || "failed";
  }
}
$("#login-form").onsubmit = (e) => { e.preventDefault(); submitCreds(e.target, "/v1/auth/login"); };
$("#signup-form").onsubmit = (e) => { e.preventDefault(); submitCreds(e.target, "/v1/auth/signup"); };

$("#logout-btn").onclick = async () => { await fetchJson("/v1/auth/logout", { method: "POST" }); await checkAuth(); };

async function loadKeys() {
  const { body } = await fetchJson("/v1/api-keys");
  const tbody = $("#keys-table tbody");
  tbody.innerHTML = "";
  for (const k of (body?.keys ?? [])) {
    const tr = document.createElement("tr");
    tr.innerHTML = \`<td>\${k.id}</td><td>\${new Date(k.created_at).toLocaleString()}</td><td>\${k.revoked_at ? "revoked" : "active"}</td><td></td>\`;
    if (!k.revoked_at) {
      const btn = document.createElement("button");
      btn.textContent = "Revoke";
      btn.onclick = async () => { await fetchJson("/v1/api-keys/" + k.id, { method: "DELETE" }); loadKeys(); };
      tr.lastElementChild.appendChild(btn);
    }
    tbody.appendChild(tr);
  }
}
$("#create-key-btn").onclick = async () => {
  const { body } = await fetchJson("/v1/api-keys", { method: "POST" });
  if (body?.api_key) {
    $("#new-key-box").textContent = body.api_key;
    $("#new-key-box").classList.remove("hidden");
  }
  loadKeys();
};

$('select[name="platform"]').onchange = renderSecretFields;
renderSecretFields();

async function loadAccounts() {
  const { body } = await fetchJson("/v1/connected-accounts");
  const tbody = $("#accounts-table tbody");
  tbody.innerHTML = "";
  for (const a of (body?.accounts ?? [])) {
    const tr = document.createElement("tr");
    tr.innerHTML = \`<td>\${a.platform}</td><td>\${a.label}</td><td>\${new Date(a.created_at).toLocaleString()}</td><td></td>\`;
    const btn = document.createElement("button");
    btn.textContent = "Revoke";
    btn.onclick = async () => { await fetchJson("/v1/connected-accounts/" + a.id, { method: "DELETE" }); loadAccounts(); };
    tr.lastElementChild.appendChild(btn);
    tbody.appendChild(tr);
  }
}
$("#connect-form").onsubmit = async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const platform = fd.get("platform");
  const secret = {};
  for (const f of SECRET_FIELDS[platform]) secret[f.name] = fd.get("secret_" + f.name);
  const { status, body } = await fetchJson("/v1/connected-accounts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ platform, label: fd.get("label"), secret }),
  });
  $("#connect-msg").textContent = status >= 200 && status < 300 ? "" : ((body && body.error) || "failed");
  if (status >= 200 && status < 300) { e.target.reset(); renderSecretFields(); loadAccounts(); }
};

async function loadLog() {
  const { body } = await fetchJson("/v1/audit-log");
  const tbody = $("#log-table tbody");
  tbody.innerHTML = "";
  for (const e of (body?.entries ?? [])) {
    const tr = document.createElement("tr");
    tr.innerHTML = \`<td>\${e.tool_name}</td><td class="\${e.ok ? "ok" : "err"}">\${e.ok ? "yes" : "no"}</td><td>\${e.http_status ?? ""}</td><td>\${e.duration_ms}</td><td>\${new Date(e.created_at).toLocaleString()}</td>\`;
    tbody.appendChild(tr);
  }
}
$("#refresh-log-btn").onclick = loadLog;

$("#mcp-config").textContent = JSON.stringify(
  { mcpServers: { "skillify-runtime": { url: location.origin + "/mcp", headers: { Authorization: "Bearer <your api key>" } } } },
  null, 2,
);

checkAuth();
</script>
</body>
</html>`;

export function handleConsole(): Response {
  return new Response(HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
