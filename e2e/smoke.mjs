#!/usr/bin/env node
// End-to-end smoke test: first-run setup → sell → pay → receipt, on desktop and phone sizes.
// Uses the system Chrome (no browser download). Run the dev server first: `npm run dev`.
//   BASE_URL=http://localhost:5173 node e2e/smoke.mjs
import { chromium } from 'playwright'
import { existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const BASE = process.env.BASE_URL ?? 'http://localhost:5173'
const OUT = fileURLToPath(new URL('./screenshots/', import.meta.url))
mkdirSync(OUT, { recursive: true })
const chromePath = ['/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(existsSync)

const browser = await chromium.launch({ executablePath: chromePath, headless: true })
const errors = []

async function run(name, viewport, fn) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, locale: 'en-IN', timezoneId: 'Asia/Kolkata' })
  const page = await ctx.newPage()
  page.on('console', (m) => m.type() === 'error' && errors.push(`[${name}] ${m.text()}`))
  page.on('pageerror', (e) => errors.push(`[${name}] ${e.message}`))
  await page.goto(BASE)
  try {
    await fn(page, (step) => page.screenshot({ path: `${OUT}${name}-${step}.png` }))
  } catch (e) {
    await page.screenshot({ path: `${OUT}${name}-FAILED.png` })
    throw e
  } finally {
    await ctx.close()
  }
}

async function setup(page, shot) {
  await page.getByRole('heading', { name: 'Choose your language' }).waitFor()
  await shot('1-language')
  await page.getByRole('button', { name: 'Next' }).click()
  await page.getByLabel('Business name').fill('Sharma General Store')
  await shot('2-business')
  await page.getByRole('button', { name: 'Next' }).click()
  await page.getByLabel('Your name').fill('Bikram')
  await page.getByLabel('PIN', { exact: true }).fill('1234')
  await page.getByLabel('Confirm PIN').fill('1234')
  await page.getByRole('button', { name: 'Next' }).click()
  await shot('3-finish')
  await page.getByRole('button', { name: 'Start selling' }).click()
  await page.getByPlaceholder('Search or scan barcode').waitFor()
}

await run('desktop', { width: 1366, height: 820 }, async (page, shot) => {
  await setup(page, shot)
  await page.getByRole('button', { name: /Cappuccino/ }).first().click()
  await page.getByRole('button', { name: /Cappuccino/ }).first().click()
  await page.getByRole('button', { name: /Croissant/ }).first().click()
  // Scan by typing a SKU into search and pressing Enter.
  await page.getByPlaceholder('Search or scan barcode').fill('chips')
  await page.keyboard.press('Enter')
  await shot('4-cart')
  await page.keyboard.press('F12')
  await page.getByText('Total to pay').waitFor()
  await shot('5-payment')
  await page.getByRole('button', { name: 'Exact' }).click()
  await page.getByText('Sale complete').waitFor()
  await shot('6-receipt')
  await page.getByRole('button', { name: 'New sale' }).click()
  // Every other screen must at least render without crashing.
  for (const r of ['sales', 'products', 'inventory', 'customers', 'reports', 'shifts', 'users', 'settings']) {
    await page.goto(`${BASE}/#/${r}`)
    await page.waitForTimeout(700)
    await shot(`7-${r}`)
  }
  // Language switch + RTL
  await page.goto(`${BASE}/#/sell`)
  await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('kasa.device'))
    localStorage.setItem('kasa.device', JSON.stringify({ ...d, language: 'hi' }))
  })
  await page.reload()
  await page.waitForTimeout(1200)
  await shot('8-hindi')
})

await run('phone', { width: 390, height: 844 }, async (page, shot) => {
  await setup(page, shot)
  await page.getByRole('button', { name: /Masala Chai/ }).first().click()
  await page.getByRole('button', { name: /Samosa/ }).first().click()
  await shot('4-grid')
  await page.getByRole('button', { name: /View sale/ }).click()
  await page.waitForTimeout(400)
  await shot('5-cart')
  await page.getByRole('button', { name: /^Pay/ }).click()
  await page.getByText('Total to pay').waitFor()
  await page.waitForTimeout(400)
  await shot('6-payment')
})

await browser.close()
if (errors.length) {
  console.log('Console errors:\n' + [...new Set(errors)].join('\n'))
  process.exitCode = 1
} else console.log('✓ smoke test passed, screenshots in e2e/screenshots/')
