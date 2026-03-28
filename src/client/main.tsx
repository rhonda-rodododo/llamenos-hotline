import { AuthProvider } from '@/lib/auth'
import { ConfigProvider } from '@/lib/config'
import { NoteSheetProvider } from '@/lib/note-sheet-context'
import { ThemeProvider } from '@/lib/theme'
import { ToastProvider } from '@/lib/toast'
import { RouterProvider, createRouter } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { routeTree } from './routeTree.gen'
import '@/lib/i18n'
import '@/app.css'

const router = createRouter({ routeTree })

// Expose router and key-manager for E2E test navigation
declare global {
  interface Window {
    __TEST_ROUTER: typeof router
    __TEST_KEY_MANAGER: typeof import('./lib/key-manager')
    __TEST_AUTH_FACADE: typeof import('./lib/auth-facade-client').authFacadeClient
    __llamenos_test_crypto: {
      encryptNoteV2: typeof import('./lib/crypto').encryptNoteV2
      decryptNoteV2: typeof import('./lib/crypto').decryptNoteV2
      decryptMessage: typeof import('./lib/crypto').decryptMessage
    }
  }
}
if (typeof window !== 'undefined') {
  window.__TEST_ROUTER = router
  import('./lib/key-manager').then((km) => {
    window.__TEST_KEY_MANAGER = km
  })
  import('./lib/auth-facade-client').then(({ authFacadeClient }) => {
    window.__TEST_AUTH_FACADE = authFacadeClient
  })
  // E2EE crypto helpers for Playwright test verification (dev/test builds only)
  if (import.meta.env.DEV) {
    import('./lib/crypto').then(({ encryptNoteV2, decryptNoteV2, decryptMessage }) => {
      window.__llamenos_test_crypto = { encryptNoteV2, decryptNoteV2, decryptMessage }
    })
  }
}

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <ConfigProvider>
        <ToastProvider>
          <AuthProvider>
            <NoteSheetProvider>
              <RouterProvider router={router} />
            </NoteSheetProvider>
          </AuthProvider>
        </ToastProvider>
      </ConfigProvider>
    </ThemeProvider>
  </StrictMode>
)
