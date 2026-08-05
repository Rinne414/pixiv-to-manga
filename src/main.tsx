import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MotionConfig } from 'motion/react'
import './index.css'
// Feature styles layer on top of index.css; keep this import order (see file headers).
import './styles/providerLab.css'
import './styles/storyContinue.css'
import App from './App.tsx'
import { I18nProvider } from './i18n/I18nProvider.tsx'
import { ToastProvider } from './ToastProvider.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <MotionConfig reducedMotion="user">
        <ToastProvider>
          <App />
        </ToastProvider>
      </MotionConfig>
    </I18nProvider>
  </StrictMode>,
)
