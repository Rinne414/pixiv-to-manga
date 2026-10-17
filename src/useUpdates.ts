import { useCallback, useEffect, useRef, useState } from 'react'
import * as api from './api'
import type { UpdateStatus } from './api'
import { useI18n } from './i18n/context'
import { useToast } from './toastContext'

const POLL_MS = 700
const RESTART_WAIT_MS = 120_000
const RESULT_SEEN_KEY = 'ptm-update-result-seen'

const ACTIVE_PHASES = new Set(['downloading', 'verifying', 'extracting', 'restarting'])

export interface UpdatesState {
  status: UpdateStatus | null
  /** A manual check is running. */
  checking: boolean
  /** The user pressed Update and the install has not finished yet. */
  installing: boolean
  checkError: string
  check: () => Promise<void>
  install: () => Promise<void>
  setAutoCheck: (enabled: boolean) => Promise<void>
}

export function useUpdates(): UpdatesState {
  const { t } = useI18n()
  const { pushToast } = useToast()
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const [checking, setChecking] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [checkError, setCheckError] = useState('')
  const serverWentAway = useRef(false)
  const restartStartedAt = useRef(0)
  const phase = status?.phase

  function announceLastResult(next: UpdateStatus) {
    const result = next.lastResult
    if (!result) return
    const stamp = `${result.ok}-${result.version ?? ''}-${result.error ?? ''}`
    try {
      if (window.sessionStorage.getItem(RESULT_SEEN_KEY) === stamp) return
      window.sessionStorage.setItem(RESULT_SEEN_KEY, stamp)
    } catch {
      // Without storage the toast may repeat after a reload; harmless.
    }
    if (result.ok) pushToast(t('update.doneToast', { version: result.version ?? next.currentVersion }), 'success')
    else pushToast(t('update.lastFailedToast', { error: result.error ?? '' }), 'error')
  }

  useEffect(() => {
    let cancelled = false
    api
      .getUpdateStatus()
      .then((next) => {
        if (cancelled) return
        setStatus(next)
        announceLastResult(next)
      })
      .catch(() => {
        // The update section simply stays hidden if the status endpoint is unreachable.
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once at start-up
  }, [])

  useEffect(() => {
    if (!phase || !ACTIVE_PHASES.has(phase)) return
    if (phase === 'restarting' && !restartStartedAt.current) restartStartedAt.current = Date.now()
    const timer = window.setInterval(() => {
      api
        .getUpdateStatus()
        .then((next) => {
          // Reaching the server again after it vanished means the new version is up: reload the UI.
          if (serverWentAway.current) {
            window.location.reload()
            return
          }
          setStatus(next)
          if (next.phase === 'error' || next.phase === 'idle') setInstalling(false)
        })
        .catch(() => {
          if (phase === 'restarting') serverWentAway.current = true
          if (restartStartedAt.current && Date.now() - restartStartedAt.current > RESTART_WAIT_MS) {
            setInstalling(false)
            setCheckError(t('update.restartTimeout'))
            window.clearInterval(timer)
          }
        })
    }, POLL_MS)
    return () => window.clearInterval(timer)
  }, [phase, t])

  const check = useCallback(async () => {
    setChecking(true)
    setCheckError('')
    try {
      setStatus(await api.checkForUpdate())
    } catch (error) {
      setCheckError(t('update.checkFailed', { error: error instanceof Error ? error.message : String(error) }))
    } finally {
      setChecking(false)
    }
  }, [t])

  const install = useCallback(async () => {
    setInstalling(true)
    setCheckError('')
    serverWentAway.current = false
    restartStartedAt.current = 0
    try {
      setStatus(await api.installUpdate())
    } catch (error) {
      setInstalling(false)
      setCheckError(t('update.failed', { error: error instanceof Error ? error.message : String(error) }))
    }
  }, [t])

  const setAutoCheck = useCallback(async (enabled: boolean) => {
    setStatus(await api.setUpdateAutoCheck(enabled))
  }, [])

  return { status, checking, installing, checkError, check, install, setAutoCheck }
}
