// RFC 4180 CSV helpers used for product/customer import and report export.

export function toCsv(rows: Array<Record<string, unknown>>, columns?: string[]): string {
  const cols =
    columns ??
    Array.from(
      rows.reduce((s, r) => {
        Object.keys(r).forEach((k) => s.add(k))
        return s
      }, new Set<string>()),
    )
  const esc = (v: unknown) => {
    if (v === null || v === undefined) return ''
    const s = String(v)
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\r\n')
}

/** Parses CSV with a header row. Detects ";" as delimiter (common in European Excel exports). */
export function parseCsv(text: string): Array<Record<string, string>> {
  const src = text.replace(/^\uFEFF/, '')
  const firstLine = src.split(/\r?\n/, 1)[0] ?? ''
  const count = (ch: string) => firstLine.split(ch).length - 1
  const delim = count(';') > count(',') ? ';' : count('\t') > count(',') ? '\t' : ','

  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += ch
    } else if (ch === '"') quoted = true
    else if (ch === delim) {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      row.push(field)
      field = ''
      if (row.some((c) => c !== '')) rows.push(row)
      row = []
    } else field += ch
  }
  row.push(field)
  if (row.some((c) => c !== '')) rows.push(row)
  if (!rows.length) return []
  const header = rows[0].map((h) => h.trim())
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])))
}
