import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Cloud,
  FlaskConical,
  HardDrive,
  KeyRound,
  Loader2,
  Minus,
  Pencil,
  Plus,
  Radar,
  RefreshCw,
  Save,
  ShieldAlert,
  SlidersHorizontal,
  Trash2,
  XCircle,
} from 'lucide-react'
import type {
  DiscoveredModel,
  ModelCapability,
  ModelCapabilityFlags,
  ProviderConnectionErrorCode,
  ProviderProfile,
  ProviderTestInput,
  ProviderTestResult,
  ProviderTestResponse,
} from './api'
import type { ActiveEngineInfo, ConnectionMode, SecretStatus } from './shared/types'
import * as api from './api'
import { useI18n } from './i18n/context'
import type { MessageKey } from './i18n/messages'
import { ActiveIndicator, MotionIcon } from './MotionUI'
import { quickTransition, softSpring } from './motionTokens'

const capabilityKeys = [
  'supportsVision',
  'supportsImageGeneration',
  'supportsStreaming',
  'supportsJsonSchema',
  'allowsAdultInput',
  'allowsAdultGeneration',
] as const satisfies readonly (keyof ModelCapabilityFlags)[]

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

const connectionErrorLabelKeys: Record<ProviderConnectionErrorCode, MessageKey> = {
  authentication_or_base_url: 'providerLab.connectionAuthError',
  endpoint_not_found: 'providerLab.connectionEndpointError',
  rate_limited: 'providerLab.connectionRateLimitError',
  provider_unavailable: 'providerLab.connectionUnavailableError',
  network_error: 'providerLab.connectionNetworkError',
}

