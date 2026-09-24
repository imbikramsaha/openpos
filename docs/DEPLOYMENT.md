# Kasa POS — Building, deploying & hardware

One web build (`npx vite build` → `dist/`) ships everywhere:

| Target | Shell | Output | Where it's built |
|---|---|---|---|
| Browser / installable PWA | service worker (`vite-plugin-pwa`) | `dist/` | any machine |
| Windows, macOS, Linux | Electron (`electron/`, `electron-builder.yml`) | `release/` | the matching OS (or CI) |
| Android | Capacitor (`android/`, `capacitor.config.ts`) | APK / AAB | JDK 21 + Android SDK (or CI) |
| iOS / iPadOS | Capacitor (`ios/`) | Xcode archive | a Mac with Xcode (or CI) |
| Multi-terminal sync | Node server (`server/`) | process or Docker image | any machine on the LAN / cloud |

Requirements for local work: Node 24, npm 11.

## 1. GitHub setup and automatic sync

```bash
npm run github:setup                      # = bash scripts/github-setup.sh
npm run github:setup -- --name my-pos --public
```

The script installs the GitHub CLI into `~/.local/bin` if it's missing, signs you in through the
browser, lets git use it for credentials, creates the repository (private by default) or pushes to
the existing `origin`, and installs a **post-commit hook** that pushes every commit in the background
(`.git/auto-push.log`; skip one push with `KASA_NO_AUTOPUSH=1 git commit …`). You can run it again at any time.

- `npm run sync:watch` (`scripts/auto-sync.sh`) commits and pushes everything that changed every 30 s,
  or as soon as files change if `inotifywait` (Linux: `inotify-tools`) or `fswatch` (macOS) is installed.
  `--once` runs one cycle, `--interval 60` changes the pace, `--pull` rebases onto the remote first, and
  `--no-push` only commits. It respects `.gitignore`, pauses during merges and rebases, and stops cleanly on Ctrl+C.
- Remove the hook with `bash scripts/install-git-hooks.sh --uninstall` (any previous hook is restored).

## 2. Web / PWA

```bash
npm ci && npx vite build      # → dist/ (static files, relative paths, works in any sub-folder)
npx vite preview --host       # local test at http://<pc>:4173
```

- **Any static host works**: GitHub Pages, Netlify, Cloudflare Pages, nginx, S3, or the sync server itself
  (it serves `dist/`, see `server/README.md`). Routing is hash-based (`#/products`), so no rewrite rules are needed.
- **HTTPS is required** to install the app and to use the camera scanner, clipboard and `crypto.subtle`
  (`http://localhost` is the only exception). Plain `http://192.168.x.x` opens the app, but it can't be installed.
- The service worker precaches the whole app, so after the first visit it works fully offline. When a new
  version is deployed, the app shows an "update available" prompt.
- **GitHub Pages**: the Release workflow deploys `dist/` automatically. Enable it once under
  *Settings → Pages → Source: GitHub Actions*. Because releases run from tags, also add a `v*` rule under
  *Settings → Environments → github-pages → Deployment branches and tags*. Pages on private repositories needs a paid plan.
- **Netlify**: set build command `npx vite build` and publish directory `dist`, or drag and drop `dist/`.
  Every release also attaches `Kasa-POS-<version>-web.zip` for self-hosting.

## 3. Desktop (Electron)

```bash
npm run desktop:dev   # Vite dev server + Electron with HMR (run `npm run dev` in another terminal)
npm run desktop       # build dist/ and run it in Electron
npm run dist:win      # or dist:mac / dist:linux → release/
```

- Windows produces an NSIS installer (you choose the folder, desktop and Start-menu shortcuts are
  created, and data is kept on uninstall) and a portable `.exe`. macOS produces `dmg` and `zip` for Intel
  and Apple Silicon. Linux produces an `AppImage` and a `.deb`. Build each OS on that OS; cross-building
  Windows or macOS from Linux isn't supported without Wine or a Mac, so let CI do it.
