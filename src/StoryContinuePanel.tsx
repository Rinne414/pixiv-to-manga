import { useMemo, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { ImagePlus, Loader2, Plus, Sparkles, Trash2, Upload } from 'lucide-react'
import type { ContinuationImage, ContinuationReference, ContinuationReferenceInput } from './shared/types'
import { CONTINUATION_LIMITS, GENERATION_METADATA_LIMITS } from './shared/schemas'
import * as api from './api'

type RunTask = (label: string, task: () => Promise<void>) => Promise<void>

export function StoryContinuePanel(props: {
  disabled: boolean
  runTask: RunTask
  onLog: (message: string, level?: 'info' | 'success' | 'error') => void
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [references, setReferences] = useState<ContinuationReference[]>([])
  const [selectedReferenceId, setSelectedReferenceId] = useState('')
  const [pixivUrl, setPixivUrl] = useState('')
  const [prompt, setPrompt] = useState('Continue the story from these references with the same character identity and mood.')
  const [r18Enabled, setR18Enabled] = useState(false)
  const [outputCount, setOutputCount] = useState(1)
  const [keepCharacterConsistency, setKeepCharacterConsistency] = useState(true)
  const [keepBackgroundConsistency, setKeepBackgroundConsistency] = useState(true)
  const [expandedPrompt, setExpandedPrompt] = useState('')
  const [images, setImages] = useState<ContinuationImage[]>([])
  const [loadingLabel, setLoadingLabel] = useState('')

  const selectedReference =
    references.find((reference) => reference.id === selectedReferenceId) || references[0]
  const tagDraft = selectedReference?.tags.join(', ') || ''

  const combinedTags = useMemo(
    () => Array.from(new Set(references.flatMap((reference) => reference.tags))).slice(0, 36),
    [references],
  )

  async function run(label: string, task: () => Promise<void>) {
    setLoadingLabel(label)
    await props.runTask(label, task)
    setLoadingLabel('')
  }

  async function handleLocalFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.currentTarget.files || [])
    event.currentTarget.value = ''
    if (!files.length) return

    await run('Inspecting continuation references', async () => {
      const result = await api.inspectContinuationLocal(files)
      acceptReferences(result.references)
      props.onLog(`${result.references.length} reference image(s) inspected.`, 'success')
    })
  }

  async function handlePixivImport(event: FormEvent) {
    event.preventDefault()
    if (!pixivUrl.trim()) {
      props.onLog('Pixiv artwork URL or ID is required.', 'error')
      return
    }

    await run('Importing continuation Pixiv references', async () => {
      const result = await api.inspectContinuationPixiv({
        url: pixivUrl.trim(),
        r18Enabled,
        maxPages: 4,
      })
      acceptReferences(result.references)
      setPixivUrl('')
      props.onLog(`${result.references.length} Pixiv reference image(s) inspected.`, 'success')
    })
  }

  async function handleGenerate(event: FormEvent) {
    event.preventDefault()
    await run('Generating continuation image', async () => {
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
      props.onLog(result.usedMock ? 'Continuation generated with local mock engine.' : 'Continuation image generated.', 'success')
    })
  }

  function acceptReferences(nextReferences: ContinuationReference[]) {
    const capacity = CONTINUATION_LIMITS.maxReferences - references.length
    if (capacity <= 0) {
      props.onLog(`Reference limit is ${CONTINUATION_LIMITS.maxReferences} images. Remove one before adding more.`, 'error')
      return
    }
    if (nextReferences.length > capacity) {
      props.onLog(
        `Reference limit is ${CONTINUATION_LIMITS.maxReferences} images; ${nextReferences.length - capacity} image(s) were skipped.`,
        'error',
      )
    }
    const accepted = nextReferences.slice(0, capacity)
    setReferences((current) => [...current, ...accepted].slice(0, CONTINUATION_LIMITS.maxReferences))
    setSelectedReferenceId((current) => current || accepted[0]?.id || '')
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

  const busy = props.disabled || Boolean(loadingLabel)
  const referencesFull = references.length >= CONTINUATION_LIMITS.maxReferences

  return (
    <main className="continue-workspace">
      <input
        ref={fileInputRef}
        className="hidden-input"
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml"
        multiple
        aria-label="Continuation local images"
        data-testid="continuation-local-input"
        onChange={handleLocalFiles}
      />

      <section className="continue-references panel">
        <div className="section-heading">
          <div>
            <strong>References</strong>
            <span>{references.length}/{CONTINUATION_LIMITS.maxReferences} images / {combinedTags.length} tags</span>
          </div>
          <button type="button" className="secondary-button" disabled={busy || referencesFull} onClick={() => fileInputRef.current?.click()}>
            <Upload size={15} />
            Upload
          </button>
        </div>

        <form className="pixiv-form" onSubmit={handlePixivImport}>
          <label>
            Pixiv Artwork URL / ID
            <input value={pixivUrl} onChange={(event) => setPixivUrl(event.target.value)} placeholder="https://www.pixiv.net/artworks/..." />
          </label>
          <button type="submit" className="secondary-button" disabled={busy || referencesFull}>
            {loadingLabel === 'Importing continuation Pixiv references' ? <Loader2 size={15} /> : <ImagePlus size={15} />}
            Import Pixiv
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
          {!references.length ? <p className="empty-text">No references yet.</p> : null}
        </div>
      </section>

      <section className="continue-output">
        {images.length ? (
          <div className="generated-grid" data-testid="continuation-output">
            {images.map((image) => (
              <figure key={image.id} className="generated-frame">
                {image.dataUrl ? <img src={image.dataUrl} alt="Generated continuation" /> : <img src={image.url} alt="Generated continuation" />}
                <figcaption>{image.usedMock ? 'Local draft' : 'Generated'}</figcaption>
              </figure>
            ))}
          </div>
        ) : (
          <div className="continue-empty-state">
            <Sparkles size={22} />
            <span>Story Continue</span>
          </div>
        )}
      </section>

      <aside className="continue-controls panel">
        <form className="inspector-body" onSubmit={handleGenerate}>
          <div className="section-heading">
            <div>
              <strong>Continue Story</strong>
              <span>{busy ? loadingLabel : 'Ready'}</span>
            </div>
            <button type="submit" className="primary-button" disabled={busy || !prompt.trim()}>
              {loadingLabel === 'Generating continuation image' ? <Loader2 size={15} /> : <Sparkles size={15} />}
              Generate
            </button>
          </div>

          <label className="field-block">
            Prompt
            <textarea value={prompt} rows={7} onChange={(event) => setPrompt(event.target.value)} data-testid="continuation-prompt" />
          </label>

          <div className="two-col">
            <label className="field-block">
              Outputs
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
              <span>R-18 enabled locally</span>
            </label>
          </div>

          <label className="toggle-row">
            <input
              type="checkbox"
              checked={keepCharacterConsistency}
              onChange={(event) => setKeepCharacterConsistency(event.target.checked)}
            />
            <span>Character consistency</span>
          </label>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={keepBackgroundConsistency}
              onChange={(event) => setKeepBackgroundConsistency(event.target.checked)}
            />
            <span>Background consistency</span>
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
                  Remove
                </button>
              </div>
              <label className="field-block">
                Tags
                <textarea value={tagDraft} rows={5} onChange={(event) => updateSelectedTags(event.target.value)} />
              </label>
              {selectedReference.metadata.positivePrompt ? (
                <label className="field-block">
                  Extracted prompt
                  <textarea readOnly value={selectedReference.metadata.positivePrompt} rows={5} />
                </label>
              ) : null}
            </section>
          ) : (
            <button type="button" className="secondary-button" disabled={busy} onClick={() => fileInputRef.current?.click()}>
              <Plus size={15} />
              Add reference
            </button>
          )}

          {expandedPrompt ? (
            <details className="expanded-prompt">
              <summary>Expanded prompt</summary>
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
