import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { CheckCircle2, FlaskConical, KeyRound, Loader2, Radar, Save, ShieldAlert, Trash2, XCircle } from 'lucide-react'
import type {
  DiscoveredModel,
  ModelCapability,
  ModelCapabilityFlags,
  ProviderProfile,
  ProviderTestInput,
  ProviderTestResponse,
} from './api'
import * as api from './api'
import { useI18n } from './i18n/context'
import type { MessageKey } from './i18n/messages'

const capabilityKeys: Array<keyof ModelCapabilityFlags> = [
  'supportsVision',
  'supportsImageGeneration',
  'supportsStreaming',
  'supportsJsonSchema',
  'allowsAdultInput',
  'allowsAdultGeneration',
]

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

const emptyFlags: ModelCapabilityFlags = {
  supportsVision: false,
  supportsImageGeneration: false,
  supportsStreaming: false,
  supportsJsonSchema: false,
  allowsAdultInput: false,
  allowsAdultGeneration: false,
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

export function ProviderLabPanel() {
  const { t } = useI18n()
  const [providers, setProviders] = useState<ProviderProfile[]>([])
  const [capabilities, setCapabilities] = useState<ModelCapability[]>([])
  const [models, setModels] = useState<DiscoveredModel[]>([])
  const [selectedProviderId, setSelectedProviderId] = useState('')
  const [selectedModelId, setSelectedModelId] = useState('')
  const [form, setForm] = useState<ProviderFormState>(emptyForm)
  const [capabilityDraft, setCapabilityDraft] = useState<ModelCapabilityFlags>(emptyFlags)
  const [tests, setTests] = useState<ProviderTestInput['tests']>(defaultTests)
  const [testResult, setTestResult] = useState<ProviderTestResponse | null>(null)
  const [loading, setLoading] = useState('')
  const [error, setError] = useState('')

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
        const provider = providerList[0]
        setProviders(providerList)
        setCapabilities(capabilityList)
        setSelectedProviderId(provider?.id || '')
        setSelectedModelId(provider?.defaultModel || '')
        setForm(provider ? providerToForm(provider) : emptyForm)
        setCapabilityDraft(provider ? flagsFor(capabilityList, provider.id, provider.defaultModel) : emptyFlags)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial load runs once on mount
  }, [])

  async function refresh() {
    await run(t('providerLab.loadingLab'), async () => {
      const [providerList, capabilityList] = await Promise.all([api.listProviders(), api.listModelCapabilities()])
      acceptProviderLabData(providerList, capabilityList)
    })
  }

  function acceptProviderLabData(providerList: ProviderProfile[], capabilityList: ModelCapability[]) {
    setProviders(providerList)
    setCapabilities(capabilityList)
    const provider = providerList.find((item) => item.id === selectedProviderId) || providerList[0]
    if (!provider) {
      setSelectedProviderId('')
      setSelectedModelId('')
      setForm(emptyForm)
      setCapabilityDraft(emptyFlags)
      return
    }
    selectProvider(provider, capabilityList)
  }

  function selectProvider(provider: ProviderProfile, capabilityList = capabilities) {
    const modelId = provider.defaultModel
    setSelectedProviderId(provider.id)
    setSelectedModelId(modelId)
    setForm(providerToForm(provider))
    setCapabilityDraft(flagsFor(capabilityList, provider.id, modelId))
  }

  function selectModel(modelId: string) {
    setSelectedModelId(modelId)
    setCapabilityDraft(flagsFor(capabilities, selectedProviderId, modelId))
  }

  function selectModelWithCapabilities(modelId: string, capabilityList: ModelCapability[]) {
    setSelectedModelId(modelId)
    setCapabilityDraft(flagsFor(capabilityList, selectedProviderId, modelId))
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
      setProviders((current) =>
        current.some((provider) => provider.id === saved.id)
          ? current.map((provider) => (provider.id === saved.id ? saved : provider))
          : [saved, ...current],
      )
      selectProvider(saved)
    })
  }

  async function deleteSelectedProvider() {
    if (!selectedProvider) return
    await run(t('providerLab.deletingProvider'), async () => {
      await api.deleteProvider(selectedProvider.id)
      setProviders((current) => current.filter((provider) => provider.id !== selectedProvider.id))
      setCapabilities((current) => current.filter((capability) => capability.providerId !== selectedProvider.id))
      setModels([])
      setSelectedProviderId('')
      setSelectedModelId('')
      setTestResult(null)
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

  async function saveCapabilities() {
    if (!selectedCapability) {
      setError(t('providerLab.errorCapabilityRecord'))
      return
    }

    await run(t('providerLab.savingCapabilities'), async () => {
      const saved = await api.updateModelCapability(selectedCapability.id, capabilityDraft)
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
      setCapabilityDraft(flagsFor(capabilityList, selectedProvider.id, selectedModelId))
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
                className={`provider-row ${provider.id === selectedProviderId ? 'active' : ''}`}
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
            <p className="empty-text">{t('providerLab.emptyModels')}</p>
          )}
        </div>
      </div>

      <div className="provider-section">
        <div className="section-heading compact-heading">
          <div>
            <strong>{t('providerLab.capabilityMatrix')}</strong>
            <span>{selectedModelId || t('providerLab.noModelSelected')}</span>
          </div>
          <button type="button" className="secondary-button" disabled={!selectedCapability || Boolean(loading)} onClick={saveCapabilities}>
            <Save size={15} />
            {t('providerLab.saveFlags')}
          </button>
        </div>
        <div className="capability-matrix">
          {capabilityKeys.map((key) => (
            <label key={key} className="capability-cell">
              <input
                type="checkbox"
                checked={capabilityDraft[key]}
                onChange={(event) => setCapabilityDraft({ ...capabilityDraft, [key]: event.target.checked })}
              />
              <span>{t(capabilityLabelKeys[key])}</span>
            </label>
          ))}
        </div>
        <NsfwRouteHint provider={selectedProvider} flags={capabilityDraft} />
      </div>

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
        {testResult ? <ProviderTestReadout result={testResult} /> : <p className="empty-text">{t('providerLab.emptyTestResult')}</p>}
      </div>
    </section>
  )
}

function NsfwRouteHint({ provider, flags }: { provider?: ProviderProfile; flags: ModelCapabilityFlags }) {
  const { t } = useI18n()
  const hints: string[] = []
  if (!flags.supportsVision) {
    hints.push(t('providerLab.hintNoVision'))
  }
  if (!flags.supportsImageGeneration) {
    hints.push(t('providerLab.hintNoImageGeneration'))
  }
  if (!provider?.isLocal && !flags.allowsAdultInput) {
    hints.push(t('providerLab.hintNoAdultInput'))
  }
  if (!flags.allowsAdultGeneration) {
    hints.push(t('providerLab.hintNoAdultGeneration'))
  }
  if (!hints.length) {
    hints.push(t('providerLab.hintDefault'))
  }

  return (
    <div className="route-hint">
      <ShieldAlert size={15} />
      <span>{hints.join(' ')}</span>
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

function pickFlags(capability: ModelCapability): ModelCapabilityFlags {
  return {
    supportsVision: capability.supportsVision,
    supportsImageGeneration: capability.supportsImageGeneration,
    supportsStreaming: capability.supportsStreaming,
    supportsJsonSchema: capability.supportsJsonSchema,
    allowsAdultInput: capability.allowsAdultInput,
    allowsAdultGeneration: capability.allowsAdultGeneration,
  }
}

function flagsFor(capabilities: ModelCapability[], providerId: string, modelId: string): ModelCapabilityFlags {
  const capability = capabilities.find((item) => item.providerId === providerId && item.modelId === modelId)
  return capability ? pickFlags(capability) : emptyFlags
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
