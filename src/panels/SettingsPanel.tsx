import { useState } from 'react'
import type { FormEvent } from 'react'
import { AlertTriangle, CheckCircle2, ChevronDown, FlaskConical, KeyRound, Loader2, Radar, Save, XCircle } from 'lucide-react'
import type { DiscoveredModel, ProviderTestResponse } from '../api'
import * as api from '../api'
import type { SecretStatus } from '../shared/types'
import type { ConnectionMode } from '../shared/types'
import { useI18n } from '../i18n/context'

export interface SettingsFormState {
  apiBaseUrl: string
  modelName: string
  apiKey: string
  pixivCookie: string
}

export function SettingsPanel(props: {
  status: SecretStatus | null
  form: SettingsFormState
  setForm: (value: SettingsFormState) => void
  onSubmit: (event: FormEvent, mode: ConnectionMode) => void
  disabled: boolean
  mode: ConnectionMode
  hasProviderConnection: boolean
}) {
  const { t } = useI18n()
  const [models, setModels] = useState<DiscoveredModel[]>([])
  const [testResult, setTestResult] = useState<ProviderTestResponse | null>(null)
  const [action, setAction] = useState<'discover' | 'test' | ''>('')
  const [actionError, setActionError] = useState('')
  const hasLegacySettings = props.mode === 'external' && !props.hasProviderConnection
  const update = (patch: Partial<SettingsFormState>) => {
    props.setForm({ ...props.form, ...patch })
    setActionError('')
    setTestResult(null)
  }

  async function discoverModels() {
    setAction('discover')
    setActionError('')
    try {
      const nextModels = await api.discoverLegacyModels({ apiBaseUrl: props.form.apiBaseUrl, apiKey: props.form.apiKey })
      setModels(nextModels)
      if (!props.form.modelName && nextModels[0]) {
        update({ modelName: nextModels[0].id })
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : t('settings.connectionTestUnknown'))
    } finally {
      setAction('')
    }
  }

  async function testConnection() {
    setAction('test')
    setActionError('')
    setTestResult(null)
    try {
      const result = await api.testLegacyConnection({
        apiBaseUrl: props.form.apiBaseUrl,
        modelName: props.form.modelName,
        apiKey: props.form.apiKey,
      })
      setTestResult(result)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : t('settings.connectionTestUnknown'))
    } finally {
      setAction('')
    }
  }

  return (
    <>
      {hasLegacySettings ? (
        <details className="connection-secondary-settings" data-testid="legacy-api-settings">
          <summary data-testid="legacy-api-toggle">
            <span>
              <KeyRound size={15} />
              {t('settings.legacyAdditional')}
            </span>
            <ChevronDown size={16} />
          </summary>
          <form className="settings-form" onSubmit={(event) => props.onSubmit(event, props.mode)}>
          <section className="settings-section">
            <div className="settings-section-heading">
                  <strong>{t('settings.legacySection')}</strong>
                  <span>{t('settings.legacySectionHint')}</span>
            </div>
            <label>
              {t('settings.baseUrl')}
              <input value={props.form.apiBaseUrl} onChange={(event) => update({ apiBaseUrl: event.target.value })} placeholder={t('settings.baseUrlPlaceholder')} />
            </label>
            <label>
              {t('settings.model')}
              <input list="legacy-model-options" value={props.form.modelName} onChange={(event) => update({ modelName: event.target.value })} placeholder={t('settings.modelPlaceholder')} />
              <datalist id="legacy-model-options">
                {models.map((model) => <option key={model.id} value={model.id}>{model.name || model.id}</option>)}
              </datalist>
            </label>
            <label>
              {t('settings.apiKey')}
              <input
                type="password"
                value={props.form.apiKey}
                onChange={(event) => update({ apiKey: event.target.value })}
                placeholder={props.status?.hasApiKey ? t('settings.savedInKeychain') : t('settings.notSavedPlaceholder')}
              />
            </label>
            <div className="settings-action-row">
              <button type="button" className="secondary-button" disabled={props.disabled || Boolean(action)} onClick={() => void discoverModels()}>
                {action === 'discover' ? <Loader2 size={15} className="spin" /> : <Radar size={15} />}
                {t('settings.fetchModels')}
              </button>
              <button type="button" className="secondary-button" disabled={props.disabled || Boolean(action)} onClick={() => void testConnection()}>
                {action === 'test' ? <Loader2 size={15} className="spin" /> : <FlaskConical size={15} />}
                {t('settings.testConnection')}
              </button>
            </div>
            {models.length ? <p className="field-hint">{t('settings.modelsFound', { count: models.length })}</p> : null}
            {actionError ? <div className="inline-alert"><AlertTriangle size={15} /><span>{actionError}</span></div> : null}
            {testResult ? <LegacyTestReadout result={testResult} /> : null}
          </section>
            <div className={`credential-status ${props.status?.keychainAvailable ? 'ok' : 'blocked'}`}>
              <strong>{props.status?.keychainAvailable ? t('settings.keychainOk') : t('settings.keychainBlocked')}</strong>
              <span>{t('settings.legacySecretStatus', { apiKey: props.status?.hasApiKey ? t('settings.saved') : t('settings.notSaved') })}</span>
            </div>
            <button type="submit" className="primary-button" disabled={props.disabled || props.status?.keychainAvailable === false}>
              <Save size={15} />
              {t('settings.save')}
            </button>
          </form>
        </details>
      ) : null}

      <details className="connection-secondary-settings" data-testid="connection-secondary-settings">
        <summary data-testid="connection-secondary-toggle">
          <span>
            <KeyRound size={15} />
            {t('settings.localAdditional')}
          </span>
          <ChevronDown size={16} />
        </summary>
        <form className="settings-form" onSubmit={(event) => props.onSubmit(event, props.mode)}>
          <section className="settings-section">
          <div className="settings-section-heading">
            <strong>{t('settings.pixivSection')}</strong>
            <span>{t('settings.pixivSectionHint')}</span>
          </div>
          <label>
            {t('settings.pixivCookie')}
            <textarea
              value={props.form.pixivCookie}
              onChange={(event) => update({ pixivCookie: event.target.value })}
              rows={4}
              placeholder={props.status?.hasPixivCookie ? t('settings.savedInKeychain') : t('settings.cookiePlaceholder')}
            />
          </label>
        </section>
        <div className={`credential-status ${props.status?.keychainAvailable ? 'ok' : 'blocked'}`}>
          <strong>{props.status?.keychainAvailable ? t('settings.keychainOk') : t('settings.keychainBlocked')}</strong>
            <span>{t('settings.pixivSecretStatus', { cookie: props.status?.hasPixivCookie ? t('settings.saved') : t('settings.notSaved') })}</span>
        </div>
        <button type="submit" className="primary-button" disabled={props.disabled || props.status?.keychainAvailable === false}>
          <Save size={15} />
          {t('settings.save')}
        </button>
      </form>
    </details>
    </>
  )
}

function LegacyTestReadout({ result }: { result: ProviderTestResponse }) {
  const { t } = useI18n()
  const passed = result.passed
  return (
    <div className={`settings-test-readout ${passed ? 'passed' : 'failed'}`} data-testid="legacy-api-test-result">
      {passed ? <CheckCircle2 size={15} /> : <XCircle size={15} />}
      <span>{passed ? t('settings.connectionTestPassed') : t('settings.connectionTestFailed')}</span>
      <span>{t('settings.connectionTestLatency', { ms: result.latencyMs })}</span>
    </div>
  )
}
