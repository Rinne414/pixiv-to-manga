import { createContext, useContext } from 'react'

export type ToastLevel = 'success' | 'error' | 'info'

export interface ConfirmOptions {
  title: string
  message: string
  confirmLabel: string
  cancelLabel: string
  danger?: boolean
}

export interface ToastContextValue {
  pushToast: (message: string, level: ToastLevel) => void
  dismissToast: (id: string) => void
  confirm: (options: ConfirmOptions) => Promise<boolean>
}

export const ToastContext = createContext<ToastContextValue | null>(null)

export function useToast(): ToastContextValue {
  const value = useContext(ToastContext)
  if (!value) {
    throw new Error('useToast must be used inside ToastProvider')
  }
  return value
}
