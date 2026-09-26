#!/usr/bin/env node
// Verifies translation coverage.
//   node scripts/i18n-check.mjs          → keys used in code but missing from locales/en
//   node scripts/i18n-check.mjs --all    → also compare every language against English
//   node scripts/i18n-check.mjs --unused → English keys no code references
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const src = join(root, 'src')
const localeDir = join(src, 'i18n', 'locales')
const args = new Set(process.argv.slice(2))

function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(tsx?|mjs)$/.test(f)) out.push(p)
  }
  return out
}

function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object') flatten(v, key, out)
    else out[key] = v
  }
  return out
}

function loadLang(lng) {
  const dir = join(localeDir, lng)
  const out = {}
  for (const f of readdirSync(dir)) {
    if (f.endsWith('.json')) out[f.replace('.json', '')] = flatten(JSON.parse(readFileSync(join(dir, f), 'utf8')))
  }
  return out
}

const en = loadLang('en')
const has = (ns, key) => {
  const table = en[ns] ?? {}
  return key in table || `${key}_one` in table || `${key}_other` in table
}

const missing = []
const used = new Set()
for (const file of walk(src)) {
  const code = readFileSync(file, 'utf8')
  const nsMatch = code.match(/useTranslation\(\s*'([\w-]+)'/) ?? code.match(/ns:\s*'([\w-]+)'/)
  const defaultNs = nsMatch ? nsMatch[1] : 'common'
  const re = /\bt\(\s*['"]([^'"`]+)['"]/g
  let m
  while ((m = re.exec(code))) {
    let key = m[1]
    let ns = defaultNs
    if (key.includes(':')) [ns, key] = key.split(':')
    used.add(`${ns}:${key}`)
    if (!has(ns, key) && !has('common', key)) {
      used.add(`common:${key}`)
      missing.push(`${relative(root, file)}  ${ns}:${key}`)
    } else if (!has(ns, key)) used.add(`common:${key}`)
  }
}

let failed = false
if (missing.length) {
  failed = true
  console.log(`✗ ${missing.length} keys used in code are missing from locales/en:`)
  for (const k of [...new Set(missing)].sort()) console.log('  ' + k)
} else console.log('✓ every key used in code exists in English')

if (args.has('--unused')) {
  const unused = []
  for (const [ns, table] of Object.entries(en))
    for (const key of Object.keys(table)) {
      const base = key.replace(/_(zero|one|two|few|many|other)$/, '')
      const parent = base.split('.').slice(0, -1).join('.')
      // Keys under a dynamically indexed parent (payment.*, perm.*…) count as used.
      if (!used.has(`${ns}:${base}`) && !(parent && [...used].some((u) => u.startsWith(`${ns}:${parent}.`) || u === `${ns}:${parent}`))) unused.push(`${ns}:${key}`)
    }
  if (unused.length) console.log(`ℹ ${unused.length} English keys look unused (may be dynamic):\n  ` + unused.join('\n  '))
}

if (args.has('--all')) {
  const langs = readdirSync(localeDir).filter((d) => d !== 'en' && statSync(join(localeDir, d)).isDirectory())
  for (const lng of langs.sort()) {
    const other = loadLang(lng)
    const gaps = []
    const vars = []
    for (const [ns, table] of Object.entries(en)) {
      for (const [key, value] of Object.entries(table)) {
        const tr = other[ns]?.[key] ?? (key.endsWith('_one') || key.endsWith('_other') ? other[ns]?.[key.replace(/_(one|other)$/, '_other')] : undefined)
        if (tr === undefined) {
          gaps.push(`${ns}:${key}`)
          continue
        }
        // Singular/dual/zero forms may spell the number out ("one customer"), so {{count}} is optional there.
        const countOptional = /_(zero|one|two)$/.test(key)
        const need = (String(value).match(/\{\{\s*\w+\s*\}\}/g) ?? []).filter((v) => !(countOptional && /^\{\{\s*count\s*\}\}$/.test(v)))
        for (const v of need) if (!String(tr).replace(/\s/g, '').includes(v.replace(/\s/g, ''))) vars.push(`${ns}:${key} lacks ${v}`)
      }
    }
    if (gaps.length || vars.length) failed = true
    console.log(`${gaps.length || vars.length ? '✗' : '✓'} ${lng}: ${gaps.length} missing, ${vars.length} placeholder issues`)
    if (args.has('--verbose')) for (const g of [...gaps, ...vars]) console.log('    ' + g)
  }
}

process.exit(failed ? 1 : 0)
