import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, CirclePause, CirclePlay, Eye, RotateCcw, ShieldCheck, Square, X } from 'lucide-react'
import type { MessageKey } from '../i18n/messages'
import { useI18n } from '../i18n/context'
import type { PixivBatchTaskInput, PixivSessionTestResult } from '../api'
import * as api from '../api'
import type { PixivBatchPreviewArtwork, PixivBatchPreviewPage, PixivBatchPreviewResponse, PixivBatchTask } from '../shared/types'

type PixivBatchImportPanelProps = {
  projectId?: string
  r18Enabled: boolean
  disabled: boolean
  onImported: (projectId: string) => Promise<void>
  onError: (message: string) => void
}

const terminalStatuses = new Set(['completed', 'cancelled', 'failed'])

export function PixivBatchImportPanel(props: PixivBatchImportPanelProps) {
  const { t } = useI18n()
  const [urlsText, setUrlsText] = useState('')
  const [maxImages, setMaxImages] = useState(200)
  const [usePixivSession, setUsePixivSession] = useState(false)
  const [preview, setPreview] = useState<PixivBatchPreviewResponse | null>(null)
  const [task, setTask] = useState<PixivBatchTask | null>(null)
  const [clock, setClock] = useState(0)
  const [busy, setBusy] = useState<'preview' | 'start' | 'session' | ''>('')
  const [session, setSession] = useState<PixivSessionTestResult | null>(null)
  const completedTaskRef = useRef('')
  const onErrorRef = useRef(props.onError)
  const onImportedRef = useRef(props.onImported)

  const selectedPages = useMemo(
    () => preview?.artworks.flatMap((artwork) => artwork.pages.filter((page) => page.selected)) || [],
    [preview],
  )
  const taskId = task?.id
  const taskStatus = task?.status
  const activeTask = Boolean(task && !terminalStatuses.has(task.status))

  useEffect(() => {
    onErrorRef.current = props.onError
    onImportedRef.current = props.onImported
  }, [props.onError, props.onImported])

  useEffect(() => {
    if (!props.projectId) return
    let cancelled = false
    void api.listRecoverablePixivBatchTasks(props.projectId).then((tasks) => {
      if (cancelled) return
      setTask((current) => current && current.projectId === props.projectId && !terminalStatuses.has(current.status) ? current : tasks[0] || null)
    }).catch((error) => {
      if (!cancelled) onErrorRef.current(error instanceof Error ? error.message : t('log.unknownError'))
    })
    return () => {
      cancelled = true
    }
  }, [props.projectId, t])

  useEffect(() => {
    if (!taskId || !taskStatus || terminalStatuses.has(taskStatus)) return
    const timer = window.setInterval(() => {
      void api.getPixivBatchTask(taskId).then(setTask).catch((error) => {
        onErrorRef.current(error instanceof Error ? error.message : t('log.unknownError'))
      })
    }, 1200)
    return () => window.clearInterval(timer)
  }, [t, taskId, taskStatus])

  useEffect(() => {
    if (!task || task.status !== 'completed' || completedTaskRef.current === task.id) return
    completedTaskRef.current = task.id
    void onImportedRef.current(task.projectId).catch((error) => {
      onErrorRef.current(error instanceof Error ? error.message : t('log.unknownError'))
    })
  }, [t, task])

  useEffect(() => {
    if (!task?.retryAt) return
    const timer = window.setInterval(() => setClock(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [task?.retryAt])

  function setPageSelected(artworkId: string, pageIndex: number, selected: boolean) {
    setPreview((current) => {
      if (!current) return current
      const selectedCount = current.selectedPages + (selected ? 1 : -1)
      if (selected && selectedCount > current.maxImages) return current
      return {
        ...current,
        selectedPages: selectedCount,
        artworks: current.artworks.map((artwork) =>
          artwork.artworkId !== artworkId
            ? artwork
            : { ...artwork, pages: artwork.pages.map((page) => (page.pageIndex === pageIndex ? { ...page, selected } : page)) },
        ),
      }
    })
  }

  function setArtworkSelected(artwork: PixivBatchPreviewArtwork, selected: boolean) {
    const pageIndexes = new Set(artwork.pages.map((page) => page.pageIndex))
    setPreview((current) => {
      if (!current) return current
      const currentSelected = artwork.pages.filter((page) => page.selected).length
      const available = current.maxImages - current.selectedPages
      const pagesToSelect = selected ? Math.min(available + currentSelected, artwork.pages.length) : 0
      let remaining = pagesToSelect
      const nextArtworks = current.artworks.map((item) => {
        if (item.artworkId !== artwork.artworkId) return item
        return {
          ...item,
          pages: item.pages.map((page) => {
            if (!pageIndexes.has(page.pageIndex)) return page
            const nextSelected = selected && remaining > 0
            if (nextSelected) remaining -= 1
            return { ...page, selected: nextSelected }
          }),
        }
      })
      const nextSelectedPages = nextArtworks.reduce((total, item) => total + item.pages.filter((page) => page.selected).length, 0)
      return { ...current, artworks: nextArtworks, selectedPages: nextSelectedPages }
    })
  }

  function selectAll(selected: boolean) {
    setPreview((current) => {
      if (!current) return current
      let remaining = selected ? current.maxImages : 0
      const artworks = current.artworks.map((artwork) => ({
        ...artwork,
        pages: artwork.pages.map((page) => {
          const nextSelected = selected && remaining > 0
          if (nextSelected) remaining -= 1
          return { ...page, selected: nextSelected }
        }),
      }))
      const selectedPagesCount = artworks.reduce((total, artwork) => total + artwork.pages.filter((page) => page.selected).length, 0)
      return { ...current, artworks, selectedPages: selectedPagesCount }
    })
  }

  async function handlePreview() {
    if (activeTask) return
    const urls = urlsText
      .split(/[\r\n,]+/u)
      .map((value) => value.trim())
      .filter(Boolean)
    if (!urls.length) {
      props.onError(t('pixivBatch.urlsRequired'))
      return
    }
    setBusy('preview')
    setTask(null)
    try {
      setPreview(await api.previewPixivBatch({ urls, r18Enabled: props.r18Enabled, usePixivSession, maxImages }))
    } catch (error) {
      props.onError(error instanceof Error ? error.message : t('log.unknownError'))
    } finally {
      setBusy('')
    }
  }

  async function handleStart() {
    if (!selectedPages.length) {
      props.onError(t('pixivBatch.pagesRequired'))
      return
    }
    const input: PixivBatchTaskInput = {
      projectId: props.projectId,
      r18Enabled: props.r18Enabled,
      usePixivSession,
      pages: selectedPages.map(({ artworkId, pageIndex, sourceUrl, fileName }) => ({ artworkId, pageIndex, sourceUrl, fileName })),
    }
    setBusy('start')
    try {
      setTask(await api.createPixivBatchTask(input))
      setPreview(null)
    } catch (error) {
      props.onError(error instanceof Error ? error.message : t('log.unknownError'))
    } finally {
      setBusy('')
    }
  }

  async function handleTaskAction(action: 'pause' | 'resume' | 'cancel' | 'retry') {
    if (!task) return
    try {
      const next = action === 'pause'
        ? await api.pausePixivBatchTask(task.id)
        : action === 'resume'
          ? await api.resumePixivBatchTask(task.id)
          : action === 'cancel'
            ? await api.cancelPixivBatchTask(task.id)
            : await api.retryPixivBatchTask(task.id)
      setTask(next)
    } catch (error) {
      props.onError(error instanceof Error ? error.message : t('log.unknownError'))
    }
  }

  async function handleSessionTest() {
    setBusy('session')
    try {
      setSession(await api.testPixivSession())
    } catch (error) {
      props.onError(error instanceof Error ? error.message : t('log.unknownError'))
    } finally {
      setBusy('')
    }
  }

  return (
    <section className="pixiv-batch-panel" data-testid="pixiv-batch-panel">
      <div className="pixiv-batch-heading">
        <div>
          <strong>{t('pixivBatch.title')}</strong>
          <span>{t('pixivBatch.subtitle')}</span>
        </div>
        <button type="button" className="icon-button" aria-label={t('pixivBatch.testSession')} title={t('pixivBatch.testSession')} onClick={() => void handleSessionTest()} disabled={props.disabled || busy !== ''} data-testid="pixiv-session-test">
          {busy === 'session' ? <RotateCcw size={15} className="spin" /> : <ShieldCheck size={15} />}
        </button>
      </div>

      <label className="field-block">
        {t('pixivBatch.urlsLabel')}
        <textarea value={urlsText} onChange={(event) => setUrlsText(event.target.value)} rows={3} placeholder={t('pixivBatch.urlsPlaceholder')} disabled={props.disabled || activeTask} data-testid="pixiv-batch-urls" />
      </label>
      <label className="toggle-row">
        <input type="checkbox" checked={usePixivSession} onChange={(event) => setUsePixivSession(event.target.checked)} disabled={props.disabled || activeTask || busy !== ''} data-testid="pixiv-batch-use-session" />
        <span>{t('pixivBatch.useSession')}</span>
      </label>
      <div className="pixiv-batch-controls">
        <label>
          {t('pixivBatch.maxImages')}
          <input type="number" min={1} max={200} value={maxImages} onChange={(event) => setMaxImages(Math.min(200, Math.max(1, Number(event.target.value) || 1)))} disabled={props.disabled || activeTask || busy !== ''} data-testid="pixiv-batch-max-images" />
        </label>
        <button type="button" className="secondary-button" onClick={() => void handlePreview()} disabled={props.disabled || activeTask || busy !== ''} data-testid="pixiv-batch-preview">
          <Eye size={15} />
          {busy === 'preview' ? t('pixivBatch.preflighting') : t('pixivBatch.preflight')}
        </button>
      </div>

      {session ? <SessionBadge session={session} /> : null}

      {preview ? (
        <div className="pixiv-batch-preview" data-testid="pixiv-batch-preview-list">
          <div className="pixiv-batch-summary">
            <span>{t('pixivBatch.summary', { selected: preview.selectedPages, total: preview.totalPages, max: preview.maxImages })}</span>
            <span>{t('pixivBatch.delayHint', { ms: preview.requestDelayMs })}</span>
          </div>
          <div className="pixiv-batch-selection-actions">
            <button type="button" className="text-button" onClick={() => selectAll(true)}><Check size={14} />{t('pixivBatch.selectAll')}</button>
            <button type="button" className="text-button" onClick={() => selectAll(false)}><X size={14} />{t('pixivBatch.deselectAll')}</button>
          </div>
          <div className="pixiv-batch-artworks">
            {preview.artworks.map((artwork) => (
              <ArtworkPreview key={`${artwork.artworkId}:${artwork.artworkUrl}`} artwork={artwork} onPageChange={setPageSelected} onArtworkChange={setArtworkSelected} />
            ))}
          </div>
          <button type="button" className="primary-button" onClick={() => void handleStart()} disabled={props.disabled || busy !== '' || !selectedPages.length} data-testid="pixiv-batch-start">
            <CirclePlay size={15} />
            {busy === 'start' ? t('pixivBatch.starting') : t('pixivBatch.start')}
          </button>
        </div>
      ) : null}

      {task ? <TaskStatus task={task} now={clock} onAction={handleTaskAction} /> : null}
    </section>
  )
}

function ArtworkPreview(props: {
  artwork: PixivBatchPreviewArtwork
  onPageChange: (artworkId: string, pageIndex: number, selected: boolean) => void
  onArtworkChange: (artwork: PixivBatchPreviewArtwork, selected: boolean) => void
}) {
  const { t } = useI18n()
  const selectedCount = props.artwork.pages.filter((page) => page.selected).length
  return (
    <details className="pixiv-batch-artwork" open>
      <summary>
        <span>{t('pixivBatch.artwork', { id: props.artwork.artworkId })}</span>
        <span>{t('pixivBatch.pages', { selected: selectedCount, total: props.artwork.pageCount })}</span>
      </summary>
      {props.artwork.error ? <p className="error-text">{props.artwork.error}</p> : null}
      <div className="pixiv-batch-pages">
        {props.artwork.pages.map((page) => <PageCheckbox key={`${page.artworkId}-${page.pageIndex}`} page={page} onChange={props.onPageChange} />)}
      </div>
      <button type="button" className="text-button" onClick={() => props.onArtworkChange(props.artwork, selectedCount !== props.artwork.pages.length)}>
        {selectedCount === props.artwork.pages.length ? t('pixivBatch.deselectArtwork') : t('pixivBatch.selectArtwork')}
      </button>
    </details>
  )
}

function PageCheckbox(props: { page: PixivBatchPreviewPage; onChange: (artworkId: string, pageIndex: number, selected: boolean) => void }) {
  const { t } = useI18n()
  return (
    <label className="pixiv-batch-page">
      <input type="checkbox" checked={props.page.selected} onChange={(event) => props.onChange(props.page.artworkId, props.page.pageIndex, event.target.checked)} data-testid={`pixiv-batch-page-${props.page.artworkId}-${props.page.pageIndex}`} />
      <span>{t('pixivBatch.page', { n: props.page.pageIndex + 1 })}</span>
      <code>{props.page.fileName}</code>
    </label>
  )
}

function SessionBadge(props: { session: PixivSessionTestResult }) {
  const { t } = useI18n()
  const labels: Record<PixivSessionTestResult['status'], MessageKey> = {
    not_configured: 'pixivBatch.sessionNotConfigured',
    authenticated: 'pixivBatch.sessionAuthenticated',
    unauthenticated: 'pixivBatch.sessionUnauthenticated',
    rate_limited: 'pixivBatch.sessionRateLimited',
    error: 'pixivBatch.sessionError',
  }
  return <div className={`pixiv-session-badge ${props.session.status}`} data-testid="pixiv-session-result"><ShieldCheck size={14} /><span>{t(labels[props.session.status])}: {props.session.message}</span></div>
}

function TaskStatus(props: { task: PixivBatchTask; now: number; onAction: (action: 'pause' | 'resume' | 'cancel' | 'retry') => Promise<void> }) {
  const { t } = useI18n()
  const labels: Record<PixivBatchTask['status'], MessageKey> = {
    queued: 'pixivBatch.statusQueued',
    running: 'pixivBatch.statusRunning',
    paused: 'pixivBatch.statusPaused',
    completed: 'pixivBatch.statusCompleted',
    cancelled: 'pixivBatch.statusCancelled',
    failed: 'pixivBatch.statusFailed',
  }
  const progress = props.task.totalItems ? Math.round((props.task.completedItems / props.task.totalItems) * 100) : 0
  const retryTimestamp = props.task.retryAt ? Date.parse(props.task.retryAt) : Number.NaN
  const cooldownActive = Number.isFinite(retryTimestamp) && retryTimestamp > props.now
  return (
    <div className="pixiv-batch-task" data-testid="pixiv-batch-task" data-status={props.task.status}>
      <div className="pixiv-batch-task-heading"><strong>{t('pixivBatch.taskTitle')}</strong><span>{t(labels[props.task.status])}</span></div>
      <div className="pixiv-batch-progress"><span style={{ width: `${progress}%` }} /></div>
      <div className="pixiv-batch-task-meta">{t('pixivBatch.progress', { done: props.task.completedItems, total: props.task.totalItems, failed: props.task.failedItems })}</div>
      {props.task.pauseReason ? <p className="warning-text">{props.task.pauseReason}</p> : null}
      {cooldownActive ? <p className="warning-text" data-testid="pixiv-batch-retry-at">{t('pixivBatch.resumeAt', { time: new Date(retryTimestamp).toLocaleTimeString() })}</p> : null}
      {props.task.error ? <p className="error-text">{props.task.error}</p> : null}
      <div className="pixiv-batch-task-actions">
        {props.task.status === 'running' || props.task.status === 'queued' ? <button type="button" className="icon-button" title={t('pixivBatch.pause')} aria-label={t('pixivBatch.pause')} onClick={() => void props.onAction('pause')}><CirclePause size={15} /></button> : null}
        {props.task.status === 'paused' ? <button type="button" className="icon-button" title={t('pixivBatch.resume')} aria-label={t('pixivBatch.resume')} onClick={() => void props.onAction('resume')} disabled={cooldownActive}><CirclePlay size={15} /></button> : null}
        {props.task.status === 'failed' ? <button type="button" className="icon-button" title={t('pixivBatch.retry')} aria-label={t('pixivBatch.retry')} onClick={() => void props.onAction('retry')}><RotateCcw size={15} /></button> : null}
        {!terminalStatuses.has(props.task.status) ? <button type="button" className="icon-button danger" title={t('pixivBatch.cancel')} aria-label={t('pixivBatch.cancel')} onClick={() => void props.onAction('cancel')}><Square size={15} /></button> : null}
      </div>
    </div>
  )
}