- The app is served from `app://kasa/` (a stable secure origin). Its IndexedDB database is stored in
  the OS profile folder (`%APPDATA%\Kasa POS`, `~/Library/Application Support/Kasa POS`, `~/.config/Kasa POS`)
  and survives updates. The main-process log is `kasa-main.log` in the same folder.
- **Kiosk mode** for dedicated tills: start with `KASA_KIOSK=1` (or the `--kiosk` argument). The app runs
  full screen with no window chrome and the display never sleeps. On Windows, edit the shortcut target to
  `"…\Kasa POS.exe" --kiosk` and put it in `shell:startup` to launch on boot.
- Other switches: `KASA_USER_DATA_DIR=<dir>` (a separate profile, e.g. two tills on one PC),
  `KASA_DEVTOOLS=1` (F12 in packaged builds), `KASA_DISABLE_UPDATES=1`.
- Keys: F11 toggles full screen and Ctrl +/−/0 zoom (these are in the menu on macOS). Only one instance
  runs per profile; opening it again focuses the existing window.
- The **customer display** (`#/display`) opens as a second window and is placed on the second monitor
  automatically (full screen in kiosk mode).

### Releases and auto-update

```bash
npm version 1.2.0 --no-git-tag-version && git commit -am "v1.2.0"
git tag v1.2.0 && git push origin main v1.2.0
```

`.github/workflows/release.yml` builds Windows, macOS, Linux, Android, iOS (simulator) and web, uploads
everything to a draft GitHub Release, and publishes it once the desktop and Android builds succeed. You
can also start it by hand under *Actions → Release → Run workflow*. Installed desktop apps check GitHub
Releases 15 s after launch and every 6 h, download updates in the background and install them on quit.
Auto-update works for the NSIS, AppImage, deb and signed macOS builds, but not for the portable `.exe`.
For a **private repository**, clients need a token to see releases, so publish releases from a public
repository, or point `publish` at a generic HTTPS server.

Local builds need to know the GitHub repository for update metadata. They find it in package.json
`repository` or the `origin` remote. Before either exists, add `-c.publish.owner=<user> -c.publish.repo=kasa-pos`.

### Code signing (optional, recommended for shops)

| Platform | Without signing | Secrets for the Release workflow |
|---|---|---|
| Windows | SmartScreen shows "Windows protected your PC" → *More info → Run anyway* | `WIN_CSC_LINK` (base64 `.pfx`), `WIN_CSC_KEY_PASSWORD` |
| macOS | Right-click → *Open* the first time. **Auto-update requires signing.** | `MAC_CSC_LINK` (base64 Developer ID Application `.p12`), `MAC_CSC_KEY_PASSWORD`, and for notarisation `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` |
| Linux | nothing needed | — |

Encode a certificate with `base64 -w0 cert.p12` (macOS: `base64 -i cert.p12`). The macOS build uses the
hardened runtime with the camera entitlement (`electron/entitlements.mac.plist`).

## 4. Android

```bash
npx vite build && npx cap sync android     # after every web change (= npm run mobile:sync)
npx cap open android                       # Android Studio → Run, or:
cd android && ./gradlew assembleDebug      # → app/build/outputs/apk/debug/app-debug.apk
```

- You need JDK 21 and the Android SDK (Android Studio installs both). The minimum is Android 7 (API 24).
  Phones run in portrait and tablets in landscape (no orientation lock).
- `versionName` and `versionCode` come from `package.json` (1.2.3 → 10203; override with `ANDROID_VERSION_CODE`).
- **Sideload**: copy the APK to the device and allow "Install unknown apps", or run `adb install -r app.apk`.
  A debug-signed APK can't be upgraded by a release-signed one (uninstall first, which **deletes local
  data**, so sync or back up first).