const defaultTests: ProviderTestInput['tests'] = {
  text: true,
  vision: true,
  json: true,
  streaming: true,
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

function newProviderForm(mode: ConnectionMode): ProviderFormState {
  return { ...emptyForm, isLocal: mode === 'local' }
}

const emptyCapabilityDraft: ModelCapabilityFlags = {
  supportsVision: false,
  supportsImageGeneration: false,
  supportsStreaming: false,
  supportsJsonSchema: false,
  allowsAdultInput: false,
  allowsAdultGeneration: false,
}

export interface ProviderLabPanelProps {
  secretStatus: SecretStatus | null
  providers: ProviderProfile[]
  mode: ConnectionMode
  /** Pushes refreshed provider lists back up so useStudio (onboarding, settings) stays in sync. */
  onProvidersChanged: (providers: ProviderProfile[]) => void
}

export function ProviderLabPanel(props: ProviderLabPanelProps) {
  const { t } = useI18n()
  // Provider profiles live in useStudio (single source of truth); this panel only
  // reads props.providers and reports refreshed lists via onProvidersChanged.
  const { providers, onProvidersChanged, mode } = props
  const visibleProviders = providers.filter((provider) => provider.isLocal === (mode === 'local'))
  const [capabilities, setCapabilities] = useState<ModelCapability[]>([])
  const [models, setModels] = useState<DiscoveredModel[]>([])
  const [selectedProviderId, setSelectedProviderId] = useState('')
  const [selectedModelId, setSelectedModelId] = useState('')
  const [form, setForm] = useState<ProviderFormState>(newProviderForm(mode))
  const [providerFormOpen, setProviderFormOpen] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [capabilityDraft, setCapabilityDraft] = useState<ModelCapabilityFlags>(emptyCapabilityDraft)
  const [tests, setTests] = useState<ProviderTestInput['tests']>(defaultTests)
  const [testResult, setTestResult] = useState<ProviderTestResponse | null>(null)
  const [activeEngine, setActiveEngine] = useState<ActiveEngineInfo | null>(null)
  const [loading, setLoading] = useState('')
  const [initializing, setInitializing] = useState(true)
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

  const selectedProvider = visibleProviders.find((provider) => provider.id === selectedProviderId)
  const modeActiveEngine = activeEngine && activeEngine.isLocal === (mode === 'local') ? activeEngine : null
  const selectedCapability = capabilities.find(
    (capability) => capability.providerId === selectedProviderId && capability.modelId === selectedModelId,
  )
  const capabilityPatch = selectedCapability
    ? changedCapabilityFlags(selectedCapability, capabilityDraft)
    : {}
  const hasCapabilityChanges = Object.keys(capabilityPatch).length > 0

  function capabilityStatusLabel(status: DiscoveredModel['capabilityStatus']): string {
    const resolved = status || 'unknown'
    const key = capabilityStatusKeys[resolved]
    return key ? t(key) : resolved
  }

  const modelsForMatrix = mergeProviderModels(
    capabilities,
    models,
    selectedProviderId,
    selectedProvider?.defaultModel,
  )

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
        const provider = providerList.find((item) => item.isLocal === (mode === 'local'))
        setSelectedProviderId(provider?.id || '')
        setSelectedModelId(provider?.defaultModel || '')
        setForm(provider ? providerToForm(provider) : newProviderForm(mode))
        const hasDirectExternalRoute = Boolean(
          mode === 'external' && props.secretStatus?.apiBaseUrl && props.secretStatus.modelName && props.secretStatus.hasApiKey,
        )
        setProviderFormOpen(!provider && !hasDirectExternalRoute)
        setCapabilityDraft(
          provider ? capabilityFlagsFor(capabilityList, provider.id, provider.defaultModel) : emptyCapabilityDraft,
        )
      } catch (nextError) {
        if (!cancelled) setError(errorMessage(nextError, t('providerLab.unknownError')))
      } finally {
        if (!cancelled) {
          setLoading('')
          setInitializing(false)
        }
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
    const provider = providerList.find((item) => item.id === selectedProviderId && item.isLocal === (mode === 'local')) || providerList.find((item) => item.isLocal === (mode === 'local'))
    if (!provider) {
      setSelectedProviderId('')
      setSelectedModelId('')
      setForm(newProviderForm(mode))
      setProviderFormOpen(true)
      setCapabilityDraft(emptyCapabilityDraft)
      return
    }
    selectProvider(provider, capabilityList)
  }

  function selectProvider(provider: ProviderProfile, capabilityList = capabilities) {
    const modelId = provider.defaultModel
    setSelectedProviderId(provider.id)
    setSelectedModelId(modelId)
    setForm(providerToForm(provider))
    setProviderFormOpen(false)
    setAdvancedOpen(false)
    setCapabilityDraft(capabilityFlagsFor(capabilityList, provider.id, modelId))
  }

  function startNewProvider() {
    setForm(newProviderForm(mode))
    setProviderFormOpen(true)
    setAdvancedOpen(false)
  }

  function editSelectedProvider() {
    if (!selectedProvider) return
    setForm(providerToForm(selectedProvider))
    setProviderFormOpen(true)
    setAdvancedOpen(false)
  }

  function selectModel(modelId: string) {
    setSelectedModelId(modelId)
    setCapabilityDraft(capabilityFlagsFor(capabilities, selectedProviderId, modelId))
  }

  function selectModelWithCapabilities(modelId: string, capabilityList: ModelCapability[]) {
    setSelectedModelId(modelId)
    setCapabilityDraft(capabilityFlagsFor(capabilityList, selectedProviderId, modelId))
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
        isLocal: mode === 'local',
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
      const preferredModelId = selectedModelId || selectedProvider.defaultModel
      const modelId = discovered.some((model) => model.id === preferredModelId) ? preferredModelId : discovered[0]?.id || preferredModelId
      selectModelWithCapabilities(modelId, capabilityList)
    })
  }

  async function saveCapabilityOverrides() {
    if (!selectedCapability || !hasCapabilityChanges) {
      return
    }
    await run(t('providerLab.savingCapabilities'), async () => {
      const saved = await api.updateModelCapability(selectedCapability.id, capabilityPatch)
      setCapabilities((current) => current.map((capability) => (capability.id === saved.id ? saved : capability)))
      setCapabilityDraft(capabilityFlagsFrom(saved))
    })
  }

  /** One-click first-run setup: probe local engines and create a profile from the hit. */
  async function detectLocal() {
    await run(t('providerLab.detectingLocal'), async () => {
      const result = await api.detectLocalEngine()
      if (!result.found || !result.baseUrl || !result.models?.length) {
        throw new Error(t('providerLab.detectNone'))
      }
      const saved = await api.createProvider({
        name: t('providerLab.detectedProviderName'),
        baseUrl: result.baseUrl,
        defaultModel: result.models[0],
        isLocal: true,
      })
      const [providerList, capabilityList] = await Promise.all([api.listProviders(), api.listModelCapabilities()])
      onProvidersChanged(providerList)
      setCapabilities(capabilityList)
      selectProvider(saved, capabilityList)
    })
  }

  async function runTest() {
    if (!selectedProvider || !selectedModelId) return
    await run(t('providerLab.testingProvider'), async () => {
      const result = await api.testProvider(selectedProvider.id, { modelId: selectedModelId, tests })
      const capabilityList = await api.listModelCapabilities()
      setTestResult(result)
      setCapabilities(capabilityList)
      setCapabilityDraft(capabilityFlagsFor(capabilityList, selectedProvider.id, selectedModelId))
    })
  }

  return (
    <section className="provider-lab">
      <div className="section-heading">
        <strong>{mode === 'local' ? t('providerLab.localTitle') : t('providerLab.externalTitle')}</strong>
        <motion.button
          type="button"
          className="icon-button"
          aria-label={t('providerLab.refresh')}
          title={t('providerLab.refresh')}
          disabled={initializing || Boolean(loading)}
          whileHover={{ rotate: -12 }}
          whileTap={{ scale: 0.86, rotate: 18 }}
          onClick={refresh}
        >
          <MotionIcon
            icon={loading === t('providerLab.loadingLab') ? Loader2 : RefreshCw}
            state={loading === t('providerLab.loadingLab') ? 'loading' : 'idle'}
            size={15}
            spin={loading === t('providerLab.loadingLab')}
          />
        </motion.button>
      </div>

      {activeEngine && !modeActiveEngine ? <ModeRouteNotice activeEngine={activeEngine} mode={mode} /> : <ActiveEngineCard engine={modeActiveEngine} />}
      {mode === 'local' && !modeActiveEngine ? (
        <button
          type="button"
          className="secondary-button"
          disabled={initializing || Boolean(loading)}
          data-testid="detect-local-engine"
          onClick={detectLocal}
        >
          <Radar size={15} />
          {t('providerLab.detectLocal')}
        </button>
      ) : null}

      <AnimatePresence initial={false}>
      {error ? (
        <motion.div className="inline-alert" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={quickTransition}>
          <ShieldAlert size={15} />
          <span>{error}</span>
        </motion.div>
      ) : null}
      </AnimatePresence>

      <div className="provider-grid">
        <div className="provider-list">
          <div className="provider-list-heading">
            <div className="panel-heading">{t('providerLab.providers')}</div>
            <div className="provider-list-actions">
              {selectedProvider ? (
                <motion.button
                  type="button"
                  className="icon-button"
                  aria-label={t('providerLab.edit')}
                  title={t('providerLab.edit')}
                  disabled={initializing || Boolean(loading)}
                  data-testid="edit-provider"
                  whileTap={{ scale: 0.84 }}
                  onClick={editSelectedProvider}
                >
                  <Pencil size={14} />
                </motion.button>
              ) : null}
              <motion.button
                type="button"
                className="icon-button"
                aria-label={providerFormOpen ? t('providerLab.cancel') : t('providerLab.new')}
                title={providerFormOpen ? t('providerLab.cancel') : t('providerLab.new')}
                disabled={initializing || Boolean(loading)}
                data-testid="new-provider"
                data-open={providerFormOpen}
                whileTap={{ scale: 0.84 }}
                onClick={() => providerFormOpen ? setProviderFormOpen(false) : startNewProvider()}
              >
                <MotionIcon icon={providerFormOpen ? Minus : Plus} state={providerFormOpen ? 'open' : 'closed'} size={15} spin={false} />
              </motion.button>
            </div>
          </div>
          {visibleProviders.length ? (
            visibleProviders.map((provider) => (
              <motion.button
                layout
                key={provider.id}
                type="button"
                className={`provider-row ${provider.id === selectedProviderId ? 'active' : ''} ${provider.id === activeEngine?.providerId ? 'is-active-engine' : ''}`}
                whileHover={{ x: 2 }}
                whileTap={{ scale: 0.985 }}
                transition={quickTransition}
                onClick={() => selectProvider(provider)}
              >
                {provider.id === selectedProviderId ? <ActiveIndicator layoutId={`provider-active-${mode}`} className="provider-active-indicator" /> : null}
                <strong>{provider.name}</strong>
                <span>{provider.defaultModel}</span>
                <small>
                  {t('providerLab.providerRowMeta', {
                    kind: provider.isLocal ? t('providerLab.kindLocal') : t('providerLab.kindExternal'),
                    keyState: mode === 'local' ? t('providerLab.localOnly') : provider.hasApiKey ? t('providerLab.keySaved') : t('providerLab.noKey'),
                  })}
                </small>
              </motion.button>
            ))
          ) : (
            <p className="empty-text">{mode === 'local' ? t('providerLab.emptyLocalProviders') : t('providerLab.emptyExternalProviders')}</p>
          )}
        </div>

        <AnimatePresence initial={false}>
        {providerFormOpen ? <motion.form
          className="provider-form"
          initial={{ opacity: 0, height: 0, y: -6 }}
          animate={{ opacity: 1, height: 'auto', y: 0 }}
          exit={{ opacity: 0, height: 0, y: -6 }}
          transition={quickTransition}
          onSubmit={saveProvider}
        >
          <div className="panel-heading">{form.id ? t('providerLab.editProvider') : t('providerLab.createProvider')}</div>
          <label>
            {t('providerLab.name')}
            <input disabled={initializing || Boolean(loading)} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder={t('providerLab.namePlaceholder')} />
          </label>
          <label>
            {t('providerLab.baseUrl')}
            <input disabled={initializing || Boolean(loading)} value={form.baseUrl} onChange={(event) => setForm({ ...form, baseUrl: event.target.value })} placeholder={t('providerLab.baseUrlPlaceholder')} />
          </label>
          <label>
            {t('providerLab.defaultModel')}
            <input disabled={initializing || Boolean(loading)} value={form.defaultModel} onChange={(event) => setForm({ ...form, defaultModel: event.target.value })} placeholder={t('providerLab.defaultModelPlaceholder')} />
          </label>
          {mode === 'external' ? (
            <label>
              {t('providerLab.apiKey')}
              <input
                disabled={initializing || Boolean(loading)}
                type="password"
                value={form.apiKey}
                onChange={(event) => setForm({ ...form, apiKey: event.target.value })}
                placeholder={selectedProvider?.hasApiKey ? t('providerLab.apiKeyPlaceholderSaved') : t('providerLab.apiKeyPlaceholderNew')}
                autoComplete="off"
              />
            </label>
          ) : null}
          <span className="field-hint">{mode === 'local' ? t('providerLab.localKeyHint') : t('providerLab.externalKeyHint')}</span>
          <div className="provider-actions">
            <button type="submit" className="primary-button" disabled={initializing || Boolean(loading)}>
              <Save size={15} />
              {t('providerLab.save')}
            </button>
            <button type="button" className="secondary-button" disabled={initializing || Boolean(loading)} onClick={() => setProviderFormOpen(false)}>
              {t('providerLab.cancel')}
            </button>
            {form.id ? (
              <button type="button" className="secondary-button danger-button" disabled={!selectedProvider || initializing || Boolean(loading)} onClick={deleteSelectedProvider}>
                <Trash2 size={15} />
                {t('providerLab.delete')}
              </button>
            ) : null}
          </div>
        </motion.form> : null}
        </AnimatePresence>
      </div>

      {selectedProvider ? (
        <div className="provider-advanced" data-open={advancedOpen} data-testid="provider-advanced">
          <motion.button
            type="button"
            className="provider-advanced-toggle"
            data-testid="provider-advanced-toggle"
            aria-expanded={advancedOpen}
            whileTap={{ scale: 0.985 }}
            onClick={() => setAdvancedOpen((current) => !current)}
          >
            <span>
              <SlidersHorizontal size={15} />
              {t('providerLab.advanced')}
            </span>
            <motion.span className="provider-advanced-chevron" animate={{ rotate: advancedOpen ? 180 : 0 }} transition={quickTransition}>
              <ChevronDown size={16} />
            </motion.span>
          </motion.button>
          <AnimatePresence initial={false}>
          {advancedOpen ? (
          <motion.div
            className="provider-advanced-body"
            initial={{ opacity: 0, height: 0, y: -6 }}
            animate={{ opacity: 1, height: 'auto', y: 0 }}
            exit={{ opacity: 0, height: 0, y: -6 }}
            transition={quickTransition}
          >
      <div className="provider-section">
        <div className="section-heading compact-heading">
          <div>
            <strong>{t('providerLab.modelDiscovery')}</strong>
            <span>{t('providerLab.modelDiscoverySubtitle')}</span>
          </div>
          <button type="button" className="secondary-button" disabled={!selectedProvider || initializing || Boolean(loading)} onClick={discoverModels}>
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
            {capabilityKeys.map((key) => (
              <CapabilityBadge key={key} capability={selectedCapability} flag={key} />
            ))}
          </div>

          <div className="capability-overrides">
            <div className="panel-heading">
              <SlidersHorizontal size={14} />
              {t('providerLab.overrideSection')}
            </div>
            <div className="capability-matrix">
              {capabilityKeys.map((key) => (
                <label key={key} className="capability-cell">
                  <input
                    type="checkbox"
                    checked={capabilityDraft[key]}
                    data-testid={`capability-override-${key}`}
                    onChange={(event) =>
                      setCapabilityDraft((current) => ({ ...current, [key]: event.target.checked }))
                    }
                  />
                  <span>{t(capabilityLabelKeys[key])}</span>
                </label>
              ))}
            </div>
            <button
              type="button"
              className="secondary-button"
              data-testid="save-capability-overrides"
              disabled={initializing || Boolean(loading) || !hasCapabilityChanges}
              onClick={saveCapabilityOverrides}
            >
              <Save size={15} />
              {t('providerLab.saveOverrides')}
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
          <button type="button" className="primary-button" disabled={!selectedProvider || !selectedModelId || initializing || Boolean(loading)} onClick={runTest}>
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
          </motion.div>
          ) : null}
          </AnimatePresence>
        </div>
      ) : null}
    </section>
  )
}

