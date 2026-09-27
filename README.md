<p align="center"><img src="public/icons/icon.svg" width="96" alt="Kasa POS"></p>

<h1 align="center">Kasa POS</h1>

<p align="center">
Fast, offline-first point of sale for shops, supermarkets, cafés, restaurants and service businesses.<br>
One codebase → <b>Web (PWA) · Windows · macOS · Linux · Android · iOS</b> — phones, tablets and PCs.
</p>

---

## Why Kasa POS

- **Works offline, always.** Every till keeps a full local database. Internet down? Keep selling. Changes sync automatically when you're back online.
- **Runs everywhere.** Install it from the browser, or use native desktop and mobile apps built from the same code.
- **Fast at the counter.** Barcode scanners work anywhere on the sell screen, there are keyboard shortcuts for everything, tiles are touch-friendly and payment is one tap.
- **Speaks your customers' language.** 34 languages: 13 Indian languages, 20 major world languages and English. Urdu, Arabic and Persian get full right-to-left layout.
- **Built for India, ready for the world.** GST invoices with CGST/SGST/IGST and HSN codes, a UPI QR with the amount pre-filled, credit ledgers (khata), and lakh/crore formatting. Country presets cover 38 countries' currencies and tax rates.

## Features

### Selling
- Product grid with categories and favourites, instant search, and USB/Bluetooth barcode scanners (keyboard mode).
- **Camera barcode scanning** on phones and tablets, works offline.
- **Weighing-scale barcodes** carrying embedded weight or price, plus sold-by-weight and open-price items.
- Quantity, price override, line and whole-sale discounts (percent or amount), item and sale notes.
- **Hold / recall** sales to serve the next customer; custom one-off items.
- **Split payments:** cash with quick-cash buttons and change, card, **UPI QR**, **on account (khata)** with credit limits, loyalty points, bank transfer, vouchers.
- Customers attached in two taps, with automatic customer discounts and loyalty earning.
- Returns with or without the original receipt, refunds with restock control, and voids behind manager approval.
- Restaurant mode: dine-in, takeaway and delivery, plus table numbers.
- **Customer-facing display** for a second screen, showing items, total, the UPI QR and change due.
- Keyboard shortcuts (F1 shows them all), and the cart survives crashes and reloads.

### Receipts & invoices
- Thermal receipts (58/80 mm) and **A4 GST tax invoices**: HSN, CGST/SGST/IGST split, place of supply, amount in words.
- Print (silent printing on desktop), WhatsApp, share sheet, email, or save as PDF.
- Logo, header and footer; receipt barcode for fast refund lookup; credit notes for refunds.

### Back office
- **Products:** categories, images, colours, SKU/barcode (auto-generate EAN-13), HSN, MRP, cost and margin, CSV import/export, **barcode label printing**, bulk edit.
- **Inventory:** real-time stock ledger, adjustments with reasons, stock-take, low-stock alerts, **purchases from suppliers**, stock valuation.
- **Customers:** purchase history, credit balance and statements, receiving payments, WhatsApp payment reminders, loyalty points.
- **Sales history:** filters, receipt reprint, refunds, voids, CSV export.
- **Reports:** dashboard, sales trends, hourly sales, payment methods, top products, categories, staff performance, profit and margin, **GST/tax reports (HSN summary, B2B/B2C)**, customer dues, inventory valuation. All reports export to CSV and print.
- **Cash register:** open and close shifts, cash in/out, cash counting by denomination, over/short, X and Z reports.
- **Users & roles:** admin, manager and cashier with fine-grained permissions, PIN login, **manager override** prompts, auto-lock, audit log.
- **Settings:** business profile, taxes, currency and formats, payment methods, receipt designer with live preview, loyalty, scale barcodes, per-device printer, language and theme.
- **Backup & restore** to a single file, **automatic backups** on a schedule and after each shift to this device, a folder, **Google Drive, OneDrive or Dropbox** (optionally encrypted), plus optional **multi-terminal sync** through a self-hosted server (LAN or cloud).

