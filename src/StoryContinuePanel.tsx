import { useMemo, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { ImagePlus, Loader2, Plus, Sparkles, Trash2, Upload } from 'lucide-react'
import type { ContinuationImage, ContinuationReference, ContinuationReferenceInput } from './shared/types'
import { CONTINUATION_LIMITS, GENERATION_METADATA_LIMITS } from './shared/schemas'
import { useI18n } from './i18n/context'
import * as api from './api'

type RunTask = (label: string, task: () => Promise<void>) => Promise<void>

export function StoryContinuePanel(props: {
  disabled: boolean
  busyLabel: string
  runTask: RunTask
  onLog: (message: string, level?: 'info' | 'success' | 'error') => void
}) {
  const { t } = useI18n()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [references, setReferences] = useState<ContinuationReference[]>([])
  const [selectedReferenceId, setSelectedReferenceId] = useState('')
  const [pixivUrl, setPixivUrl] = useState('')
  const [prompt, setPrompt] = useState(() => t('continue.defaultPrompt'))
  const [r18Enabled, setR18Enabled] = useState(false)
  const [outputCount, setOutputCount] = useState(1)
  const [keepCharacterConsistency, setKeepCharacterConsistency] = useState(true)
  const [keepBackgroundConsistency, setKeepBackgroundConsistency] = useState(true)
  const [expandedPrompt, setExpandedPrompt] = useState('')
  const [images, setImages] = useState<ContinuationImage[]>([])

  const selectedReference =
    references.find((reference) => reference.id === selectedReferenceId) || references[0]
  const tagDraft = selectedReference?.tags.join(', ') || ''

  const combinedTags = useMemo(
    () => Array.from(new Set(references.flatMap((reference) => reference.tags))).slice(0, 36),
    [references],
  )

  async function handleLocalFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.currentTarget.files || [])
    event.currentTarget.value = ''
    if (!files.length) return

    await props.runTask(t('continue.inspectingRefs'), async () => {
      const result = await api.inspectContinuationLocal(files)
      acceptReferences(result.references)
      props.onLog(t('continue.refsInspected', { count: result.references.length }), 'success')
    })
  }

  async function handlePixivImport(event: FormEvent) {
    event.preventDefault()
    if (!pixivUrl.trim()) {
      props.onLog(t('log.pixivUrlRequired'), 'error')
      return
    }

    await props.runTask(t('continue.importingPixivRefs'), async () => {
      const result = await api.inspectContinuationPixiv({
        url: pixivUrl.trim(),
        r18Enabled,
        maxPages: 4,
      })
      acceptReferences(result.references)
      setPixivUrl('')
      props.onLog(t('continue.pixivRefsInspected', { count: result.references.length }), 'success')
    })
  }

  async function handleGenerate(event: FormEvent) {
    event.preventDefault()
    await props.runTask(t('continue.generatingImage'), async () => {
      const result = await api.generateContinuation({
        prompt,
        r18Enabled,
        outputCount,
        keepCharacterConsistency,
        keepBackgroundConsistency,
        // Preview images stay client-side; the server only needs tags and metadata.
        references: references.map(toReferenceInput),
      })
      setImages(result.images)
      setExpandedPrompt(result.expandedPrompt)
      props.onLog(result.usedMock ? t('continue.generatedMock') : t('continue.generated'), 'success')
    })
  }

  function acceptReferences(nextReferences: ContinuationReference[]) {
    const capacity = CONTINUATION_LIMITS.maxReferences - references.length
    if (capacity <= 0) {
      props.onLog(t('continue.limitReached', { max: CONTINUATION_LIMITS.maxReferences }), 'error')
      return
    }
    if (nextReferences.length > capacity) {
      props.onLog(
        t('continue.limitSkipped', {
          max: CONTINUATION_LIMITS.maxReferences,
          skipped: nextReferences.length - capacity,
        }),
        'error',
      )
    }
    const accepted = nextReferences.slice(0, capacity)
    setReferences((current) => [...current, ...accepted].slice(0, CONTINUATION_LIMITS.maxReferences))
    setSelectedReferenceId((current) => current || accepted[0]?.id || '')
    // Inspect responses carry full-resolution previews; swap in thumbnails in the background.
    void shrinkAcceptedPreviews(accepted)
  }

  async function shrinkAcceptedPreviews(accepted: ContinuationReference[]) {
    for (const reference of accepted) {
      const preview = await downscalePreview(reference.previewDataUrl, reference.mimeType)
      if (preview !== reference.previewDataUrl) {
        setReferences((current) =>
          current.map((item) => (item.id === reference.id ? { ...item, previewDataUrl: preview } : item)),
        )
      }
    }
  }

  function updateSelectedTags(value: string) {
    if (!selectedReference) return
    const tags = value
      .split(',')
      .map((tag) => tag.trim().slice(0, GENERATION_METADATA_LIMITS.maxTagLength))
      .filter(Boolean)
      .slice(0, 80)
    setReferences((current) =>
      current.map((reference) => (reference.id === selectedReference.id ? { ...reference, tags } : reference)),
    )
  }

  function removeReference(id: string) {
    setReferences((current) => current.filter((reference) => reference.id !== id))
    setSelectedReferenceId((current) => (current === id ? '' : current))
  }

  const busy = props.disabled
  const referencesFull = references.length >= CONTINUATION_LIMITS.maxReferences

  return (
    <main className="continue-workspace">
      <input
        ref={fileInputRef}
        className="hidden-input"
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml"
        multiple
        aria-label={t('continue.localImagesAria')}
        data-testid="continuation-local-input"
        onChange={handleLocalFiles}
      />

      <section className="continue-references panel">
        <div className="section-heading">
          <div>
            <strong>{t('continue.references')}</strong>
            <span>
              {t('continue.referencesSummary', {
                count: references.length,
                max: CONTINUATION_LIMITS.maxReferences,
                tags: combinedTags.length,
              })}
            </span>
          </div>
          <button type="button" className="secondary-button" disabled={busy || referencesFull} onClick={() => fileInputRef.current?.click()}>
            <Upload size={15} />
            {t('continue.upload')}
          </button>
        </div>

        <form className="pixiv-form" onSubmit={handlePixivImport}>
          <label>
            {t('story.pixivUrlLabel')}
            <input value={pixivUrl} onChange={(event) => setPixivUrl(event.target.value)} placeholder={t('story.pixivPlaceholder')} />
          </label>
          <button type="submit" className="secondary-button" disabled={busy || referencesFull}>
            {props.busyLabel === t('continue.importingPixivRefs') ? <Loader2 size={15} /> : <ImagePlus size={15} />}
            {t('toolbar.importPixiv')}
          </button>
        </form>

        <div className="reference-list">
          {references.map((reference) => (
            <button
              key={reference.id}
              type="button"
              className={`reference-row ${reference.id === selectedReference?.id ? 'active' : ''}`}
              data-testid="continuation-reference-row"
              onClick={() => setSelectedReferenceId(reference.id)}
            >
              <img src={reference.previewDataUrl} alt="" />
              <span>
                <strong>{reference.fileName}</strong>
                <small>{reference.width}x{reference.height} / {reference.metadata.format}</small>
              </span>
            </button>
          ))}
          {!references.length ? <p className="empty-text">{t('continue.noReferences')}</p> : null}
        </div>
      </section>

      <section className="continue-output">
        {images.length ? (
          <div className="generated-grid" data-testid="continuation-output">
            {images.map((image) => (
              <figure key={image.id} className="generated-frame">
                {image.dataUrl ? <img src={image.dataUrl} alt={t('continue.generatedAlt')} /> : <img src={image.url} alt={t('continue.generatedAlt')} />}
                <figcaption>{image.usedMock ? t('continue.localDraft') : t('continue.generatedCaption')}</figcaption>
              </figure>
            ))}
          </div>
        ) : (
          <div className="continue-empty-state">
            <Sparkles size={22} />
            <span>{t('continue.storyContinue')}</span>
          </div>
        )}
      </section>

      <aside className="continue-controls panel">
        <form className="inspector-body" onSubmit={handleGenerate}>
          <div className="section-heading">
            <div>
              <strong>{t('continue.continueStory')}</strong>
              <span>{busy ? props.busyLabel : t('status.ready')}</span>
            </div>
            <button type="submit" className="primary-button" disabled={busy || !prompt.trim()}>
              {props.busyLabel === t('continue.generatingImage') ? <Loader2 size={15} /> : <Sparkles size={15} />}
              {t('continue.generate')}
            </button>
          </div>

          <label className="field-block">
            {t('continue.prompt')}
            <textarea value={prompt} rows={7} onChange={(event) => setPrompt(event.target.value)} data-testid="continuation-prompt" />
          </label>

          <div className="two-col">
            <label className="field-block">
              {t('continue.outputs')}
              <input
                type="number"
                min={1}
                max={4}
                value={outputCount}
                onChange={(event) => setOutputCount(clampInt(Number(event.target.value), 1, 4))}
              />
            </label>
            <label className="toggle-row danger continue-r18-toggle">
              <input type="checkbox" checked={r18Enabled} onChange={(event) => setR18Enabled(event.target.checked)} />
              <span>{t('story.r18Local')}</span>
            </label>
          </div>

          <label className="toggle-row">
            <input
              type="checkbox"
              checked={keepCharacterConsistency}
              onChange={(event) => setKeepCharacterConsistency(event.target.checked)}
            />
            <span>{t('continue.characterConsistency')}</span>
          </label>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={keepBackgroundConsistency}
              onChange={(event) => setKeepBackgroundConsistency(event.target.checked)}
            />
            <span>{t('continue.backgroundConsistency')}</span>
          </label>

          {selectedReference ? (
            <section className="metadata-editor">
              <div className="section-heading compact-heading">
                <div>
                  <strong>{selectedReference.fileName}</strong>
                  <span>{selectedReference.metadata.sourceFields.join(', ') || selectedReference.metadata.format}</span>
                </div>
                <button type="button" className="secondary-button danger-button" onClick={() => removeReference(selectedReference.id)}>
                  <Trash2 size={15} />
                  {t('continue.remove')}
                </button>
              </div>
              <label className="field-block">
                {t('continue.tags')}
                <textarea value={tagDraft} rows={5} onChange={(event) => updateSelectedTags(event.target.value)} />
              </label>
              {selectedReference.metadata.positivePrompt ? (
                <label className="field-block">
                  {t('continue.extractedPrompt')}
                  <textarea readOnly value={selectedReference.metadata.positivePrompt} rows={5} />
                </label>
              ) : null}
            </section>
          ) : (
            <button type="button" className="secondary-button" disabled={busy} onClick={() => fileInputRef.current?.click()}>
              <Plus size={15} />
              {t('continue.addReference')}
            </button>
          )}

          {expandedPrompt ? (
            <details className="expanded-prompt">
              <summary>{t('continue.expandedPrompt')}</summary>
              <textarea readOnly value={expandedPrompt} rows={8} data-testid="continuation-expanded-prompt" />
            </details>
          ) : null}
        </form>
      </aside>
    </main>
  )
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? Math.round(value) : min))
}

