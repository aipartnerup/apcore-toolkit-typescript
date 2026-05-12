/**
 * Byte-equivalent tabular data formatters: CSV and JSONL.
 *
 * Cross-SDK byte-identity contract: every SDK (Python / TypeScript / Rust)
 * emits identical bytes for the same input. Consumers (apcore-cli, apcore-mcp,
 * apcore-a2a, downstream CLIs) MUST delegate to these formatters rather than
 * reimplementing.
 *
 * See apcore-toolkit/docs/features/formatting.md § Tabular Formats.
 */

const BOM = "\uFEFF";

export interface FormatCsvOptions {
  /** Prepend a UTF-8 BOM for Excel-locale users. Default false. */
  bom?: boolean;
}

/**
 * Render rows as RFC 4180 CSV.
 *
 * Header columns are the union of keys across all rows, preserved in insertion
 * order from first occurrence. Rows missing a key emit an empty cell.
 * Non-scalar values are serialized as canonical JSON inside the cell. Cells
 * containing `,`, `"`, `\n`, or `\r` are quote-wrapped with embedded `"`
 * doubled. Line terminator is CRLF.
 */
export function formatCsv(
  rows: Iterable<Record<string, unknown>>,
  options: FormatCsvOptions = {},
): string {
  const rowsArr = Array.from(rows);
  if (rowsArr.length === 0) return "";

  const keys: string[] = [];
  const seen = new Set<string>();
  for (const row of rowsArr) {
    for (const k of Object.keys(row)) {
      if (!seen.has(k)) {
        seen.add(k);
        keys.push(k);
      }
    }
  }

  const lines: string[] = [csvJoin(keys)];
  for (const row of rowsArr) {
    const cells = keys.map((k) => csvCell(row[k]));
    lines.push(csvJoin(cells));
  }

  const body = lines.join("\r\n") + "\r\n";
  return options.bom ? BOM + body : body;
}

/**
 * Render rows as JSON Lines. Each row is canonical compact JSON; LF terminator;
 * no trailing blank line.
 */
export function formatJsonl(rows: Iterable<Record<string, unknown>>): string {
  const rowsArr = Array.from(rows);
  if (rowsArr.length === 0) return "";
  return rowsArr.map(canonicalJson).join("\n") + "\n";
}

function csvJoin(cells: string[]): string {
  return cells.map(csvEscape).join(",");
}

function csvEscape(value: string): string {
  if (
    value.indexOf(",") >= 0 ||
    value.indexOf('"') >= 0 ||
    value.indexOf("\n") >= 0 ||
    value.indexOf("\r") >= 0
  ) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return value;
  if (typeof value === "number") return canonicalNumber(value);
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "object") return canonicalJson(value);
  return String(value);
}

/**
 * Canonical compact JSON matching Python `json.dumps(value, ensure_ascii=False,
 * separators=(',', ':'), sort_keys=False)`. JavaScript's JSON.stringify with no
 * indent already produces this form: no whitespace between tokens, preserved
 * insertion order for string keys (ES2015+), unicode preserved unescaped.
 */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value);
}

/**
 * Canonical number rendering matching the Python reference impl. JavaScript's
 * default Number→String conversion already drops trailing `.0` from
 * whole-number floats and preserves fractional values; NaN/Inf collapse to
 * empty (CSV has no representation).
 */
function canonicalNumber(value: number): string {
  if (!Number.isFinite(value)) return "";
  return String(value);
}