### Quality
- Light and dark themes, a responsive layout from 360 px phones to large desktops, and touch-first controls.
- Money is stored in integer minor units (no floating-point errors). Tax maths is covered by unit tests.
- Sales, stock and credit are append-only ledgers, so concurrent terminals never overwrite each other.

## Quick start

```bash
npm install
npm run dev            # http://localhost:5173 — first run opens the setup wizard
```

The wizard sets your language, country (currency and tax preset), business details and admin PIN, and can load sample products.

| Task | Command |
|---|---|
| Type-check, unit tests, i18n check | `npm run typecheck` · `npm test` · `npm run i18n:check -- --all` |
| Production web build (PWA) | `npm run build` → `dist/` (host on any static server over HTTPS) |
| End-to-end smoke test (system Chrome) | `npm run dev` then `npm run e2e` |
| Desktop app (dev) | `npm run dev` + `npm run desktop:dev` |
| Desktop installers | `npm run dist:win` · `npm run dist:mac` · `npm run dist:linux` |
| Android / iOS | `npm run android` · `npm run ios` (opens Android Studio / Xcode) |
| Sync server | `npm run server` (see [`server/README.md`](server/README.md)) |

Tagged releases (`git tag v1.0.0 && git push --tags`) build Windows, macOS and Linux installers plus an Android APK in GitHub Actions, and deploy the web app to GitHub Pages. See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

## Hardware

- **Barcode scanners:** any USB or Bluetooth scanner in keyboard (HID) mode. No setup; scan anywhere on the sell screen.
- **Receipt printers:** any 58/80 mm thermal printer with a system driver. Desktop builds can print silently to a chosen printer.
- **Cash drawers:** RJ11 drawers connected to the receipt printer (desktop build).
- **Weighing scales:** EAN-13 labels with embedded weight or price. Configure the prefix and digits in Settings.
- **Customer display:** any second monitor, via Sell menu → Customer display.

## Languages

English · हिन्दी · বাংলা · తెలుగు · मराठी · தமிழ் · اردو · ગુજરાતી · ಕನ್ನಡ · മലയാളം · ଓଡ଼ିଆ · ਪੰਜਾਬੀ · অসমীয়া · नेपाली ·
Español · Français · Deutsch · Português · Italiano · Nederlands · Polski · Русский · Türkçe · العربية · فارسی ·
简体中文 · 日本語 · 한국어 · Bahasa Indonesia · Bahasa Melayu · Tiếng Việt · ไทย · Filipino · Kiswahili

Each terminal picks its own language; receipts print in the terminal's language. Translations live in
`src/i18n/locales/<code>/*.json`. English is the source, and `npm run i18n:check -- --all` verifies every language.

## Architecture

React 19 + TypeScript + Vite + Tailwind CSS, Dexie (IndexedDB) for local storage, Zustand for state, and i18next.
Electron handles desktop builds and Capacitor handles Android and iOS. The sync server uses Node + SQLite with zero dependencies.
See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for data rules, conventions and the sync protocol.

## Roadmap

Planned next, contributions welcome:
- Product variants (size and colour matrix), batch/expiry and serial/IMEI tracking.
- Promotions engine (buy X get Y, happy hours, price lists, customer groups), gift-card balances.
- Restaurant kitchen order tickets (KOT), table map, modifiers and split bills.
- Payment terminal integrations (Razorpay/Pine Labs POS, Stripe Terminal, SumUp) and automatic UPI payment confirmation.
- India e-invoicing (IRN/QR) and e-way bills, and GSTR-1 JSON export.
- Accounting exports (Tally, Zoho Books, QuickBooks, Xero) and e-commerce sync (Shopify, WooCommerce).
- WhatsApp Business API and SMS receipts sent automatically.
- Multi-branch head-office dashboard and stock transfers between stores.

## License

Proprietary — all rights reserved. Choose a license before making the repository public.