- **Release signing**: create a keystore once and **keep it safe**. Losing it means you can never
  update the app again.
  ```bash
  keytool -genkeypair -v -keystore kasa-release.jks -alias kasa -keyalg RSA -keysize 2048 -validity 10000
  base64 -w0 kasa-release.jks   # → secret ANDROID_KEYSTORE_BASE64
  ```
  Add the repository secrets `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`
  and `ANDROID_KEY_PASSWORD`. CI then builds a signed `app-release.apk` and `.aab`. Without them it builds
  a debug APK. To sign locally, export `ANDROID_KEYSTORE_FILE` plus the same three variables and run
  `./gradlew assembleRelease bundleRelease`.
- **Play Store**: upload the `.aab`, enable Play App Signing, and declare camera use (barcode scanning).
  The camera is marked optional, so tablets without one can install the app.
- **Camera**: the manifest declares `CAMERA`. Capacitor's WebView asks for the runtime permission the
  first time the scanner opens and then grants `getUserMedia`.
- The icons and splash screens in `android/app/src/main/res` were generated from `public/icons/icon.svg`
  (adaptive icon with an indigo gradient background and a monochrome layer for themed icons; dark `#0b1020` splash).

## 5. iOS / iPadOS

This needs a Mac with Xcode (current version) and an Apple Developer account for devices and the App Store.

```bash
npm ci && npx vite build && npx cap sync ios
npx cap open ios        # Xcode → select the "App" target → Signing & Capabilities → your Team → Run
```

- The project uses Swift Package Manager, so there's no CocoaPods step. If `ios/` is ever missing, run
  `npx cap add ios --packagemanager SPM`.
- `Info.plist` already declares the camera (`NSCameraUsageDescription`), photo library, local network
  and `NSAllowsLocalNetworking` (see §6).
- **App Store / TestFlight**: in Xcode choose *Product → Archive → Distribute App*. Set the version under
  *General → Identity* (or `MARKETING_VERSION`).
- CI builds an unsigned simulator app (`Kasa-POS-<v>-ios-simulator.zip`) to prove the project compiles.
  Signed device builds need certificates and profiles, so they're done on a Mac as described above
  (or add fastlane match later).

## 6. Multi-terminal sync server

Setup, Docker, Raspberry Pi and HTTPS are covered in **[server/README.md](../server/README.md)**. In short:
run the server on one always-on machine in the shop, create a store key, then enter the server address
and key on each till (*Settings → Sync*). Tagged releases also publish a Docker image,
`ghcr.io/<owner>/kasa-pos-server:<version>` (amd64 + arm64), through `.github/workflows/server-docker.yml`.

**Plain-http LAN servers** (e.g. `http://192.168.1.10:8787`) work from every shell:

| Shell | Why it works |
|---|---|
| Desktop (Electron) | `app://kasa` is a custom secure scheme. Chromium only blocks mixed content on https pages, so `fetch()` to `http://<LAN-IP>` is allowed. Verified: GET and POST with auth headers from `app://kasa` to a LAN IP succeed. No `allowRunningInsecureContent` is needed. |
| Android | `android.allowMixedContent: true` (the WebView origin is `https://localhost`) plus `android:usesCleartextTraffic="true"` in `AndroidManifest.xml` |
| iOS | `NSAppTransportSecurity → NSAllowsLocalNetworking = true` allows plain http to LAN IPs, `.local` names and unqualified hosts. iOS 14+ asks the user once for *Local Network* access. |
| Browser / PWA | An **https** page can't call an **http** server (mixed content). Open the web app from the sync server itself (`http://<server>:8787`, same origin), or give the server HTTPS. |

`NSAllowsArbitraryLoads` is deliberately **not** set. It would allow plain http to *any* internet host,
which weakens every connection the app makes and must be justified in App Store review. A LAN server
doesn't need it, and a cloud server should use HTTPS anyway.

## 7. Hardware

### Barcode scanners
- **USB or Bluetooth scanners** work out of the box in *keyboard (HID) mode*. They type the code
  followed by Enter, and the Sell screen picks it up anywhere. Set the scanner to add an Enter suffix and
  to use the same keyboard layout as the OS. Pair Bluetooth scanners in HID mode, not SPP.
