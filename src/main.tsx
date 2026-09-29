import { StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
// Inter ships with the app (offline, same look on every OS); other scripts use the system fonts.
import '@fontsource-variable/inter/opsz.css'
import './index.css'
import { initI18n } from './i18n'
import { applyTheme, device } from './stores/device'
import { FullScreenLoader } from './components/ui'
import { registerServiceWorker } from './components/UpdatePrompt'
import { listenForInstallPrompt } from './components/InstallApp'
import { ErrorBoundary } from './components/ErrorBoundary'
import App from './App'

applyTheme(device().theme)
void initI18n(device().language)
registerServiceWorker()
listenForInstallPrompt()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* Last line of defence: a crash outside a screen (lock screen, setup) shows Reload instead of a blank page. */}
    <ErrorBoundary>
      <Suspense fallback={<FullScreenLoader />}>
        <App />
      </Suspense>
    </ErrorBoundary>
  </StrictMode>,
)
