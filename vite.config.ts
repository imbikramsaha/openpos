/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath, URL } from 'node:url'

// One build serves every platform: browsers (PWA), Electron (desktop) and Capacitor (mobile).
// `base: './'` keeps asset URLs relative so the bundle also loads from app:// and capacitor:// origins.
export default defineConfig({
  base: './',
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      // The icons are already precached by globPatterns; don't list them twice.
      includeManifestIcons: false,
      manifest: {
        id: './',
        name: 'Kasa POS',
        short_name: 'Kasa POS',
        description: 'Fast, offline-first point of sale',
        theme_color: '#4f46e5',
        background_color: '#0b1020',
        display: 'standalone',
        orientation: 'any',
        start_url: './',
        scope: './',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,wasm,json,woff2}'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallback: 'index.html',
        // Only the app's own entry URL: with relative asset paths, serving index.html for
        // /foo/bar would request /foo/assets/… and show a blank page.
        navigateFallbackAllowlist: [/\/(index\.html)?(\?.*)?$/],
        navigateFallbackDenylist: [/^\/api\//],
        // Take control of the page that installed the worker, so lazy screens and icons work
        // offline without a reload. Updates still wait for the user (registerType: 'prompt').
        clientsClaim: true,
      },
    }),
  ],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
    rolldownOptions: {
      output: {
        // One chunk per language instead of one per namespace file: ~90 precache entries
        // instead of ~450, so the service worker is ready for offline use much sooner.
        codeSplitting: {
          groups: [
            {
              name: (id) => {
                const m = /[\\/]i18n[\\/]locales[\\/]([^\\/]+)[\\/][^\\/]+\.json$/.exec(id)
                return m && m[1] !== 'en' ? `locale-${m[1]}` : null
              },
            },
          ],
        },
      },
    },
  },
  server: { host: true, port: 5173 },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
  },
})
