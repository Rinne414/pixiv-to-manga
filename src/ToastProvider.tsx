import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { ReactNode } from 'react'
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react'
import { cryptoId } from './uiUtils'
import { useI18n } from './i18n/context'
import {
  ToastContext,
  type ConfirmOptions,
  type ToastContextValue,
  type ToastLevel,
} from './toastContext'

interface ToastEntry {
  id: string
  level: ToastLevel
  message: string
}

const MAX_TOASTS = 4
const SUCCESS_LIFETIME = 4000

/**
 * Overlay notification layer: success/info toasts auto-dismiss; error toasts
 * stay until dismissed. A confirm() promise replaces window.confirm so dialogs
 * match the app's visual language.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n()
  const [toasts, setToasts] = useState<ToastEntry[]>([])
  const [confirmState, setConfirmState] = useState<{
    options: ConfirmOptions
    resolve: (value: boolean) => void
  } | null>(null)
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const clearTimer = useCallback((id: string) => {
    const handle = timers.current.get(id)
    if (handle) {
      clearTimeout(handle)
      timers.current.delete(id)
    }
  }, [])

  const dismissToast = useCallback(
    (id: string) => {
      clearTimer(id)
      setToasts((current) => current.filter((toast) => toast.id !== id))
    },
    [clearTimer],
  )

  const pushToast = useCallback(
    (message: string, level: ToastLevel) => {
      const id = cryptoId()
      setToasts((current) => [...current, { id, level, message }].slice(-MAX_TOASTS))
      if (level === 'success' || level === 'info') {
        const handle = setTimeout(() => dismissToast(id), SUCCESS_LIFETIME)
        timers.current.set(id, handle)
      }
    },
    [dismissToast],
  )

  const confirm = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setConfirmState({ options, resolve })
    })
  }, [])

  const resolveConfirm = useCallback(
    (result: boolean) => {
      confirmState?.resolve(result)
      setConfirmState(null)
    },
    [confirmState],
  )

  useEffect(() => {
    const timersSnapshot = timers.current
    return () => {
      timersSnapshot.forEach((handle) => clearTimeout(handle))
      timersSnapshot.clear()
    }
  }, [])

  const value = useMemo<ToastContextValue>(
    () => ({ pushToast, dismissToast, confirm }),
    [pushToast, dismissToast, confirm],
  )

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-stack" role="region" aria-label={t('toast.notifications')} aria-live="polite">
        {toasts.map((toast) => (
          <ToastCard key={toast.id} toast={toast} onDismiss={() => dismissToast(toast.id)} />
        ))}
      </div>
      {confirmState ? (
        <ConfirmDialog
          options={confirmState.options}
          onCancel={() => resolveConfirm(false)}
          onConfirm={() => resolveConfirm(true)}
        />
      ) : null}
    </ToastContext.Provider>
  )
}

function ToastCard(props: { toast: ToastEntry; onDismiss: () => void }) {
  const { t } = useI18n()
  const { toast, onDismiss } = props
  const Icon = toast.level === 'success' ? CheckCircle2 : toast.level === 'error' ? AlertCircle : Info
  return (
    <div className={`toast-card ${toast.level}`} role="status">
      <Icon size={18} />
      <span>{toast.message}</span>
      <button
        type="button"
        className="toast-dismiss"
        aria-label={t('toast.dismiss')}
        onClick={onDismiss}
      >
        <X size={14} />
      </button>
    </div>
  )
}

function ConfirmDialog(props: {
  options: ConfirmOptions
  onCancel: () => void
  onConfirm: () => void
}) {
  const { options, onCancel, onConfirm } = props
  const initialFocusRef = useRef<HTMLButtonElement | null>(null)

  // Enter activates whichever button holds focus (native behavior); only Escape
  // needs a global listener. Danger dialogs focus Cancel so a stray Enter cannot
  // destroy data; safe dialogs focus Confirm to keep the old window.confirm flow.
  useEffect(() => {
    initialFocusRef.current?.focus()
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onCancel()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onCancel])

  return (
    <div
      className="confirm-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      aria-describedby="confirm-message"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onCancel()
        }
      }}
    >
      <div className={`confirm-card ${options.danger ? 'danger' : ''}`}>
        <h2 id="confirm-title">{options.title}</h2>
        <p id="confirm-message">{options.message}</p>
        <div className="confirm-actions">
          <button
            type="button"
            className="secondary-button"
            data-testid="confirm-dialog-cancel"
            ref={options.danger ? initialFocusRef : undefined}
            onClick={onCancel}
          >
            {options.cancelLabel}
          </button>
          <button
            type="button"
            className={`primary-button ${options.danger ? 'danger-button' : ''}`}
            data-testid="confirm-dialog-confirm"
            ref={options.danger ? undefined : initialFocusRef}
            onClick={onConfirm}
          >
            {options.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