function ActiveEngineCard({ engine }: { engine: ActiveEngineInfo | null }) {
  const { t } = useI18n()

  if (!engine) {
    return (
      <motion.div layout className="active-engine-card none" data-testid="active-engine-card" initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }} transition={softSpring}>
        <AlertTriangle size={18} />
        <div className="active-engine-body">
          <span className="active-engine-caption">{t('providerLab.activeEngine')}</span>
          <strong>{t('providerLab.activeEngineNone')}</strong>
          <span>{t('providerLab.activeEngineNoneHint')}</span>
        </div>
      </motion.div>
    )
  }

  const name = engine.providerName || engine.apiBaseUrl
  const Icon = engine.isLocal ? HardDrive : Cloud

  return (
    <motion.div layout className="active-engine-card" data-testid="active-engine-card" initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }} transition={softSpring}>
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
    </motion.div>
  )
}

function ModeRouteNotice({ activeEngine, mode }: { activeEngine: ActiveEngineInfo; mode: ConnectionMode }) {
  const { t } = useI18n()
  return (
    <motion.div className="mode-route-notice" initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }} transition={quickTransition}>
      <AlertTriangle size={16} />
      <div>
        <strong>{t('providerLab.routeOutsideWorkspace')}</strong>
        <span>
          {mode === 'local' ? t('providerLab.routeExternalActive', { model: activeEngine.modelName }) : t('providerLab.routeLocalActive', { model: activeEngine.modelName })}
        </span>
      </div>
    </motion.div>
  )
}

