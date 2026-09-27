/**
 * Test double for PostgREST — just enough of it to exercise paged reads: the
 * filter operators the portal routes use (eq, neq, in, is.null, not.is.null,
 * gte/gt/lte/lt, an `or=(…)` group), `select` with `alias:col->>key` JSON paths, a multi-key
 * `order`, `limit`/`offset`, and — the reason it exists — the max-rows cap.
 *
 * The live project answers `limit=2000` with 1000 rows and a 200 (verified
 * 2026-09-26). A stub that honours any limit hides exactly the truncation that
 * made the portal's visitor counts wrong, so this one caps every response at
 * FAKE_MAX_ROWS the same way.
 *
 * Test-only. Not a *.test.ts file so vitest doesn't collect it, and nothing
 * outside the tests imports it.
 */

export type Row = Record<string, unknown>;

export const FAKE_MAX_ROWS = 1000;

const RESERVED = new Set(["select", "order", "limit", "offset", "or"]);

/** `col` or `col->>key` → the value PostgREST would compare/return. */
function resolve(row: Row, ref: string): unknown {
  const arrow = ref.indexOf("->>");
  if (arrow === -1) return row[ref];
  const json = row[ref.slice(0, arrow)];
  const v = json && typeof json === "object" ? (json as Row)[ref.slice(arrow + 3)] : undefined;
  return v === undefined || v === null ? null : String(v);
}

function test(value: unknown, expr: string): boolean {
  if (expr === "is.null") return value === null || value === undefined;
  if (expr === "not.is.null") return value !== null && value !== undefined;
  if (expr.startsWith("eq.")) return value !== null && value !== undefined && String(value) === expr.slice(3);
  if (expr.startsWith("neq.")) return value !== null && value !== undefined && String(value) !== expr.slice(4);
  // Range operators compare as strings — enough for ISO-8601 timestamps.
  for (const [op, ok] of [
    ["gte.", (a: string, b: string) => a >= b],
    ["gt.", (a: string, b: string) => a > b],
    ["lte.", (a: string, b: string) => a <= b],
    ["lt.", (a: string, b: string) => a < b],
  ] as const) {
    if (expr.startsWith(op)) return value !== null && value !== undefined && ok(String(value), expr.slice(op.length));
  }
  if (expr.startsWith("in.(") && expr.endsWith(")")) {
    return value !== null && value !== undefined && expr.slice(4, -1).split(",").includes(String(value));
  }
  throw new Error(`fakePostgrest: unsupported filter "${expr}"`);
}

/** Split on commas that sit outside parentheses. */
function topLevel(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < list.length; i++) {
    if (list[i] === "(") depth++;
    else if (list[i] === ")") depth--;
    else if (list[i] === "," && depth === 0) {
      out.push(list.slice(start, i));
      start = i + 1;
    }
  }
  out.push(list.slice(start));
  return out;
}

/** `col.op.value` → [col, "op.value"]. */
function term(t: string): [string, string] {
  const dot = t.indexOf(".");
  return [t.slice(0, dot), t.slice(dot + 1)];
}

function matches(row: Row, params: URLSearchParams): boolean {
  for (const [key, expr] of params) {
    if (key === "or") {
      const terms = topLevel(expr.replace(/^\(|\)$/g, ""));
      if (!terms.some((t) => test(resolve(row, term(t)[0]), term(t)[1]))) return false;
      continue;
    }
    if (RESERVED.has(key)) continue;
    if (!test(resolve(row, key), expr)) return false;
  }
  return true;
}

function sortBy(rows: Row[], order: string): Row[] {
  const keys = order.split(",").map((k) => {
    const [col, dir] = k.split(".");
    return { col, sign: dir === "desc" ? -1 : 1 };
  });
  return [...rows].sort((a, b) => {
    for (const { col, sign } of keys) {
      const x = String(a[col] ?? "");
      const y = String(b[col] ?? "");
      if (x !== y) return x < y ? -sign : sign;
    }
    return 0;
  });
}

function project(row: Row, select: string): Row {
  const out: Row = {};
  for (const item of select.split(",")) {
    const colon = item.indexOf(":");
    const alias = colon === -1 ? item.split("->>").pop()! : item.slice(0, colon);
    out[alias] = resolve(row, colon === -1 ? item : item.slice(colon + 1)) ?? null;
  }
  return out;
}

/**
 * A fetch stand-in serving `tables`. A table that isn't in the map answers
 * PostgREST's missing-table 404, so "migration not run" paths are testable
 * too. `calls` records every URL asked for, in order.
 */
export function fakePostgrest(tables: Record<string, Row[]>) {
  const calls: string[] = [];
  async function handler(input: string | URL | Request): Promise<Response> {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    calls.push(url.href);
    const rows = tables[url.pathname.split("/rest/v1/")[1] ?? ""];
    if (!rows) {
      return new Response(JSON.stringify({ code: "PGRST205", message: "Could not find the table" }), { status: 404 });
    }
    const p = url.searchParams;
    let out = rows.filter((r) => matches(r, p));
    const order = p.get("order");
    if (order) out = sortBy(out, order);
    const total = out.length;
    const offset = Number(p.get("offset") ?? 0);
    const limit = Math.min(Number(p.get("limit") ?? FAKE_MAX_ROWS), FAKE_MAX_ROWS);
    out = out.slice(offset, offset + limit);
    const select = p.get("select");
    // The exact total rides along the way `Prefer: count=exact` makes it.
    return Response.json(select ? out.map((r) => project(r, select)) : out, {
      headers: { "content-range": `${offset}-${offset + out.length - 1}/${total}` },
    });
  }
  return { handler, calls };
}
