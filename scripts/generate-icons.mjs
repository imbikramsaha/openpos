// Generates every OpenPOS icon and splash asset from one mark, rendered with headless Chrome.
//   node scripts/generate-icons.mjs        (CHROME=/path/to/chrome to use another browser)
// Writes public/icons, build/icon.png (desktop), Android mipmaps + splashes and the iOS icon/splash.
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
const ROOT = fileURLToPath(new URL('..', import.meta.url))

// The mark in a 512 box centred on (256, 256): an open ring (gap top-right) with a dot in the gap.
const mark = (fill = '#fff', s = 1) => `<g transform="translate(256 256) scale(${s}) translate(-256 -256)">
    <path d="M256 136A120 120 0 1 0 376 256" fill="none" stroke="${fill}" stroke-width="44" stroke-linecap="round"/>
    <circle cx="340.85" cy="171.15" r="26" fill="${fill}"/>
  </g>`
const defs = `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2c2c31"/><stop offset="1" stop-color="#0d0d0f"/></linearGradient></defs>`
const svg = (body, vb = 512) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vb} ${vb}">${defs}${body}</svg>`

const variants = {
  // In-app logo, favicon and PWA "any" icons: rounded tile.
  tile: svg(`<rect width="512" height="512" rx="116" fill="url(#g)"/>${mark()}`),
  // Full-bleed backgrounds (the platform applies its own mask). Maskable keeps the mark in the 80% safe zone.
  maskable: svg(`<rect width="512" height="512" fill="url(#g)"/>${mark('#fff', 0.78)}`),
  apple: svg(`<rect width="512" height="512" fill="url(#g)"/>${mark('#fff', 0.9)}`),
  ios: svg(`<rect width="512" height="512" fill="url(#g)"/>${mark('#fff', 0.86)}`),
  // macOS-style desktop icon: 824/1024 tile with a soft shadow.
  desktop: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">${defs}
    <defs><filter id="s" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="12" stdDeviation="18" flood-color="#000" flood-opacity="0.28"/></filter></defs>
    <g transform="translate(100 88) scale(1.609375)"><rect width="512" height="512" rx="115" fill="url(#g)" filter="url(#s)"/>${mark()}</g></svg>`,
  // Android adaptive layers: the mark alone, inside the 66/108 safe zone.
  androidFg: svg(mark('#fff', 0.62)),
  androidRound: svg(`<circle cx="256" cy="256" r="256" fill="url(#g)"/>${mark('#fff', 0.8)}`),
  androidSquare: svg(`<rect x="24" y="24" width="464" height="464" rx="104" fill="url(#g)"/>${mark('#fff', 0.8)}`),
}
fs.writeFileSync(ROOT + 'public/icons/icon.svg', variants.tile.replace('><defs>', '>\n  <defs>') + '\n')

const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, channel: process.env.CHROME ? undefined : 'chrome', headless: true })
const page = await browser.newPage()
async function render(svgText, w, h, file, { transparent = true, background = 'transparent', markScale } = {}) {
  const inner = markScale
    ? `<div style="width:${w}px;height:${h}px;background:${background};display:grid;place-items:center"><div style="width:${Math.round(Math.min(w, h) * markScale)}px;height:${Math.round(Math.min(w, h) * markScale)}px">${svgText}</div></div>`
    : `<div style="width:${w}px;height:${h}px">${svgText}</div>`
  await page.setViewportSize({ width: w, height: h })
  await page.setContent(`<!doctype html><html><body style="margin:0;background:${transparent ? 'transparent' : background}"><style>svg{width:100%;height:100%;display:block}</style>${inner}</body></html>`)
  await page.screenshot({ path: ROOT + file, omitBackground: transparent, clip: { x: 0, y: 0, width: w, height: h } })
}
const size = (f) => execFileSync('file', ['-b', ROOT + f]).toString().match(/(\d+) x (\d+)/).slice(1).map(Number)

await render(variants.tile, 192, 192, 'public/icons/icon-192.png')
await render(variants.tile, 512, 512, 'public/icons/icon-512.png')
await render(variants.maskable, 512, 512, 'public/icons/icon-maskable-512.png', { transparent: false })
await render(variants.apple, 180, 180, 'public/icons/apple-touch-icon.png', { transparent: false })
await render(variants.desktop, 1024, 1024, 'build/icon.png')
await render(variants.ios, 1024, 1024, 'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png', { transparent: false })
for (const [dpi, legacy] of Object.entries({ mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 })) {
  const fg = Math.round(legacy * 2.25)
  const dir = `android/app/src/main/res/mipmap-${dpi}/`
  await render(variants.androidFg, fg, fg, dir + 'ic_launcher_foreground.png')
  await render(variants.androidFg, fg, fg, dir + 'ic_launcher_monochrome.png')
  await render(variants.androidSquare, legacy, legacy, dir + 'ic_launcher.png')
  await render(variants.androidRound, legacy, legacy, dir + 'ic_launcher_round.png')
}
// Splash screens: the mark on the dark background, at every existing size.
const splashMark = svg(mark('#ededf0'))
const splashes = execFileSync('bash', ['-c', `cd "${ROOT}" && ls android/app/src/main/res/drawable*/splash.png ios/App/App/Assets.xcassets/Splash.imageset/*.png`]).toString().trim().split('\n')
for (const f of splashes) {
  const [w, h] = size(f)
  await render(splashMark, w, h, f, { transparent: false, background: '#0a0a0b', markScale: 0.3 })
}
// Capacitor's copy of the web icons in the iOS project.
for (const f of ['icon-192.png', 'icon-512.png']) if (fs.existsSync(ROOT + 'ios/App/App/public/icons/' + f)) fs.copyFileSync(ROOT + 'public/icons/' + f, ROOT + 'ios/App/App/public/icons/' + f)
await browser.close()
console.log('generated', 6 + 5 * 4 + splashes.length, 'files')
