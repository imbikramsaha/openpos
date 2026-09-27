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
- **Installing**: Chrome, Edge and Android show their install prompt from the app's **Install app** button
  (⬇, next to the sync status). Safari has no prompt, so on iPhone, iPad and Mac the button shows the steps
  instead (Share → Add to Home Screen, or File → Add to Dock). The button is hidden once the app is
  installed, and in the desktop and mobile apps.
- **Netlify** (what https://appkasapos.netlify.app uses): build command `npx vite build`, publish directory
  `dist`; every push to `main` deploys. Every release also attaches `Kasa-POS-web.zip` for self-hosting.

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

`.github/workflows/release.yml` builds Windows, Mac, Linux (x64 and ARM64), Android and a zipped web build,
uploads everything to a draft GitHub Release, adds a download table to the release notes, and publishes it
once the desktop and Android builds succeed. You can also start it by hand under *Actions → Release → Run
workflow*. A full run takes about 20 minutes.

| File (same name in every release) | For |
|---|---|
| `Kasa-POS-Setup-x64.exe`, `Kasa-POS-Portable-x64.exe` | Windows 10/11 installer, and a portable copy that needs no install |
| `Kasa-POS-mac-universal.dmg` (`.zip` is for auto-update) | Mac, one build for Apple Silicon and Intel |
| `kasa-pos-linux-amd64.deb`, `Kasa-POS-linux-x86_64.AppImage` | Linux PCs |
| `kasa-pos-linux-arm64.deb`, `Kasa-POS-linux-arm64.AppImage` | Raspberry Pi 4/5 and other ARM64 Linux |
| `Kasa-POS-android.apk` (`.aab` too when signed) | Android 7+ phones and tablets (the `.aab` is for Google Play) |
| `Kasa-POS-web.zip` | self-hosting the web app |

Because the names never change, `https://github.com/<owner>/<repo>/releases/latest/download/<file>` always
downloads the newest version; the README's Download section uses these links.

The AppImage uses the static AppImage runtime (`toolsets.appimage` in `electron-builder.yml`), so it starts
on distributions without `libfuse2`, such as a stock Ubuntu 24.04 or newer.

Installed desktop apps check GitHub Releases 15 s after launch and every 6 h, download updates in the
background and install them on quit. Auto-update works for the NSIS, AppImage, deb and signed macOS builds,
but not for the portable `.exe` or the ad-hoc-signed Mac build. For a **private repository**, the links only
work for people signed in with access, and installed apps can't see releases, so they don't update until
the repository is public (or `publish` points at a public repository or a generic HTTPS server).

GitHub Actions minutes: on a private repository the Free plan includes 2,000 minutes a month, and macOS
minutes count 10× and Windows 2×, so one release uses roughly 150–250 of them. Public repositories don't use minutes.

Local builds need to know the GitHub repository for update metadata. They find it in package.json
`repository` or the `origin` remote. Before either exists, add `-c.publish.owner=<user> -c.publish.repo=kasa-pos`.

### Code signing (optional, recommended for shops)

| Platform | Without signing | Secrets for the Release workflow |
|---|---|---|
| Windows | SmartScreen shows "Windows protected your PC" → *More info → Run anyway* | `WIN_CSC_LINK` (base64 `.pfx`), `WIN_CSC_KEY_PASSWORD` |
| macOS | Ad-hoc signed (`electron-builder.mac-adhoc.yml`): the first launch needs *System Settings → Privacy & Security → Open Anyway*. **Auto-update requires signing.** | `MAC_CSC_LINK` (base64 Developer ID Application `.p12`), `MAC_CSC_KEY_PASSWORD`, and for notarisation `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` |
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
- **Release signing**: create a keystore once and **keep it safe** (password manager plus an offline copy).
  Every future version must be signed with it; if it's lost, installed apps can never be updated.
  ```bash
  keytool -genkeypair -v -keystore kasa-release.jks -alias kasa -keyalg RSA -keysize 4096 -validity 10000
  base64 -w0 kasa-release.jks | gh secret set ANDROID_KEYSTORE_BASE64
  gh secret set ANDROID_KEYSTORE_PASSWORD      # paste the keystore password when asked
  gh secret set ANDROID_KEY_PASSWORD           # the same password (PKCS12 keystores use one)
  gh secret set ANDROID_KEY_ALIAS --body kasa
  ```
  (`keytool` comes with any JDK, including Android Studio's: `…/android-studio/jbr/bin/keytool`.)
  With these secrets CI builds a signed `Kasa-POS-android.apk` and `.aab`. **Without them it signs the APK
  with a throwaway debug key**, which is fine for testing, but the next release can't update it: phones must
  uninstall first, which deletes their local data. Set the secrets before shops start using the app. To sign
  locally, export `ANDROID_KEYSTORE_FILE` plus the same three variables and run `./gradlew assembleRelease bundleRelease`.
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
- **Without an Apple Developer account** (the current setup), iPhone and iPad users install the web app:
  Safari → Share → Add to Home Screen (the in-app **Install app** button shows these steps). It runs full
  screen and offline like a native app. Apple doesn't allow installing native apps from a download link, so a
  native build needs the Apple Developer Program (US$99/year) and then TestFlight (a public beta link) or
  the App Store. The release workflow doesn't build iOS; add a signed job (e.g. fastlane match) once there is an account.

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

## 7. Automatic backups (device, folder, Google Drive, OneDrive, Dropbox)

*Settings → Automatic backup* makes a backup on a schedule (every 1, 4, 12 or 24 hours) and after each
shift is closed, sends it to every destination that's switched on, and deletes copies beyond the
"keep" count. Browsers can't run code while the app is closed, so backups run while Kasa POS is open:
the first check is 45 s after launch, then every 10 minutes, and again when the device comes back
online. A missed backup runs the next time the app opens.

| Destination | Needs setup? | Where the files go |
|---|---|---|
| On this device | no | inside the app (`kasa-pos-local` IndexedDB), newest 1–30 copies. Protects against mistakes, not against losing the device |
| Folder on this computer | no | any folder the user picks (Chrome, Edge, desktop app). Picking the Google Drive / OneDrive / Dropbox **sync folder** gets the files to the cloud through the provider's own desktop client |
| Google Drive | yes, once per installation | a `Kasa POS Backups` folder. The `drive.file` scope only lets the app see files it created |
| OneDrive | yes, once per installation | `Apps/<app name>/` (the `Files.ReadWrite.AppFolder` scope) |
| Dropbox | yes, once per installation | `Apps/<app name>/` (an *App folder* app) |

**Encryption.** With *Encrypt backups* on, files are AES-256-GCM encrypted with a key derived from a
passphrase (PBKDF2-SHA-256, 310,000 iterations) and saved as `.kasa` instead of `.json`. *Backup & restore*,
the setup wizard's *Restore* and every destination's *Restore…* ask for the passphrase. The passphrase is
kept on the device so unattended backups can run. It protects the copies stored elsewhere, and if it's
lost, those copies can't be opened. Recommend it for cloud destinations: backups contain customer
details and staff PIN hashes.

### Setting up the cloud destinations

The shop owner only clicks **Connect** and signs in. Before that, whoever hosts the app registers one
free developer app per provider (about 10 minutes each) and adds its IDs to the host. A provider with no
ID shows *"Not set up for this installation yet"*.

Sign-in uses OAuth 2.0 with PKCE in a pop-up that returns to `oauth-callback.html`. Dropbox exchanges
tokens directly from the browser. Google and Microsoft only issue long-lived refresh tokens to clients
that hold a secret, so their two token calls (code exchange and refresh) go through a small **token
broker**, `netlify/functions/oauth-token.mjs`. It holds the secrets, stores nothing and answers only the
site's own origin. Tokens stay on the device.

Register this **redirect URI** everywhere (use your own domain if it differs), plus
`http://localhost:5173/oauth-callback.html` for local development:

```
https://appkasapos.netlify.app/oauth-callback.html
```

**Dropbox**
1. [dropbox.com/developers/apps](https://www.dropbox.com/developers/apps) → *Create app* → *Scoped access* → **App folder** → a name (it becomes the folder name under *Apps/*).
2. *Permissions* tab: tick `files.content.write`, `files.content.read` and `files.metadata.read` (`account_info.read` is already on) → *Submit*.
3. *Settings* tab: add the redirect URI under *OAuth 2 → Redirect URIs*. Leave *Allow public clients (Implicit Grant & PKCE)* on *Allow*.
4. Copy the **App key** → `VITE_DROPBOX_APP_KEY`. There is no secret to copy.
5. New apps are in *Development*: only you can connect until you click *Enable additional users* (up to 500), or apply for production.

**Google Drive**
1. [console.cloud.google.com](https://console.cloud.google.com) → create a project → *APIs & Services → Library* → enable **Google Drive API**.
2. *Google Auth Platform* → *Branding*: app name and support email. *Audience*: **External**. *Data access*: add the scope `.../auth/drive.file`.
3. *Audience* → **Publish app**. While it's in *Testing*, only listed test users can sign in and Google expires their refresh tokens after **7 days**, so backups stop. `drive.file` is a non-sensitive scope, so publishing doesn't need Google's security review.
4. *Clients* → *Create client* → **Web application**. *Authorized JavaScript origins*: `https://appkasapos.netlify.app`. *Authorized redirect URIs*: the redirect URI above.
5. Copy the **Client ID** → `VITE_GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_ID`, and the **Client secret** → `GOOGLE_CLIENT_SECRET`.

**OneDrive (Microsoft)**
1. [entra.microsoft.com](https://entra.microsoft.com) → *App registrations* → *New registration*. You need a work account or a free Azure account, which creates a directory for you.
   - *Supported account types*: **Accounts in any organizational directory and personal Microsoft accounts**.
   - *Redirect URI*: platform **Web** (not *Single-page application*: that platform only allows browser-side token calls, and its refresh tokens last 24 h) → the redirect URI above.
2. *Certificates & secrets* → *New client secret* → copy the **Value** (not the ID) → `MS_CLIENT_SECRET`. It expires after at most 24 months: set a reminder to renew it.
3. *API permissions* → *Add a permission* → *Microsoft Graph* → *Delegated*: `Files.ReadWrite.AppFolder`, `offline_access` (`User.Read` is already there).
4. Copy the **Application (client) ID** from *Overview* → `VITE_MS_CLIENT_ID` and `MS_CLIENT_ID`.

**Netlify environment variables** (*Site configuration → Environment variables*):

| Variable | Value | Scope |
|---|---|---|
| `VITE_DROPBOX_APP_KEY` | Dropbox App key | Builds |
| `VITE_GOOGLE_CLIENT_ID` | Google Client ID | Builds |
| `VITE_MS_CLIENT_ID` | Microsoft Application (client) ID | Builds |
| `GOOGLE_CLIENT_ID` | Google Client ID | Functions |
| `GOOGLE_CLIENT_SECRET` | Google Client secret, marked *Contains secret values* | Functions |
| `MS_CLIENT_ID` | Microsoft Application (client) ID | Functions |
| `MS_CLIENT_SECRET` | Microsoft client secret Value, marked *Contains secret values* | Functions |
| `ALLOWED_ORIGINS` | optional, comma-separated extra origins for the broker (default: the site URL) | Functions |

`VITE_*` values are compiled into the app, so after adding or changing them run *Deploys → Trigger deploy
→ Deploy site*. They are public by design: an OAuth client ID isn't a secret. The two secrets are only
read by the function.

**Other hosts.** The broker is a standard `fetch(Request) → Response` handler, so it also runs on Cloudflare
Workers, Deno Deploy or a small Node server. Deploy it there and build the app with
`VITE_OAUTH_BROKER=https://…/oauth-token`. Dropbox needs no broker.

**Desktop and mobile apps.** Their shells open sign-in pages in the system browser, which can't hand the
result back to the app, so the cloud cards explain the alternative instead of offering *Connect*:
- **Desktop:** use *Folder on this computer* with the provider's sync folder.
- **Mobile:** use a downloaded backup file (*Backup & restore*).

The device and folder destinations work everywhere they're listed.

## 8. Hardware

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

## 9. Troubleshooting

| Symptom | Fix |
|---|---|
| Blank window, "dist/index.html is missing" | Run `npx vite build` before `electron .` |
| Silent print does nothing | Check the printer name in *Settings → Device*. See `kasa-main.log` ("Invalid deviceName" means the printer was renamed or removed) |
| Drawer doesn't open | Print a test page first. On Linux/macOS run `printf '\x1b\x70\x00\x19\xfa' \| lp -d <printer> -o raw`. On Windows check that the printer is online |
| Camera button missing or denied | Browser: use HTTPS. Android/iOS: allow Camera in the app's system settings. macOS: *Privacy & Security → Camera* |
| Tablet can't reach the sync server | Same Wi-Fi/VLAN? Firewall on port 8787? Try `http://<server>:8787/api/health` in the tablet's browser |
| macOS "app is damaged" (unsigned build) | `xattr -cr "/Applications/Kasa POS.app"`, or sign the build (§3) |
| Download link shows GitHub's 404 page | The repository is private: sign in with an account that has access, or make it public. Also check that a release has been published (drafts don't count as *latest*) |
| macOS "Apple could not verify Kasa POS" | Expected for ad-hoc builds: *System Settings → Privacy & Security → Open Anyway*, once |
| Linux AppImage doesn't start | Make it executable (`chmod +x`). Builds before the static runtime needed `libfuse2` (`sudo apt install libfuse2t64`) |
| Android "App not installed" / "package conflicts" when updating | The installed APK was signed with a different key (e.g. a debug test build). Back up, uninstall, install the new APK, restore |
| Cloud backup: "The sign-in window was blocked" | Allow pop-ups for the site. *Connect* must be clicked directly (no keyboard macro) |
| Cloud backup: `redirect_uri_mismatch` / `invalid redirect_uri` | The redirect URI registered with the provider must match `https://<your-site>/oauth-callback.html` exactly (scheme, host, no trailing slash) |
| Google Drive backups stop after a week | The Google app is still in *Testing*. Publish it (§7), then *Sign in again* |
| Google/OneDrive: "not_configured" when connecting | The `GOOGLE_*` / `MS_*` function variables are missing, or weren't scoped to *Functions*. Redeploy after adding them |
| Folder backup: "Needs permission" | Browsers ask again for folder access after a restart. Press *Allow access* on the card |