const PREVIEW_MAX_EDGE = 256

/** Downscales a full-resolution preview data URL to thumbnail size; falls back to the original on any failure. */
async function downscalePreview(dataUrl: string, mimeType: string): Promise<string> {
  // SVG previews are compact text and scale losslessly; skip rasterizing them.
  if (mimeType === 'image/svg+xml' || typeof document === 'undefined') {
    return dataUrl
  }
  try {
    const image = await loadImageElement(dataUrl)
    const longestEdge = Math.max(image.naturalWidth, image.naturalHeight)
    if (!longestEdge || longestEdge <= PREVIEW_MAX_EDGE) {
      return dataUrl
    }
    const scale = PREVIEW_MAX_EDGE / longestEdge
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    const context = canvas.getContext('2d')
    if (!context) {
      return dataUrl
    }
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/png')
  } catch {
    return dataUrl
  }
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Preview image failed to decode'))
    image.src = src
  })
}

function toReferenceInput(reference: ContinuationReference): ContinuationReferenceInput {
  return {
    id: reference.id,
    fileName: reference.fileName,
    mimeType: reference.mimeType,
    width: reference.width,
    height: reference.height,
    source: reference.source,
    sourceUrl: reference.sourceUrl,
    tags: reference.tags,
    metadata: reference.metadata,
  }
}