- **Camera scanning** works on phones, tablets and laptops (EAN/UPC, Code 128/39, QR, …). It needs HTTPS
  in browsers, and camera permission on Android, iOS and macOS.

### Receipt printers (58 mm / 80 mm thermal)
- Install the vendor driver (Epson TM, Star, Xprinter, Rongta…) so the printer appears in the OS printer
  list. On Linux/macOS add it in CUPS (`http://localhost:631` or System Settings). Generic ESC/POS
  printers usually work with the vendor's "80mm Series" or "POS-58" driver.
- In the driver, set the paper to roll width (58 or 80 mm) and turn off headers, footers and scaling.
- Choose the paper width in *Settings → Receipt*. Browsers and mobile use the system print dialog, which
  also offers *Save as PDF*.
- **Silent printing (desktop)**: choose the printer and enable *Silent print* in the device settings.
  The desktop app prints straight to that printer with no dialog. The page is sized exactly to the
  receipt (paper width × content height, no margins), so there's no long blank feed. A4 invoices use A4
  with the document's own margins.
- Android: print through the system print service (install the vendor's print plugin, e.g. "Epson iPrint"
  or "RawBT"). iOS: AirPrint printers, or the vendor's AirPrint bridge.

### Cash drawers
- The drawer plugs into the receipt printer's **RJ11/RJ12 "DK" port**, not the computer. The desktop app
  sends the ESC/POS kick pulse `1B 70 00 19 FA` (pin 2) as raw bytes to the selected printer
  (or the OS default printer):
  - macOS / Linux: `lp -d <printer> -o raw` (install `cups-client`; the `.deb` recommends it). The CUPS queue
    must accept raw jobs, which the vendor ESC/POS drivers do.
  - Windows: RAW job through the print spooler (`winspool.drv`, via PowerShell). If that fails it falls back
    to `copy /b` to `\\localhost\<printer>` (requires sharing the printer under the same name).
- Most printers can also be set in their utility to open the drawer after every receipt. That's the
  simplest option on Android and iOS, where the app can't send raw bytes.
- Drawers wired to pin 5 need `1B 70 01 19 FA`. Ask if you need this to be configurable.

### Weighing scales
- **Label-printing scales** (the most common kind): the scale prints EAN-13 labels with an embedded weight
  or price, e.g. `2 PPPPP WWWWW C` (prefix 20–29, PLU, weight in grams or price, check digit). Scanning the
  label adds the item with its weight or price. Configure the prefix and format in the app settings to
  match the scale.
- Scales connected directly over RS-232 or USB-serial (e.g. with the Web Serial API) aren't supported yet.

### Customer display
- A second monitor shows the **customer display** window (cart, totals, payment QR, thank-you screen).
  On desktop it opens on the second screen automatically; in browsers, drag the pop-up there.
- Pole displays (VFD, 2×20 characters on serial/USB) are planned but not supported yet.

## 8. Troubleshooting

| Symptom | Fix |
|---|---|
| Blank window, "dist/index.html is missing" | Run `npx vite build` before `electron .` |
| Silent print does nothing | Check the printer name in *Settings → Device*. See `kasa-main.log` ("Invalid deviceName" means the printer was renamed or removed) |
| Drawer doesn't open | Print a test page first. On Linux/macOS run `printf '\x1b\x70\x00\x19\xfa' \| lp -d <printer> -o raw`. On Windows check that the printer is online |
| Camera button missing or denied | Browser: use HTTPS. Android/iOS: allow Camera in the app's system settings. macOS: *Privacy & Security → Camera* |
| Tablet can't reach the sync server | Same Wi-Fi/VLAN? Firewall on port 8787? Try `http://<server>:8787/api/health` in the tablet's browser |
| macOS "app is damaged" (unsigned build) | `xattr -cr "/Applications/Kasa POS.app"`, or sign the build (§3) |
