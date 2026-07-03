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

const capabilityKeys: Array<keyof ModelCapabilityFlags> = [
  'supportsVision',
  'supportsImageGeneration',
  'supportsStreaming',
  'supportsJsonSchema',
  'allowsAdultInput',
  'allowsAdultGeneration',
]

const capabilityLabels: Record<keyof ModelCapabilityFlags, string> = {
  supportsVision: 'Vision',
  supportsImageGeneration: 'Image generation',
  supportsStreaming: 'Streaming',
  supportsJsonSchema: 'JSON Schema',
  allowsAdultInput: 'Adult input',
  allowsAdultGeneration: 'Adult generation',
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
      setLoading('Loading Provider Lab')
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
        if (!cancelled) setError(errorMessage(nextError))
      } finally {
        if (!cancelled) setLoading('')
      }
    }

    void loadProviderLab()
    return () => {
      cancelled = true
    }
  }, [])

  async function refresh() {
    await run('Loading Provider Lab', async () => {
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
      setError(errorMessage(nextError))
    } finally {
      setLoading('')
    }
  }

  async function saveProvider(event: FormEvent) {
    event.preventDefault()
    await run(form.id ? 'Updating provider' : 'Creating provider', async () => {
      const payload = {
        name: form.name.trim(),
        baseUrl: form.baseUrl.trim(),
        defaultModel: form.defaultModel.trim(),
        isLocal: form.isLocal,
        apiKey: form.apiKey.trim() || undefined,
      }
      if (!payload.name || !payload.baseUrl || !payload.defaultModel) {
        throw new Error('Provider name, base URL, and default model are required.')
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
    await run('Deleting provider', async () => {
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
    await run('Discovering models', async () => {
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
      setError('Capability save requires a backend capability record from discovery or test first.')
      return
    }

    await run('Saving capabilities', async () => {
      const saved = await api.updateModelCapability(selectedCapability.id, capabilityDraft)
      setCapabilities((current) => current.map((capability) => (capability.id === saved.id ? saved : capability)))
    })
  }

  async function runTest() {
    if (!selectedProvider || !selectedModelId) return
    await run('Testing provider', async () => {
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
          <strong>Provider Lab</strong>
          <span>Profiles, capability checks, and NSFW route signals.</span>
        </div>
        <button type="button" className="secondary-button" disabled={Boolean(loading)} onClick={refresh}>
          {loading === 'Loading Provider Lab' ? <Loader2 size={15} /> : <Radar size={15} />}
          Refresh
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
          <div className="panel-heading">Providers</div>
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
                <small>{provider.isLocal ? 'Local' : 'External'} / {provider.hasApiKey ? 'key saved' : 'no key'}</small>
              </button>
            ))
          ) : (
            <p className="empty-text">No provider profiles yet.</p>
          )}
        </div>

        <form className="provider-form" onSubmit={saveProvider}>
          <div className="panel-heading">{form.id ? 'Edit provider' : 'Create provider'}</div>
          <label>
            Name
            <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="OpenAI, LM Studio, OpenRouter..." />
          </label>
          <label>
            Base URL
            <input value={form.baseUrl} onChange={(event) => setForm({ ...form, baseUrl: event.target.value })} placeholder="https://api.openai.com/v1" />
          </label>
          <label>
            Default model
            <input value={form.defaultModel} onChange={(event) => setForm({ ...form, defaultModel: event.target.value })} placeholder="gpt-4.1-mini" />
          </label>
          <label>
            API key
            <input
              type="password"
              value={form.apiKey}
              onChange={(event) => setForm({ ...form, apiKey: event.target.value })}
              placeholder={selectedProvider?.hasApiKey ? 'Saved; enter a new key to replace' : 'Write-only key'}
              autoComplete="off"
            />
          </label>
          <label className="toggle-row">
            <input type="checkbox" checked={form.isLocal} onChange={(event) => setForm({ ...form, isLocal: event.target.checked })} />
            <span>Local provider</span>
          </label>
          <div className="provider-actions">
            <button type="submit" className="primary-button" disabled={Boolean(loading)}>
              <Save size={15} />
              Save
            </button>
            <button type="button" className="secondary-button" onClick={() => setForm(emptyForm)}>
              New
            </button>
            <button type="button" className="secondary-button danger-button" disabled={!selectedProvider || Boolean(loading)} onClick={deleteSelectedProvider}>
              <Trash2 size={15} />
              Delete
            </button>
          </div>
        </form>
      </div>

      <div className="provider-section">
        <div className="section-heading compact-heading">
          <div>
            <strong>Model Discovery</strong>
            <span>Capability status comes from backend discovery, tests, or user confirmation.</span>
          </div>
          <button type="button" className="secondary-button" disabled={!selectedProvider || Boolean(loading)} onClick={discoverModels}>
            {loading === 'Discovering models' ? <Loader2 size={15} /> : <Radar size={15} />}
            Discover
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
                <span>{model.capabilityStatus || 'unknown'}</span>
              </button>
            ))
          ) : (
            <p className="empty-text">Select a provider and run discovery when the backend endpoint is available.</p>
          )}
        </div>
      </div>

      <div className="provider-section">
        <div className="section-heading compact-heading">
          <div>
            <strong>Capability Matrix</strong>
            <span>{selectedModelId || 'No model selected'}</span>
          </div>
          <button type="button" className="secondary-button" disabled={!selectedCapability || Boolean(loading)} onClick={saveCapabilities}>
            <Save size={15} />
            Save flags
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
              <span>{capabilityLabels[key]}</span>
            </label>
          ))}
        </div>
        <NsfwRouteHint provider={selectedProvider} flags={capabilityDraft} />
      </div>

      <div className="provider-section">
        <div className="section-heading compact-heading">
          <div>
            <strong>Test Controls</strong>
            <span>Runs through the local backend and returns redacted traces.</span>
          </div>
          <button type="button" className="primary-button" disabled={!selectedProvider || !selectedModelId || Boolean(loading)} onClick={runTest}>
            {loading === 'Testing provider' ? <Loader2 size={15} /> : <FlaskConical size={15} />}
            Run test
          </button>
        </div>
        <div className="test-toggle-grid">
          {(['text', 'vision', 'json', 'streaming'] as const).map((key) => (
            <label key={key} className="toggle-row">
              <input type="checkbox" checked={tests[key]} onChange={(event) => setTests({ ...tests, [key]: event.target.checked })} />
              <span>{key}</span>
            </label>
          ))}
        </div>
        {testResult ? <ProviderTestReadout result={testResult} /> : <p className="empty-text">No test result yet.</p>}
      </div>
    </section>
  )
}

