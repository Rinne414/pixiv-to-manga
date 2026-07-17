import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  FlaskConical,
  HardDrive,
  KeyRound,
  Loader2,
  Radar,
  Save,
  ShieldAlert,
  Trash2,
  XCircle,
} from 'lucide-react'
import type {
  DiscoveredModel,
  ModelCapability,
  ModelCapabilityFlags,
  ProviderProfile,
  ProviderTestInput,
  ProviderTestResponse,
} from './api'
import type { ActiveEngineInfo, SecretStatus } from './shared/types'
import * as api from './api'
import { useI18n } from './i18n/context'
import type { MessageKey } from './i18n/messages'

// Read-only capability flags: backend auto-detects these via discovery/test.
const detectedCapabilityKeys = [
  'supportsVision',
  'supportsImageGeneration',
  'supportsStreaming',
  'supportsJsonSchema',
] as const

// NSFW flags: never auto-detected — user must explicitly confirm (safety invariant).
const nsfwCapabilityKeys = ['allowsAdultInput', 'allowsAdultGeneration'] as const

const capabilityLabelKeys: Record<keyof ModelCapabilityFlags, MessageKey> = {
  supportsVision: 'providerLab.capVision',
  supportsImageGeneration: 'providerLab.capImageGeneration',
  supportsStreaming: 'providerLab.capStreaming',
  supportsJsonSchema: 'providerLab.capJsonSchema',
  allowsAdultInput: 'providerLab.capAdultInput',
  allowsAdultGeneration: 'providerLab.capAdultGeneration',
}

const testKindLabelKeys: Record<keyof ProviderTestInput['tests'], MessageKey> = {
  text: 'providerLab.testText',
  vision: 'providerLab.testVision',
  json: 'providerLab.testJson',
  streaming: 'providerLab.testStreaming',
}

const capabilityStatusKeys: Partial<Record<string, MessageKey>> = {
  unknown: 'providerLab.statusUnknown',
  detected: 'providerLab.statusDetected',
  'user-confirmed': 'providerLab.statusUserConfirmed',
  unsupported: 'providerLab.statusUnsupported',
}

const defaultTests: ProviderTestInput['tests'] = {
  text: true,
  vision: false,
  json: false,
  streaming: false,
}

interface ProviderFormState {
  id?: string
  name: string
  baseUrl: string
  defaultModel: string
  isLocal: boolean
  apiKey: string
}

const emptyForm: ProviderFormState = {
  name: '',
  baseUrl: '',
  defaultModel: '',
  isLocal: false,
  apiKey: '',
}

export interface ProviderLabPanelProps {
  secretStatus: SecretStatus | null
  providers: ProviderProfile[]
  /** Pushes refreshed provider lists back up so useStudio (onboarding, settings) stays in sync. */
  onProvidersChanged: (providers: ProviderProfile[]) => void
}

