import type { FormEvent } from 'react'
import { Save } from 'lucide-react'
import type { SecretStatus } from '../shared/types'
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
  onSubmit: (event: FormEvent) => void
  disabled: boolean
}) {
  const { t } = useI18n()
  const update = (patch: Partial<SettingsFormState>) => props.setForm({ ...props.form, ...patch })
  return (
    <form className="inspector-body settings-form" onSubmit={props.onSubmit}>
      <div className={`credential-status ${props.status?.keychainAvailable ? 'ok' : 'blocked'}`}>
        <strong>{props.status?.keychainAvailable ? t('settings.keychainOk') : t('settings.keychainBlocked')}</strong>
        <span>
          {t('settings.secretSummary', {
            apiKey: props.status?.hasApiKey ? t('settings.saved') : t('settings.notSaved'),
            cookie: props.status?.hasPixivCookie ? t('settings.saved') : t('settings.notSaved'),
          })}
        </span>
      </div>
      <label>
        {t('settings.baseUrl')}
        <input value={props.form.apiBaseUrl} onChange={(event) => update({ apiBaseUrl: event.target.value })} placeholder={t('settings.baseUrlPlaceholder')} />
      </label>
      <label>
        {t('settings.model')}
        <input value={props.form.modelName} onChange={(event) => update({ modelName: event.target.value })} placeholder={t('settings.modelPlaceholder')} />
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
      <label>
        {t('settings.pixivCookie')}
        <textarea
          value={props.form.pixivCookie}
          onChange={(event) => update({ pixivCookie: event.target.value })}
          rows={4}
          placeholder={props.status?.hasPixivCookie ? t('settings.savedInKeychain') : t('settings.cookiePlaceholder')}
        />
      </label>
      <button type="submit" className="primary-button" disabled={props.disabled || props.status?.keychainAvailable === false}>
        <Save size={15} />
        {t('settings.save')}
      </button>
    </form>
  )
}
