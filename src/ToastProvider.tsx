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
      setToasts((current) => evictOverflow([...current, { id, level, message }]))
      if (level === 'success' || level === 'info') {
        const handle = setTimeout(() => dismissToast(id), SUCCESS_LIFETIME)
        timers.current.set(id, handle)
      }
    },
    [dismissToast],
  )

  // Timers of evicted toasts are reconciled here rather than inside the state
  // updater, which must stay side-effect free.
  useEffect(() => {
    const active = new Set(toasts.map((toast) => toast.id))
    timers.current.forEach((handle, id) => {
      if (!active.has(id)) {
        clearTimeout(handle)
        timers.current.delete(id)
      }
    })
  }, [toasts])

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

/** Overflow drops the oldest auto-dismissing toast first; persistent errors survive longest. */
function evictOverflow(toasts: ToastEntry[]): ToastEntry[] {
  if (toasts.length <= MAX_TOASTS) return toasts
  const dropIndex = toasts.findIndex((toast) => toast.level !== 'error')
  const removeAt = dropIndex === -1 ? 0 : dropIndex
  return toasts.filter((_, index) => index !== removeAt)
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
  const cardRef = useRef<HTMLDivElement | null>(null)
  const initialFocusRef = useRef<HTMLButtonElement | null>(null)

  // Focus exactly once on mount — background toast re-renders must not steal
  // focus back — and hand focus to the opening element again on close. Danger
  // dialogs focus Cancel so a stray Enter cannot destroy data; safe dialogs
  // focus Confirm to keep the old window.confirm flow.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    initialFocusRef.current?.focus()
    return () => opener?.focus()
  }, [])

  // Enter activates whichever button holds focus (native behavior); Escape
  // cancels and Tab cycles inside the card so aria-modal matches reality.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onCancel()
        return
      }
      if (event.key !== 'Tab') return
      const card = cardRef.current
      if (!card) return
      const buttons = Array.from(card.querySelectorAll<HTMLButtonElement>('button'))
      if (!buttons.length) return
      const first = buttons[0]
      const last = buttons[buttons.length - 1]
      const active = document.activeElement
      if (event.shiftKey && (active === first || !card.contains(active))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (active === last || !card.contains(active))) {
        event.preventDefault()
        first.focus()
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
      <div className={`confirm-card ${options.danger ? 'danger' : ''}`} ref={cardRef}>
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