function NsfwRouteHint({ provider, flags }: { provider?: ProviderProfile; flags: ModelCapabilityFlags }) {
  const hints: string[] = []
  if (!flags.supportsVision) {
    hints.push('Images are blocked because this model is not marked Vision-capable.')
  }
  if (!flags.supportsImageGeneration) {
    hints.push('Story continuation image generation is blocked until image generation is enabled.')
  }
  if (!provider?.isLocal && !flags.allowsAdultInput) {
    hints.push('R-18 image input is blocked for external providers unless adult input is explicitly allowed.')
  }
  if (!flags.allowsAdultGeneration) {
    hints.push('R-18 generation is blocked until adult generation is explicitly allowed.')
  }
  if (!hints.length) {
    hints.push('Route can accept image and R-18 requests only when the user enables R-18 for that job.')
  }

  return (
    <div className="route-hint">
      <ShieldAlert size={15} />
      <span>{hints.join(' ')}</span>
    </div>
  )
}

function ProviderTestReadout({ result }: { result: ProviderTestResponse }) {
  return (
    <div className="test-readout">
      <div className={`test-summary ${result.passed ? 'passed' : 'failed'}`}>
        {result.passed ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
        <strong>{result.passed ? 'Pass' : 'Fail'}</strong>
        <span>{result.latencyMs} ms</span>
      </div>
      <div className="test-result-grid">
        {result.results.map((item) => (
          <div key={item.kind} className={item.passed ? 'passed' : 'failed'}>
            <strong>{item.kind}</strong>
            <span>{item.message || (item.passed ? 'passed' : 'failed')}</span>
          </div>
        ))}
      </div>
      <div className="trace-box">
        <div className="panel-heading">
          <KeyRound size={14} />
          Redacted trace
        </div>
        {result.redactedTrace.length ? (
          result.redactedTrace.map((line) => <code key={line}>{line}</code>)
        ) : (
          <span>No trace returned.</span>
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error'
}
