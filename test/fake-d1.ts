/**
 * Minimal in-memory stand-in for D1, covering just the query shapes db.ts
 * actually issues (single-table INSERT/SELECT/UPDATE with an ANDed WHERE of
 * `col = ?` / `col IS NULL`, plus the one JOIN query). Not a SQL engine —
 * each condition is matched generically against row data rather than
 * hardcoded per query, so a future edit that changes a WHERE clause (e.g.
 * accidentally drops a `tenant_id = ?` guard) still exercises real
 * comparison logic instead of a canned response. Good enough to give
 * tenant-isolation tests something real to run db.ts's own SQL against,
 * without adding a SQLite dependency for one test file.
 */
type Row = Record<string, unknown>;

interface Condition {
  col: string;
  op: "eq" | "isnull";
  val?: unknown;
}

function normalize(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

function parseConditions(whereClause: string, args: unknown[], startIdx: number): { conditions: Condition[]; nextIdx: number } {
  let i = startIdx;
  const conditions = whereClause.split(/\s+AND\s+/i).map((clause): Condition => {
    const isNull = clause.match(/^(\w+)\s+IS\s+NULL$/i);
    if (isNull) return { col: isNull[1], op: "isnull" };
    const eq = clause.match(/^(\w+)\s*=\s*\?$/);
    if (eq) return { col: eq[1], op: "eq", val: args[i++] };
    throw new Error(`fake-d1: unsupported WHERE condition "${clause}"`);
  });
  return { conditions, nextIdx: i };
}

function rowMatches(row: Row, conditions: Condition[]): boolean {
  return conditions.every((c) => (c.op === "isnull" ? row[c.col] == null : row[c.col] === c.val));
}

export function createFakeD1() {
  const tables: Record<string, Row[]> = {
    tenants: [],
    tenant_api_keys: [],
    connected_accounts: [],
    audit_log: [],
    users: [],
    sessions: [],
    oauth_identities: [],
    registration_attempts: [],
  };

  function bind(sql: string, args: unknown[]) {
    const norm = normalize(sql);

    async function run() {
      const insert = norm.match(/^INSERT INTO (\w+) \(([^)]+)\) VALUES \(([^)]+)\)$/i);
      if (insert) {
        const [, table, colsStr] = insert;
        const cols = colsStr.split(",").map((c) => c.trim());
        const row: Row = {};
        cols.forEach((c, i) => (row[c] = args[i]));
        (tables[table] ??= []).push(row);
        return { meta: { changes: 1 } };
      }

      const update = norm.match(/^UPDATE (\w+) SET (.+?) WHERE (.+)$/i);
      if (update) {
        const [, table, setClause, whereClause] = update;
        const setCols = setClause.split(",").map((s) => {
          const m = s.trim().match(/^(\w+)\s*=\s*\?$/);
          if (!m) throw new Error(`fake-d1: unsupported SET clause "${s}"`);
          return m[1];
        });
        const setVals = setCols.map((_, i) => args[i]);
        const { conditions } = parseConditions(whereClause, args, setCols.length);
        let changes = 0;
        for (const row of tables[table] ?? []) {
          if (rowMatches(row, conditions)) {
            setCols.forEach((c, i) => (row[c] = setVals[i]));
            changes++;
          }
        }
        return { meta: { changes } };
      }

      throw new Error(`fake-d1: unsupported statement for run(): ${norm}`);
    }

    function selectRows(): Row[] {
      // Special-cased: the one JOIN query in db.ts (getTenantByApiKey).
      const join = norm.match(
        /^SELECT t\.\* FROM tenants t JOIN tenant_api_keys k ON k\.tenant_id = t\.id WHERE k\.key_hash = \? AND k\.revoked_at IS NULL$/i,
      );
      if (join) {
        const keyHash = args[0];
        const key = (tables.tenant_api_keys ?? []).find((k) => k.key_hash === keyHash && k.revoked_at == null);
        if (!key) return [];
        const tenant = (tables.tenants ?? []).find((t) => t.id === key.tenant_id);
        return tenant ? [tenant] : [];
      }

      const select = norm.match(/^SELECT (?:.+?) FROM (\w+)(?: WHERE (.+))?$/i);
      if (!select) throw new Error(`fake-d1: unsupported statement for select: ${norm}`);
      const [, table, rest] = select;
      let body = rest ?? "";
      let orderCol: string | null = null;
      let orderDesc = false;
      let limit: number | null = null;

      const orderIdx = body.search(/\bORDER BY\b/i);
      if (orderIdx >= 0) {
        const after = body.slice(orderIdx).replace(/^ORDER BY\s*/i, "");
        body = body.slice(0, orderIdx).trim();
        const limitIdx = after.search(/\bLIMIT\b/i);
        const orderSpec = (limitIdx >= 0 ? after.slice(0, limitIdx) : after).trim();
        const [col, dir] = orderSpec.split(/\s+/);
        orderCol = col;
        orderDesc = /desc/i.test(dir ?? "");
        if (limitIdx >= 0) body += ` LIMIT ${after.slice(limitIdx).replace(/^LIMIT\s*/i, "").trim()}`;
      }
      const limitIdx = body.search(/\bLIMIT\b/i);
      let whereClause = body;
      if (limitIdx >= 0) {
        whereClause = body.slice(0, limitIdx).trim();
        const limitToken = body.slice(limitIdx).replace(/^LIMIT\s*/i, "").trim();
        limit = limitToken === "?" ? Number(args[args.length - 1]) : Number(limitToken);
      }

      let argIdx = 0;
      let conditions: Condition[] = [];
      if (whereClause) {
        const parsed = parseConditions(whereClause, args, 0);
        conditions = parsed.conditions;
        argIdx = parsed.nextIdx;
      }
      // A trailing `?` LIMIT arg (not already consumed above) sits after the
      // WHERE args positionally — already handled via args.length fallback.
      void argIdx;

      let rows = (tables[table] ?? []).filter((row) => rowMatches(row, conditions));
      if (orderCol) {
        rows = [...rows].sort((a, b) => {
          const av = a[orderCol as string] as number;
          const bv = b[orderCol as string] as number;
          return orderDesc ? bv - av : av - bv;
        });
      }
      if (limit != null) rows = rows.slice(0, limit);
      return rows;
    }

    return {
      run,
      async first<T>() {
        const rows = selectRows();
        return (rows[0] as T) ?? null;
      },
      async all<T>() {
        return { results: selectRows() as T[] };
      },
    };
  }

  return {
    tables,
    prepare(sql: string) {
      return { bind: (...args: unknown[]) => bind(sql, args) };
    },
  };
}
