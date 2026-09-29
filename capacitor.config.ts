import type { CapacitorConfig } from '@capacitor/cli'

// Capacitor wraps the same Vite build (`dist/`) as native Android and iOS apps.
// After changing this file or rebuilding the web app run `npx cap sync`.
const config: CapacitorConfig = {
  appId: 'com.openpos.app',
  appName: 'OpenPOS',
  webDir: 'dist',
  // Dark theme background: avoids a white flash before the web app paints.
  backgroundColor: '#0a0a0b',
  server: {
    // Serve the bundle from https://localhost on Android (secure context → crypto.subtle,
    // camera, clipboard; stable origin → IndexedDB survives app updates).
    androidScheme: 'https',
    iosScheme: 'capacitor',
    hostname: 'localhost',
  },
  android: {
    backgroundColor: '#0a0a0b',
    // Lets the https:// app talk to a LAN sync server over plain http (e.g. http://192.168.1.10:8787).
    // Cleartext is additionally enabled in AndroidManifest.xml (android:usesCleartextTraffic).
    allowMixedContent: true,
    captureInput: true,
  },
  ios: {
    backgroundColor: '#0a0a0b',
    // The web app pads itself with env(safe-area-inset-*) (viewport-fit=cover), so let the
    // WebView run edge-to-edge instead of adding native insets on top.
    contentInset: 'never',
    scrollEnabled: true,
    limitsNavigationsToAppBoundDomains: false,
    preferredContentMode: 'mobile',
  },
}

export default config