export function ProviderLabPanel(props: ProviderLabPanelProps) {
  const { t } = useI18n()
  // Provider profiles live in useStudio (single source of truth); this panel only
  // reads props.providers and reports refreshed lists via onProvidersChanged.
  const { providers, onProvidersChanged } = props
  const [capabilities, setCapabilities] = useState<ModelCapability[]>([])
  const [models, setModels] = useState<DiscoveredModel[]>([])
  const [selectedProviderId, setSelectedProviderId] = useState('')
  const [selectedModelId, setSelectedModelId] = useState('')
  const [form, setForm] = useState<ProviderFormState>(emptyForm)
  const [nsfwDraft, setNsfwDraft] = useState<{ allowsAdultInput: boolean; allowsAdultGeneration: boolean }>({
    allowsAdultInput: false,
    allowsAdultGeneration: false,
  })
  const [tests, setTests] = useState<ProviderTestInput['tests']>(defaultTests)
  const [testResult, setTestResult] = useState<ProviderTestResponse | null>(null)
  const [activeEngine, setActiveEngine] = useState<ActiveEngineInfo | null>(null)
  const [loading, setLoading] = useState('')
  const [error, setError] = useState('')

  // The backend owns route resolution (GET /api/ai/active-target); refetch whenever
  // the inputs that can change it move — provider list mutations arrive as a new
  // props.providers array, global settings as a new secretStatus object.
  useEffect(() => {
    let cancelled = false
    api
      .getActiveAiTarget()
      .then((target) => {
        if (!cancelled) setActiveEngine(target)
      })
      .catch(() => {
        if (!cancelled) setActiveEngine(null)
      })
    return () => {
      cancelled = true
    }
  }, [props.secretStatus, providers])

  const selectedProvider = providers.find((provider) => provider.id === selectedProviderId)
  const selectedCapability = capabilities.find(
    (capability) => capability.providerId === selectedProviderId && capability.modelId === selectedModelId,
  )

  function capabilityStatusLabel(status: DiscoveredModel['capabilityStatus']): string {
    const resolved = status || 'unknown'
    const key = capabilityStatusKeys[resolved]
    return key ? t(key) : resolved
  }

  const modelsForMatrix = useMemo(() => {
    const capabilityModels = capabilities
      .filter((capability) => capability.providerId === selectedProviderId)
      .map((capability) => ({
        id: capability.modelId,
        capabilityStatus: capabilityStatusForSource(capability.source),
      }))
    const merged = new Map<string, DiscoveredModel>()
    for (const model of capabilityModels) {
      merged.set(model.id, model as DiscoveredModel)
    }
    for (const model of models) {
      merged.set(model.id, { ...merged.get(model.id), ...model })
    }
    if (selectedProvider?.defaultModel && !merged.has(selectedProvider.defaultModel)) {
      merged.set(selectedProvider.defaultModel, { id: selectedProvider.defaultModel, capabilityStatus: 'unknown' })
    }
    return Array.from(merged.values())
  }, [capabilities, models, selectedProvider, selectedProviderId])

  useEffect(() => {
    let cancelled = false

    async function loadProviderLab() {
      setLoading(t('providerLab.loadingLab'))
      setError('')
      try {
        const [providerList, capabilityList] = await Promise.all([api.listProviders(), api.listModelCapabilities()])
        if (cancelled) return
        onProvidersChanged(providerList)
        setCapabilities(capabilityList)
        const provider = providerList[0]
        setSelectedProviderId(provider?.id || '')
        setSelectedModelId(provider?.defaultModel || '')
        setForm(provider ? providerToForm(provider) : emptyForm)
        setNsfwDraft(provider ? nsfwFlagsFor(capabilityList, provider.id, provider.defaultModel) : { allowsAdultInput: false, allowsAdultGeneration: false })
      } catch (nextError) {
        if (!cancelled) setError(errorMessage(nextError, t('providerLab.unknownError')))
      } finally {
        if (!cancelled) setLoading('')
      }
    }

    void loadProviderLab()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial load runs once on mount; onProvidersChanged is a stable setState
  }, [])

  async function refresh() {
    await run(t('providerLab.loadingLab'), async () => {
      const [providerList, capabilityList] = await Promise.all([api.listProviders(), api.listModelCapabilities()])
      acceptProviderLabData(providerList, capabilityList)
    })
  }

  function acceptProviderLabData(providerList: ProviderProfile[], capabilityList: ModelCapability[]) {
    onProvidersChanged(providerList)
    setCapabilities(capabilityList)
    const provider = providerList.find((item) => item.id === selectedProviderId) || providerList[0]
    if (!provider) {
      setSelectedProviderId('')
      setSelectedModelId('')
      setForm(emptyForm)
      setNsfwDraft({ allowsAdultInput: false, allowsAdultGeneration: false })
      return
    }
    selectProvider(provider, capabilityList)
  }

  function selectProvider(provider: ProviderProfile, capabilityList = capabilities) {
    const modelId = provider.defaultModel
    setSelectedProviderId(provider.id)
    setSelectedModelId(modelId)
    setForm(providerToForm(provider))
    setNsfwDraft(nsfwFlagsFor(capabilityList, provider.id, modelId))
  }

  function selectModel(modelId: string) {
    setSelectedModelId(modelId)
    setNsfwDraft(nsfwFlagsFor(capabilities, selectedProviderId, modelId))
  }

  function selectModelWithCapabilities(modelId: string, capabilityList: ModelCapability[]) {
    setSelectedModelId(modelId)
    setNsfwDraft(nsfwFlagsFor(capabilityList, selectedProviderId, modelId))
  }

  async function run(label: string, task: () => Promise<void>) {
    setLoading(label)
    setError('')
    try {
      await task()
    } catch (nextError) {
      setError(errorMessage(nextError, t('providerLab.unknownError')))
    } finally {
      setLoading('')
    }
  }

  async function saveProvider(event: FormEvent) {
    event.preventDefault()
    await run(form.id ? t('providerLab.updatingProvider') : t('providerLab.creatingProvider'), async () => {
      const payload = {
        name: form.name.trim(),
        baseUrl: form.baseUrl.trim(),
        defaultModel: form.defaultModel.trim(),
        isLocal: form.isLocal,
        apiKey: form.apiKey.trim() || undefined,
      }
      if (!payload.name || !payload.baseUrl || !payload.defaultModel) {
        throw new Error(t('providerLab.errorRequiredFields'))
      }

      const saved = form.id ? await api.updateProvider(form.id, payload) : await api.createProvider(payload)
      // Refresh the shared list so the provider rows and active-engine card reflect the change.
      const [providerList, capabilityList] = await Promise.all([api.listProviders(), api.listModelCapabilities()])
      onProvidersChanged(providerList)
      setCapabilities(capabilityList)
      selectProvider(saved, capabilityList)
    })
  }

  async function deleteSelectedProvider() {
    if (!selectedProvider) return
    await run(t('providerLab.deletingProvider'), async () => {
      await api.deleteProvider(selectedProvider.id)
      setCapabilities((current) => current.filter((capability) => capability.providerId !== selectedProvider.id))
      setModels([])
      setSelectedProviderId('')
      setSelectedModelId('')
      setTestResult(null)
      await refresh()
    })
  }

  async function discoverModels() {
    if (!selectedProvider) return
    await run(t('providerLab.discoveringModels'), async () => {
      const discovered = await api.discoverProviderModels(selectedProvider.id)
      const capabilityList = await api.listModelCapabilities()
      setModels(discovered)
      setCapabilities(capabilityList)
      const modelId = discovered[0]?.id || selectedModelId || selectedProvider.defaultModel
      selectModelWithCapabilities(modelId, capabilityList)
    })
  }

  /** NSFW flags are the only user-editable capabilities; they reuse the existing capability record. */
  async function saveNsfwFlags() {
    if (!selectedCapability) {
      return
    }
    await run(t('providerLab.savingCapabilities'), async () => {
      // Preserve the auto-detected flags; only the NSFW toggles are user input.
      const saved = await api.updateModelCapability(selectedCapability.id, {
        supportsVision: selectedCapability.supportsVision,
        supportsImageGeneration: selectedCapability.supportsImageGeneration,
        supportsStreaming: selectedCapability.supportsStreaming,
        supportsJsonSchema: selectedCapability.supportsJsonSchema,
        allowsAdultInput: nsfwDraft.allowsAdultInput,
        allowsAdultGeneration: nsfwDraft.allowsAdultGeneration,
      })
      setCapabilities((current) => current.map((capability) => (capability.id === saved.id ? saved : capability)))
    })
  }

  async function runTest() {
    if (!selectedProvider || !selectedModelId) return
    await run(t('providerLab.testingProvider'), async () => {
      const result = await api.testProvider(selectedProvider.id, { modelId: selectedModelId, tests })
      const capabilityList = await api.listModelCapabilities()
      setTestResult(result)
      setCapabilities(capabilityList)
      setNsfwDraft(nsfwFlagsFor(capabilityList, selectedProvider.id, selectedModelId))
    })
  }

  return (
    <section className="provider-lab">
      <div className="section-heading">
        <div>
          <strong>{t('providerLab.title')}</strong>
          <span>{t('providerLab.subtitle')}</span>
        </div>
        <button type="button" className="secondary-button" disabled={Boolean(loading)} onClick={refresh}>
          {loading === t('providerLab.loadingLab') ? <Loader2 size={15} /> : <Radar size={15} />}
          {t('providerLab.refresh')}
        </button>
      </div>

      <ActiveEngineCard engine={activeEngine} />

      {error ? (
        <div className="inline-alert">
          <ShieldAlert size={15} />
          <span>{error}</span>
        </div>
      ) : null}

      <div className="provider-grid">
        <div className="provider-list">
          <div className="panel-heading">{t('providerLab.providers')}</div>
          {providers.length ? (
            providers.map((provider) => (
              <button
                key={provider.id}
                type="button"
                className={`provider-row ${provider.id === selectedProviderId ? 'active' : ''} ${provider.id === activeEngine?.providerId ? 'is-active-engine' : ''}`}
                onClick={() => selectProvider(provider)}
              >
                <strong>{provider.name}</strong>
                <span>{provider.defaultModel}</span>
                <small>
                  {t('providerLab.providerRowMeta', {
                    kind: provider.isLocal ? t('providerLab.kindLocal') : t('providerLab.kindExternal'),
                    keyState: provider.hasApiKey ? t('providerLab.keySaved') : t('providerLab.noKey'),
                  })}
                </small>
              </button>
            ))
          ) : (
            <p className="empty-text">{t('providerLab.emptyProviders')}</p>
          )}
        </div>

        <form className="provider-form" onSubmit={saveProvider}>
          <div className="panel-heading">{form.id ? t('providerLab.editProvider') : t('providerLab.createProvider')}</div>
          <label>
            {t('providerLab.name')}
            <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder={t('providerLab.namePlaceholder')} />
          </label>
          <label>
            {t('providerLab.baseUrl')}
            <input value={form.baseUrl} onChange={(event) => setForm({ ...form, baseUrl: event.target.value })} placeholder={t('providerLab.baseUrlPlaceholder')} />
          </label>
          <label>
            {t('providerLab.defaultModel')}
            <input value={form.defaultModel} onChange={(event) => setForm({ ...form, defaultModel: event.target.value })} placeholder={t('providerLab.defaultModelPlaceholder')} />
          </label>
          <label>
            {t('providerLab.apiKey')}
            <input
              type="password"
              value={form.apiKey}
              onChange={(event) => setForm({ ...form, apiKey: event.target.value })}
              placeholder={selectedProvider?.hasApiKey ? t('providerLab.apiKeyPlaceholderSaved') : t('providerLab.apiKeyPlaceholderNew')}
              autoComplete="off"
            />
          </label>
          <label className="toggle-row">
            <input type="checkbox" checked={form.isLocal} onChange={(event) => setForm({ ...form, isLocal: event.target.checked })} />
            <span>{t('providerLab.localProvider')}</span>
          </label>
          <span className="field-hint">{t('providerLab.localKeyHint')}</span>
          <div className="provider-actions">
            <button type="submit" className="primary-button" disabled={Boolean(loading)}>
              <Save size={15} />
              {t('providerLab.save')}
            </button>
            <button type="button" className="secondary-button" onClick={() => setForm(emptyForm)}>
              {t('providerLab.new')}
            </button>
            <button type="button" className="secondary-button danger-button" disabled={!selectedProvider || Boolean(loading)} onClick={deleteSelectedProvider}>
              <Trash2 size={15} />
              {t('providerLab.delete')}
            </button>
          </div>
        </form>
      </div>

      <div className="provider-section">
        <div className="section-heading compact-heading">
          <div>
            <strong>{t('providerLab.modelDiscovery')}</strong>
            <span>{t('providerLab.modelDiscoverySubtitle')}</span>
          </div>
          <button type="button" className="secondary-button" disabled={!selectedProvider || Boolean(loading)} onClick={discoverModels}>
            {loading === t('providerLab.discoveringModels') ? <Loader2 size={15} /> : <Radar size={15} />}
            {t('providerLab.discover')}
          </button>
        </div>
        <div className="model-list">
          {modelsForMatrix.length ? (
            modelsForMatrix.map((model) => (
              <button
                key={model.id}
                type="button"
                className={`model-row ${model.id === selectedModelId ? 'active' : ''}`}
                onClick={() => selectModel(model.id)}
              >
                <strong>{model.name || model.id}</strong>
                <span>{capabilityStatusLabel(model.capabilityStatus)}</span>
              </button>
            ))
          ) : (
            <p className="empty-text compact-empty">{t('providerLab.emptyModels')}</p>
          )}
        </div>
      </div>

      {selectedCapability ? (
        <div className="provider-section capability-readout">
          <div className="section-heading compact-heading">
            <div>
              <strong>{t('providerLab.capabilitiesDetected')}</strong>
              <span>{t('providerLab.capabilitiesHint')}</span>
            </div>
          </div>
          <div className="capability-badges">
            {detectedCapabilityKeys.map((key) => (
              <span key={key} className={`cap-badge ${selectedCapability[key] ? 'on' : 'off'}`}>
                {selectedCapability[key] ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
                {t(capabilityLabelKeys[key])}
              </span>
            ))}
          </div>

          <div className="nsfw-controls">
            <div className="panel-heading">
              <ShieldAlert size={14} />
              {t('providerLab.nsfwSection')}
            </div>
            <span className="field-hint">{t('providerLab.nsfwHint')}</span>
            <div className="capability-matrix">
              {nsfwCapabilityKeys.map((key) => (
                <label key={key} className="capability-cell">
                  <input
                    type="checkbox"
                    checked={nsfwDraft[key]}
                    onChange={(event) => setNsfwDraft({ ...nsfwDraft, [key]: event.target.checked })}
                  />
                  <span>{t(capabilityLabelKeys[key])}</span>
                </label>
              ))}
            </div>
            <button type="button" className="secondary-button" disabled={Boolean(loading)} onClick={saveNsfwFlags}>
              <Save size={15} />
              {t('providerLab.saveFlags')}
            </button>
          </div>
        </div>
      ) : null}

      <div className="provider-section">
        <div className="section-heading compact-heading">
          <div>
            <strong>{t('providerLab.testControls')}</strong>
            <span>{t('providerLab.testControlsSubtitle')}</span>
          </div>
          <button type="button" className="primary-button" disabled={!selectedProvider || !selectedModelId || Boolean(loading)} onClick={runTest}>
            {loading === t('providerLab.testingProvider') ? <Loader2 size={15} /> : <FlaskConical size={15} />}
            {t('providerLab.runTest')}
          </button>
        </div>
        <div className="test-toggle-grid">
          {(['text', 'vision', 'json', 'streaming'] as const).map((key) => (
            <label key={key} className="toggle-row">
              <input type="checkbox" checked={tests[key]} onChange={(event) => setTests({ ...tests, [key]: event.target.checked })} />
              <span>{t(testKindLabelKeys[key])}</span>
            </label>
          ))}
        </div>
        {testResult ? <ProviderTestReadout result={testResult} /> : <p className="empty-text compact-empty">{t('providerLab.emptyTestResult')}</p>}
      </div>
    </section>
  )
}

function ActiveEngineCard({ engine }: { engine: ActiveEngineInfo | null }) {
  const { t } = useI18n()

  if (!engine) {
    return (
      <div className="active-engine-card none" data-testid="active-engine-card">
        <AlertTriangle size={18} />
        <div className="active-engine-body">
          <span className="active-engine-caption">{t('providerLab.activeEngine')}</span>
          <strong>{t('providerLab.activeEngineNone')}</strong>
          <span>{t('providerLab.activeEngineNoneHint')}</span>
        </div>
      </div>
    )
  }

  const name = engine.providerName || engine.apiBaseUrl
  const Icon = engine.isLocal ? HardDrive : Cloud

  return (
    <div className="active-engine-card" data-testid="active-engine-card">
      <div className={`engine-badge ${engine.isLocal ? 'local' : 'cloud'}`}>
        <Icon size={13} />
        {engine.isLocal ? t('providerLab.badgeLocal') : t('providerLab.badgeCloud')}
      </div>
      <div className="active-engine-body">
        <span className="active-engine-caption">{t('providerLab.activeEngine')}</span>
        <strong>{name}</strong>
        <span className="active-engine-model">{engine.modelName}</span>
        <span className="active-engine-sub">
          {engine.source === 'global' && !engine.providerId ? t('providerLab.viaGlobal') : engine.apiBaseUrl}
          {!engine.hasApiKey && !engine.isLocal ? ` · ${t('providerLab.badgeNoKey')}` : ''}
        </span>
      </div>
    </div>
  )
}

function ProviderTestReadout({ result }: { result: ProviderTestResponse }) {
  const { t } = useI18n()
  return (
    <div className="test-readout">
      <div className={`test-summary ${result.passed ? 'passed' : 'failed'}`}>
        {result.passed ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
        <strong>{result.passed ? t('providerLab.pass') : t('providerLab.fail')}</strong>
        <span>{t('providerLab.latency', { ms: result.latencyMs })}</span>
      </div>
      <div className="test-result-grid">
        {result.results.map((item) => (
          <div key={item.kind} className={item.passed ? 'passed' : 'failed'}>
            <strong>{t(testKindLabelKeys[item.kind])}</strong>
            <span>{item.message || (item.passed ? t('providerLab.resultPassed') : t('providerLab.resultFailed'))}</span>
          </div>
        ))}
      </div>
      <div className="trace-box">
        <div className="panel-heading">
          <KeyRound size={14} />
          {t('providerLab.redactedTrace')}
        </div>
        {result.redactedTrace.length ? (
          result.redactedTrace.map((line) => <code key={line}>{line}</code>)
        ) : (
          <span>{t('providerLab.noTrace')}</span>
        )}
      </div>
    </div>
  )
}

function nsfwFlagsFor(
  capabilities: ModelCapability[],
  providerId: string,
  modelId: string,
): { allowsAdultInput: boolean; allowsAdultGeneration: boolean } {
  const capability = capabilities.find((item) => item.providerId === providerId && item.modelId === modelId)
  return {
    allowsAdultInput: capability?.allowsAdultInput ?? false,
    allowsAdultGeneration: capability?.allowsAdultGeneration ?? false,
  }
}

function providerToForm(provider: ProviderProfile): ProviderFormState {
  return {
    id: provider.id,
    name: provider.name,
    baseUrl: provider.baseUrl,
    defaultModel: provider.defaultModel,
    isLocal: provider.isLocal,
    apiKey: '',
  }
}

function capabilityStatusForSource(source: ModelCapability['source']): DiscoveredModel['capabilityStatus'] {
  if (source === 'user') return 'user-confirmed'
  if (source === 'discovered' || source === 'tested') return 'detected'
  return 'unknown'
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}
