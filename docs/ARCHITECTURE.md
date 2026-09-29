# OpenPOS — Architecture & conventions

One React + TypeScript codebase runs on every platform:

| Platform | Shell | Storage |
|---|---|---|
| Any browser (installable PWA, works offline) | Service worker via `vite-plugin-pwa` | IndexedDB |
| Windows / macOS / Linux | Electron (`electron/`) | IndexedDB in the app profile |
| Android / iOS (phones & tablets) | Capacitor (`android/`, `ios/`) | IndexedDB in the WebView |
| Multi-terminal / cloud | Optional sync server (`server/`) | SQLite on the server |

The app is **offline-first**: every terminal has the full database locally and never needs the
network to sell. When a sync server is configured, changes replicate between terminals.

## Source layout

```
src/
  core/        Pure domain logic, no I/O (types, cart maths, tax, permissions, presets, barcodes)
  db/          Dexie database, write layer (repo.ts), seed data, derived-ledger helpers
  lib/         Utilities (money, dates, csv, print, uuid, sha256, platform detection)
  stores/      Zustand stores: session, settings (live mirror), cart, device (per-terminal), ui
  sync/        Sync engine + status store
  i18n/        i18next setup, language list, locales/<lang>/<namespace>.json
  components/  ui/ (design system) and layout/ (app shell, nav)
  features/    One folder per screen: sell, products, inventory, customers, sales,
               reports, shifts, users, settings, auth, setup
  router.ts    Tiny hash router (#/products, #/sales/<id>?refund=1)
server/        Sync server (Node ≥ 22, node:sqlite, zero native deps)
electron/      Desktop main + preload
tests/         Vitest unit tests
e2e/           Playwright smoke test (uses system Chrome)
```

## Data rules (important)

1. **Money is integer minor units** (paise/cents). Convert only at the edges with
   `toMinor`/`fromMinor`/`formatMoney` from `@/lib/money`. Never store floats for money.
2. **All writes go through `@/db/repo`** — `put`, `putMany`, `patch`, `remove` (soft delete),
   or `tx([...tables], fn)` for multi-table transactions (then add outbox entries yourself with
   `db.outbox.add({ table, id, updatedAt })`). This stamps `updatedAt` and queues the change for sync.
   Reads can use `db.<table>` directly (usually via `useLiveQuery` from `dexie-react-hooks`).
3. **Soft deletes**: filter `!x.deleted` in every list.
4. **Stock is a ledger.** Never set `product.stock` directly; call `moveStock(productId, qty, type, refId, note, cost)`
   inside a `tx()` (it appends a `StockMovement` and updates the cached `stock`). `stock` is never synced.
5. **Customer balance & loyalty points are derived** from sales (payments with method `credit`,
   `loyaltyEarned/Redeemed`) and `customerPayments` (positive = money received, negative = manual
   charge/opening balance). After writing those, call `recomputeCustomer(id)` from `@/db/customers`.
6. **Sales are immutable documents.** Refunds are separate `Sale` docs with `type: 'refund'`, negative
   quantities/amounts and `refundOf`. Use `completeSale`, `refundSale`, `voidSale`, `alreadyRefunded`
   from `@/features/sell/checkout`.
7. **Document numbers** come from `nextNumber(kind, device().terminal)` (unique per terminal, offline-safe).
8. Audit important actions with `audit(action, entity, id, details)`.

## UI conventions

- Import components from `@/components/ui` (`Button`, `Input`, `MoneyInput`, `NumberInput`, `Select`,
  `Textarea`, `Toggle`, `Segmented`, `Checkbox`, `Modal`, `Sheet`, `NumPad`, `Badge`, `Card`, `CardHeader`,
  `Stat`, `Tabs`, `SearchInput`, `EmptyState`, `Page`, `PageHeader`, `PageBody`, `DataTable`, `KeyValue`, …).
- Colours are semantic tokens: `bg-bg`, `bg-surface`, `bg-surface-2/3`, `border-border`, `text-fg`,
  `text-muted`, `text-subtle`, `bg-primary`, `text-primary`, `bg-primary-soft`, `success/danger/warning` (+ `-soft`).
  Never hard-code hex colours in components; dark mode swaps the tokens.
- Use logical properties for RTL (Urdu, Arabic, Persian): `ms-/me-/ps-/pe-/start-/end-`, `text-start/end`,
  and `rtl:rotate-180` on directional arrows.
- Touch first: primary actions ≥ 44px tall; lists work with tap; everything reachable on a 360px phone.
  `DataTable` takes a `mobile` renderer for phones.
- Toasts: `toast(msg, kind)`; confirmations: `await confirmDialog({ title, message, danger })` from `@/stores/ui`.
- Permissions: check `useSession(s => s.can)('products_manage')`; for protected actions call
  `await requirePermission('refund')` from `@/features/auth/permission` (prompts for a manager PIN).
- Printing: build a complete HTML document and call `printHtml(html, widthMm?)` from `@/lib/print`.
- Downloads/uploads: `downloadText`, `pickFile`, `readFileText`, `readFileDataUrl` from `@/lib/download`;
  CSV via `toCsv`/`parseCsv` from `@/lib/csv`.

## i18n

- Every user-visible string goes through i18next: `const { t } = useTranslation('<namespace>')`.
- One JSON file per namespace per language: `src/i18n/locales/en/<ns>.json` is the source of truth.
  Namespaces: `common, auth, setup, sell, products, inventory, customers, sales, reports, shifts, users, settings`.
- `common` is the fallback namespace, so generic words (`save`, `cancel`, `delete`, `name`, `payment.cash`,
  `perm.*`, `role.*`, `unit.*`) can be used from any namespace without duplication. Cross-namespace: `t('common:save')`.
- Plurals use i18next suffixes: `"items_one": "{{count}} item", "items_other": "{{count}} items"`.
- Run `npm run i18n:check` — it fails if code uses a key missing from English. `--all` compares every language.
- Dates/numbers: `formatDate/formatDateTime/formatTime` (`@/lib/dates`) and `formatMoney/formatQty/formatNumber`
  (`@/lib/money`) are locale-aware; never format numbers by hand.

## Sync protocol (summary)

Each synced record has `id` and `updatedAt`. Terminals push their outbox and pull changes since a cursor.
The server keeps the highest `updatedAt` per record (last-write-wins) and assigns a monotonic `seq`.
Ledger tables (`sales`, `stockMovements`, `customerPayments`, `cashMovements`, `audit`) are append-only,
so concurrent terminals never lose sales or stock changes. Derived fields (`product.stock`,
`customer.balance`, `customer.loyaltyPoints`) are stripped on push and recomputed locally after pull.
See `server/README.md` for the HTTP API.
