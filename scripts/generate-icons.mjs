// Generates every OpenPOS icon and splash asset from one mark, rendered with headless Chrome.
//   node scripts/generate-icons.mjs        (CHROME=/path/to/chrome to use another browser)
// Writes public/icons, the desktop icons in build/ (Linux icon-theme sizes, Windows .ico, macOS
// .icns), Android mipmaps + splashes and the iOS icon/splash. Every size is rendered from the
// vector mark rather than scaled down from one big PNG, so small icons stay sharp.
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
  // Windows: the tile almost edge to edge (the taskbar and Start menu add no mask of their own).
  win: svg(`<g transform="translate(256 256) scale(0.94) translate(-256 -256)"><rect width="512" height="512" rx="116" fill="url(#g)"/>${mark()}</g>`),
  // Linux: the tile with the small margin freedesktop icon themes use for app icons.
  linux: svg(`<g transform="translate(256 256) scale(0.88) translate(-256 -256)"><rect width="512" height="512" rx="116" fill="url(#g)"/>${mark()}</g>`),
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
/** Renders the SVG at exactly w×h and returns the PNG (also written to `file` when given). */
async function render(svgText, w, h, file, { transparent = true, background = 'transparent', markScale } = {}) {
  const inner = markScale
    ? `<div style="width:${w}px;height:${h}px;background:${background};display:grid;place-items:center"><div style="width:${Math.round(Math.min(w, h) * markScale)}px;height:${Math.round(Math.min(w, h) * markScale)}px">${svgText}</div></div>`
    : `<div style="width:${w}px;height:${h}px">${svgText}</div>`
  await page.setViewportSize({ width: w, height: h })
  await page.setContent(`<!doctype html><html><body style="margin:0;background:${transparent ? 'transparent' : background}"><style>svg{width:100%;height:100%;display:block}</style>${inner}</body></html>`)
  return page.screenshot({ path: file ? ROOT + file : undefined, omitBackground: transparent, clip: { x: 0, y: 0, width: w, height: h } })
}
/** One PNG per size, rendered one after another (they share the page). */
async function pngs(svgText, sizes) {
  const out = {}
  for (const s of sizes) out[s] = await render(svgText, s, s)
  return out
}

// .ico holding one PNG per size: the format electron-builder's own converter writes (Vista and later).
function ico(bySize) {
  const sizes = Object.keys(bySize).map(Number).sort((a, b) => a - b)
  const head = Buffer.alloc(6 + sizes.length * 16)
  head.writeUInt16LE(1, 2) // type: icon
  head.writeUInt16LE(sizes.length, 4)
  let offset = head.length
  sizes.forEach((size, i) => {
    const o = 6 + i * 16
    head[o] = head[o + 1] = size >= 256 ? 0 : size // 0 means 256
    head.writeUInt16LE(1, o + 4) // colour planes
    head.writeUInt16LE(32, o + 6) // bits per pixel
    head.writeUInt32LE(bySize[size].length, o + 8)
    head.writeUInt32LE(offset, o + 12)
    offset += bySize[size].length
  })
  return Buffer.concat([head, ...sizes.map((s) => bySize[s])])
}

// .icns holding PNGs. Each type code is one pixel size: the @2x codes reuse the next size up.
const ICNS_TYPES = { icp4: 16, icp5: 32, icp6: 64, ic07: 128, ic08: 256, ic09: 512, ic10: 1024, ic11: 32, ic12: 64, ic13: 256, ic14: 512 }
function icns(bySize) {
  const chunk = (type, data) => {
    const head = Buffer.alloc(8)
    head.write(type, 0, 'latin1')
    head.writeUInt32BE(8 + data.length, 4)
    return Buffer.concat([head, data])
  }
  const body = Buffer.concat(Object.entries(ICNS_TYPES).map(([type, size]) => chunk(type, bySize[size])))
  return chunk('icns', body)
}
const size = (f) => execFileSync('file', ['-b', ROOT + f]).toString().match(/(\d+) x (\d+)/).slice(1).map(Number)

await render(variants.tile, 192, 192, 'public/icons/icon-192.png')
await render(variants.tile, 512, 512, 'public/icons/icon-512.png')
await render(variants.maskable, 512, 512, 'public/icons/icon-maskable-512.png', { transparent: false })
await render(variants.apple, 180, 180, 'public/icons/apple-touch-icon.png', { transparent: false })
await render(variants.desktop, 1024, 1024, 'build/icon.png')
// Desktop installers (electron-builder.yml). Linux gets one PNG per icon-theme size: a lone
// 1024 px PNG lands in a folder the theme doesn't index, and the launcher shows a blank icon.
fs.mkdirSync(ROOT + 'build/icons', { recursive: true })
for (const s of [16, 24, 32, 48, 64, 128, 256, 512]) await render(variants.linux, s, s, `build/icons/${s}x${s}.png`)
fs.writeFileSync(ROOT + 'build/icon.ico', ico(await pngs(variants.win, [16, 24, 32, 48, 64, 128, 256])))
fs.writeFileSync(ROOT + 'build/icon.icns', icns(await pngs(variants.desktop, [16, 32, 64, 128, 256, 512, 1024])))
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
console.log('generated', 6 + 8 + 2 + 5 * 4 + splashes.length, 'files')
