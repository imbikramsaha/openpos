import { StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { initI18n } from './i18n'
import { applyTheme, device } from './stores/device'
import { FullScreenLoader } from './components/ui'
import App from './App'

applyTheme(device().theme)
void initI18n(device().language)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={<FullScreenLoader />}>
      <App />
    </Suspense>
  </StrictMode>,
)