function ProviderTestReadout({ result }: { result: ProviderTestResponse }) {
  const { t } = useI18n()
  const connectionError = result.connectionError
  const supportedCount = result.results.filter((item) => item.outcome === 'supported').length
  const unsupportedCount = result.results.filter((item) => item.outcome === 'unsupported').length
  const indeterminateCount = result.results.filter((item) => item.outcome === 'indeterminate').length
  const summaryState = connectionError || unsupportedCount > 0 ? 'failed' : indeterminateCount > 0 ? 'partial' : 'passed'
  const SummaryIcon = summaryState === 'passed' ? CheckCircle2 : summaryState === 'partial' ? AlertTriangle : XCircle
  const summaryLabel = connectionError
    ? t('providerLab.connectionFailed')
    : summaryState === 'passed'
      ? t('providerLab.pass')
      : summaryState === 'partial'
        ? t('providerLab.partial')
        : t('providerLab.unsupportedResult')
  const summaryDetail = summaryState === 'partial'
    ? t('providerLab.partialSummary', { passed: supportedCount, unknown: indeterminateCount })
    : summaryState === 'failed' && !connectionError
      ? t('providerLab.unsupportedSummary', { passed: supportedCount, unsupported: unsupportedCount })
      : t('providerLab.latency', { ms: result.latencyMs })
  return (
    <div className="test-readout">
      <div
        className={`test-summary ${summaryState}`}
        data-state={summaryState}
        data-testid="provider-test-summary"
      >
        <SummaryIcon size={16} />
        <strong>{summaryLabel}</strong>
        <span>{summaryDetail}</span>
      </div>
      {connectionError ? (
        <div className="connection-test-error" data-testid="provider-test-connection-error">
          <AlertTriangle size={16} />
          <span>{t(connectionErrorLabelKeys[connectionError.code])}</span>
        </div>
      ) : (
        <div className="test-result-grid">
          {result.results.map((item) => <ProviderTestResultRow key={item.kind} item={item} />)}
        </div>
      )}
      <details className="trace-disclosure" data-testid="provider-test-diagnostics">
        <summary>
          <span>
            <KeyRound size={14} />
            {t('providerLab.redactedTrace')}
          </span>
          <ChevronDown size={15} />
        </summary>
        <div className="trace-box">
          {result.redactedTrace.length ? (
            result.redactedTrace.map((line) => <code key={line}>{line}</code>)
          ) : (
            <span>{t('providerLab.noTrace')}</span>
          )}
        </div>
      </details>
    </div>
  )
}

