import { useState } from 'react'
import type { FontAsset, LetteringDefaults } from '../shared/types'
import { FONT_PRESETS, fontValueFromFamily } from '../fonts'
import { useI18n } from '../i18n/context'

interface LetteringDefaultsPanelProps {
  defaults: LetteringDefaults
  customFonts: FontAsset[]
  disabled: boolean
  onSave: (defaults: LetteringDefaults, applyToExisting: boolean) => void
  onColorByCharacter: () => void
}

export function LetteringDefaultsPanel(props: LetteringDefaultsPanelProps) {
  const { t } = useI18n()
  const [draft, setDraft] = useState(props.defaults)

  const update = (patch: Partial<LetteringDefaults>) => setDraft((current) => ({ ...current, ...patch }))

  return (
    <section className="settings-section lettering-defaults-panel" data-testid="lettering-defaults-panel">
      <div className="settings-section-heading">
        <strong>{t('lettering.title')}</strong>
        <span>{t('lettering.hint')}</span>
      </div>
      <div className="two-col">
        <label>
          {t('lettering.font')}
          <select value={draft.fontFamily || ''} onChange={(event) => update({ fontFamily: event.target.value || undefined })}>
            {FONT_PRESETS.map((preset) => (
              <option key={preset.value || 'default'} value={preset.value}>
                {t(preset.labelKey)}
              </option>
            ))}
            {props.customFonts.map((font) => (
              <option key={font.id} value={fontValueFromFamily(font.familyName)}>
                {font.familyName}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('lettering.color')}
          <input type="color" value={draft.color} onChange={(event) => update({ color: event.target.value })} />
        </label>
      </div>
      <label className="range-row">
        <span>{t('lettering.scale')}</span>
        <input type="range" min="0.5" max="2.5" step="0.05" value={draft.scale} onChange={(event) => update({ scale: Number(event.target.value) })} />
        <strong>{draft.scale.toFixed(2)}x</strong>
      </label>
      <div className="two-col">
        <label>
          {t('lettering.sfxStroke')}
          <input type="color" value={draft.sfxStrokeColor} onChange={(event) => update({ sfxStrokeColor: event.target.value })} />
        </label>
        <label>
          {t('lettering.sfxStrokeWidth')}
          <input type="number" min="0.05" max="0.6" step="0.01" value={draft.sfxStrokeWidth} onChange={(event) => update({ sfxStrokeWidth: Number(event.target.value) })} />
        </label>
      </div>
      <div className="two-col lettering-actions">
        <button type="button" className="secondary-button" disabled={props.disabled} onClick={() => props.onSave(draft, false)} data-testid="lettering-save-defaults">
          {t('lettering.saveDefaults')}
        </button>
        <button type="button" className="secondary-button" disabled={props.disabled} onClick={() => props.onSave(draft, true)} data-testid="lettering-apply-all">
          {t('lettering.applyAll')}
        </button>
      </div>
      <button type="button" className="secondary-button" disabled={props.disabled} onClick={props.onColorByCharacter} data-testid="lettering-color-by-character">
        {t('lettering.colorByCharacter')}
      </button>
    </section>
  )
}
