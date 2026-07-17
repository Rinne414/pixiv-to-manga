import { PanelRight, Play } from 'lucide-react'
import type { Dialogue, ReadingDirection } from '../shared/types'
import { WHITEBOARD_MAX_ZOOM, WHITEBOARD_MIN_ZOOM } from '../WhiteboardCanvas'
import { useI18n } from '../i18n/context'
import { clampNumber } from '../uiUtils'

export function LayoutPanel(props: {
  mode: 'story' | 'translation'
  setMode: (mode: 'story' | 'translation') => void
  textDensity: number
  setTextDensity: (value: number) => void
  zoom: number
  setZoom: (value: number) => void
  pageCount: number
  rangeFrom: string
  rangeTo: string
  setRangeFrom: (value: string) => void
  setRangeTo: (value: string) => void
  onGenerateRange: () => void
  readingDirection?: ReadingDirection
  onReadingDirectionChange: (direction: ReadingDirection) => void
  selectedDialogue?: Dialogue
  onCommit: (id: string, patch: Partial<Dialogue>) => void
  onAvoidOverlap: () => void
  disabled: boolean
}) {
  const { t } = useI18n()
  const dialogue = props.selectedDialogue
  return (
    <div className="inspector-body">
      <div className="segmented">
        <button type="button" className={props.mode === 'story' ? 'active' : ''} onClick={() => props.setMode('story')}>
          {t('mode.story')}
        </button>
        <button type="button" className={props.mode === 'translation' ? 'active' : ''} onClick={() => props.setMode('translation')}>
          {t('mode.translation')}
        </button>
      </div>
      <div className="field-stack">
        <span className="field-label">{t('layout.readingDirection')}</span>
        <div className="segmented">
          <button
            type="button"
            className={props.readingDirection === 'rtl' ? 'active' : ''}
            data-testid="reading-direction-rtl"
            disabled={props.disabled || !props.readingDirection}
            onClick={() => props.onReadingDirectionChange('rtl')}
          >
            {t('layout.readingRtl')}
          </button>
          <button
            type="button"
            className={props.readingDirection === 'ltr' ? 'active' : ''}
            data-testid="reading-direction-ltr"
            disabled={props.disabled || !props.readingDirection}
            onClick={() => props.onReadingDirectionChange('ltr')}
          >
            {t('layout.readingLtr')}
          </button>
        </div>
        <span className="field-hint">{t('layout.readingDirectionHint')}</span>
      </div>
      <label className="range-row">
        <span>{t('layout.textDensity')}</span>
        <input type="range" min="0" max="1" step="0.05" value={props.textDensity} onChange={(event) => props.setTextDensity(Number(event.target.value))} />
        <strong>{props.textDensity.toFixed(2)}</strong>
      </label>
      <div className="edit-form compact generate-range-block">
        <div className="two-col">
          <label>
            {t('layout.rangeFrom')}
            <input
              type="number"
              min={1}
              max={props.pageCount || 1}
              value={props.rangeFrom}
              data-testid="generate-range-from"
              onChange={(event) => props.setRangeFrom(event.target.value)}
            />
          </label>
          <label>
            {t('layout.rangeTo')}
            <input
              type="number"
              min={1}
              max={props.pageCount || 1}
              value={props.rangeTo}
              placeholder={props.pageCount ? String(props.pageCount) : ''}
              data-testid="generate-range-to"
              onChange={(event) => props.setRangeTo(event.target.value)}
            />
          </label>
        </div>
        <button
          type="button"
          className="secondary-button"
          data-testid="generate-range-run"
          disabled={props.disabled || !props.pageCount}
          onClick={props.onGenerateRange}
        >
          <Play size={15} />
          {t('layout.generateRange')}
        </button>
        <span className="field-hint">{t('layout.generateRangeHint')}</span>
      </div>
      <label className="range-row">
        <span>{t('layout.canvasZoom')}</span>
        <input
          type="range"
          min={WHITEBOARD_MIN_ZOOM}
          max={WHITEBOARD_MAX_ZOOM}
          step="0.05"
          value={props.zoom}
          onChange={(event) => props.setZoom(Number(event.target.value))}
        />
        <strong>{Math.round(props.zoom * 100)}%</strong>
      </label>
      <button type="button" className="secondary-button" disabled={props.disabled} onClick={props.onAvoidOverlap}>
        <PanelRight size={15} />
        {t('layout.avoidOverlap')}
      </button>

      {dialogue ? (
        <div className="edit-form compact">
          <div className="two-col">
            <NumberField label={t('layout.x')} value={dialogue.x} min={0} max={1} step={0.01} onCommit={(x) => props.onCommit(dialogue.id, { x })} />
            <NumberField label={t('layout.y')} value={dialogue.y} min={0} max={1} step={0.01} onCommit={(y) => props.onCommit(dialogue.id, { y })} />
          </div>
          <div className="two-col">
            <NumberField label={t('layout.scale')} value={dialogue.scale} min={0.5} max={2.5} step={0.05} onCommit={(scale) => props.onCommit(dialogue.id, { scale })} />
            <NumberField label={t('layout.rotation')} value={dialogue.rotation} min={-45} max={45} step={1} onCommit={(rotation) => props.onCommit(dialogue.id, { rotation })} />
          </div>
        </div>
      ) : null}
    </div>
  )
}

function NumberField(props: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onCommit: (value: number) => void
}) {
  return (
    <label>
      {props.label}
      <input
        key={props.value}
        type="number"
        min={props.min}
        max={props.max}
        step={props.step}
        defaultValue={Number(props.value.toFixed(3))}
        onBlur={(event) => props.onCommit(clampNumber(Number(event.target.value), props.min, props.max))}
      />
    </label>
  )
}
