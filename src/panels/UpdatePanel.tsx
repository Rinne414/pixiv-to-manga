import { AlertTriangle, CheckCircle2, Download, ExternalLink, Loader2, RefreshCw } from 'lucide-react'
import type { UpdateStatus } from '../api'
import { useI18n } from '../i18n/context'
import type { UpdatesState } from '../useUpdates'

function phaseText(status: UpdateStatus, t: ReturnType<typeof useI18n>['t']): string {
  switch (status.phase) {
    case 'downloading':
      return t('update.phaseDownloading', {
        percent: status.progress === null ? '' : `${Math.round(status.progress * 100)}%`,
      })
    case 'verifying':
      return t('update.phaseVerifying')
    case 'extracting':
      return t('update.phaseExtracting')
    case 'restarting':
      return t('update.phaseRestarting')
    default:
      return ''
  }
}

export function UpdatePanel({ updates }: { updates: UpdatesState }) {
  const { t } = useI18n()
  const { status, checking, installing, checkError } = updates
  if (!status) return null

  const latest = status.latest
  const working = status.phase === 'downloading' || status.phase === 'verifying' || status.phase === 'extracting' || status.phase === 'restarting'
  const busy = checking || working || installing
  const canInstall = Boolean(latest?.available && latest.hasPackage && status.canInstall)

  return (
    <section className="settings-section update-panel" data-testid="update-panel">
      <div className="settings-section-heading">
        <strong>{t('update.title')}</strong>
        <span>{t('update.hint')}</span>
      </div>

      <div className="update-version-row">
        <span className="update-version" data-testid="update-current-version">{t('update.currentVersion', { version: status.currentVersion })}</span>
        <button type="button" className="secondary-button" disabled={busy} onClick={() => void updates.check()} data-testid="update-check">
          {checking ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />}
          {checking ? t('update.checking') : t('update.checkNow')}
        </button>
      </div>

      {latest?.available ? (
        <div className="update-available" data-testid="update-available">
          <strong>{t('update.available', { version: latest.version })}</strong>
          {latest.notesSummary ? (
            <div className="update-notes">
              <span className="update-notes-label">{t('update.whatsNew')}</span>
              <p>{latest.notesSummary}</p>
            </div>
          ) : null}
          <div className="settings-action-row">
            {canInstall ? (
              <button type="button" className="primary-button" disabled={busy} onClick={() => void updates.install()} data-testid="update-install">
                {working || installing ? <Loader2 size={15} className="spin" /> : <Download size={15} />}
                {t('update.install')}
              </button>
            ) : null}
            <a className="secondary-button" href={latest.releaseUrl} target="_blank" rel="noreferrer">
              <ExternalLink size={15} />
              {t('update.viewRelease')}
            </a>
          </div>
          {!status.canInstall ? <p className="field-hint">{t('update.sourceInstall')}</p> : null}
          {status.canInstall && !latest.hasPackage ? <p className="field-hint">{t('update.noPackage', { version: latest.version })}</p> : null}
        </div>
      ) : latest ? (
        <div className="update-uptodate" data-testid="update-uptodate">
          <CheckCircle2 size={15} />
          <span>{t('update.upToDate')}</span>
        </div>
      ) : null}

      {working ? (
        <div className="update-progress" role="status" data-testid="update-progress">
          <Loader2 size={15} className="spin" />
          <span>{phaseText(status, t)}</span>
          {status.phase === 'downloading' && status.progress !== null ? (
            <progress value={status.progress} max={1} aria-label={phaseText(status, t)} />
          ) : null}
        </div>
      ) : null}

      {status.phase === 'error' && status.error ? (
        <div className="inline-alert" role="alert" data-testid="update-error">
          <AlertTriangle size={15} />
          <span>{t('update.failed', { error: status.error })}</span>
        </div>
      ) : null}
      {checkError ? (
        <div className="inline-alert" role="alert">
          <AlertTriangle size={15} />
          <span>{checkError}</span>
        </div>
      ) : null}

      <label className="update-auto-check">
        <input
          type="checkbox"
          checked={status.settings.autoCheck}
          onChange={(event) => void updates.setAutoCheck(event.target.checked)}
          data-testid="update-auto-check"
        />
        <span>{t('update.autoCheck')}</span>
      </label>
      <p className="field-hint">
        {status.settings.lastCheckedAt
          ? t('update.lastChecked', { time: new Date(status.settings.lastCheckedAt).toLocaleString() })
          : t('update.neverChecked')}
      </p>
    </section>
  )
}