function ProviderTestResultRow({ item }: { item: ProviderTestResult }) {
  const { t } = useI18n()
  const ResultIcon = item.outcome === 'supported' ? CheckCircle2 : item.outcome === 'unsupported' ? XCircle : AlertTriangle
  const message = item.outcome === 'supported'
    ? t('providerLab.resultPassed')
    : item.outcome === 'unsupported'
      ? t('providerLab.resultUnsupported')
      : item.status === undefined
        ? t('providerLab.resultIndeterminate')
        : t('providerLab.resultIndeterminateHttp', { status: item.status })
  return (
    <div className={item.outcome} data-testid={`provider-test-result-${item.kind}`}>
      <div className="test-result-heading">
        <ResultIcon size={14} />
        <strong>{t(testKindLabelKeys[item.kind])}</strong>
      </div>
      <span>{message}</span>
    </div>
  )
}

function CapabilityBadge({
  capability,
  flag,
}: {
  capability: ModelCapability
  flag: (typeof capabilityKeys)[number]
}) {
  const { t } = useI18n()
  const evidence = capability.capabilitySources[flag] || 'unknown'
  const known = evidence !== 'unknown'
  const supported = known && capability[flag]
  const status = !known
    ? t('providerLab.statusUnknown')
    : supported
      ? t('providerLab.statusSupported')
      : t('providerLab.statusUnsupported')
  return (
    <span className={`cap-badge ${!known ? 'unknown' : supported ? 'on' : 'off'}`}>
      {!known ? <AlertTriangle size={13} /> : supported ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
      {t(capabilityLabelKeys[flag])}: {status}
    </span>
  )
}

function capabilityFlagsFor(
  capabilities: ModelCapability[],
  providerId: string,
  modelId: string,
): ModelCapabilityFlags {
  const capability = capabilities.find((item) => item.providerId === providerId && item.modelId === modelId)
  return capability ? capabilityFlagsFrom(capability) : { ...emptyCapabilityDraft }
}

function capabilityFlagsFrom(capability: ModelCapability): ModelCapabilityFlags {
  return {
    supportsVision: capability.supportsVision,
    supportsImageGeneration: capability.supportsImageGeneration,
    supportsStreaming: capability.supportsStreaming,
    supportsJsonSchema: capability.supportsJsonSchema,
    allowsAdultInput: capability.allowsAdultInput,
    allowsAdultGeneration: capability.allowsAdultGeneration,
  }
}

function changedCapabilityFlags(
  capability: ModelCapability,
  draft: ModelCapabilityFlags,
): Partial<ModelCapabilityFlags> {
  return Object.fromEntries(
    capabilityKeys.flatMap((key) => (capability[key] === draft[key] ? [] : [[key, draft[key]]])),
  ) as Partial<ModelCapabilityFlags>
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

function capabilityStatusFor(capability: ModelCapability): DiscoveredModel['capabilityStatus'] {
  const sources = Object.values(capability.capabilitySources)
  if (sources.every((source) => source === 'unknown')) return 'unknown'
  if (sources.includes('user')) return 'user-confirmed'
  return 'detected'
}

function mergeProviderModels(
  capabilities: ModelCapability[],
  models: DiscoveredModel[],
  providerId: string,
  defaultModel: string | undefined,
): DiscoveredModel[] {
  const merged = new Map<string, DiscoveredModel>()
  for (const capability of capabilities.filter((item) => item.providerId === providerId)) {
    merged.set(capability.modelId, {
      id: capability.modelId,
      capabilityStatus: capabilityStatusFor(capability),
    })
  }
  for (const model of models) {
    merged.set(model.id, { ...merged.get(model.id), ...model })
  }
  if (defaultModel && !merged.has(defaultModel)) {
    merged.set(defaultModel, { id: defaultModel, capabilityStatus: 'unknown' })
  }
  return Array.from(merged.values())
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}
