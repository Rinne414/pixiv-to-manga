import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  analyzeStory,
  cancelJob,
  createProvider,
  discoverProviderModels,
  exportProjectBackup,
  importProjectBackup,
  JobFailedError,
  saveStoryBible,
  testProvider,
  updateModelCapability,
  type ModelCapability,
} from '../src/api'
import type { JobEvent, ProjectDetail } from '../src/shared/types'

const capability: ModelCapability = {
  id: 'cap-1',
  providerId: 'provider-1',
  modelId: 'gpt-4o',
  supportsVision: true,
  supportsImageGeneration: false,
  supportsStreaming: true,
  supportsJsonSchema: true,
  allowsAdultInput: false,
  allowsAdultGeneration: false,
  capabilitySources: {
    supportsVision: 'provider',
    supportsImageGeneration: 'unknown',
    supportsStreaming: 'tested',
    supportsJsonSchema: 'provider',
    allowsAdultInput: 'unknown',
    allowsAdultGeneration: 'unknown',
  },
  source: 'discovered',
  updatedAt: '2026-06-20T00:00:00.000Z',
}

describe('Provider Lab API client adapters', () => {
  afterEach(() => {
    MockEventSource.instances = []
    vi.unstubAllGlobals()
  })

  it('unwraps provider mutation responses', async () => {
    stubFetch({
      provider: {
        id: 'provider-1',
        name: 'OpenAI',
        baseUrl: 'https://api.example.test/v1',
        defaultModel: 'gpt-4o',
        isLocal: false,
        hasApiKey: true,
      },
    })

    const provider = await createProvider({
      name: 'OpenAI',
      baseUrl: 'https://api.example.test/v1',
      defaultModel: 'gpt-4o',
      isLocal: false,
      apiKey: 'provider-form-secret',
    })

    expect(provider.id).toBe('provider-1')
    expect(provider.hasApiKey).toBe(true)
  })

  it('maps discovered backend capability records into frontend model rows', async () => {
    stubFetch({ models: [capability], trace: { request: { headers: { Authorization: '[redacted]' } } } })

    const models = await discoverProviderModels('provider-1')

    expect(models).toEqual([
      {
        id: 'gpt-4o',
        name: 'gpt-4o',
        capabilityStatus: 'detected',
        capabilities: {
          supportsVision: true,
          supportsImageGeneration: false,
          supportsStreaming: true,
          supportsJsonSchema: true,
          allowsAdultInput: false,
          allowsAdultGeneration: false,
        },
      },
    ])
  })

  it('converts checkbox tests into backend test arrays and normalizes traces', async () => {
    const fetchMock = stubFetch({
      providerId: 'provider-1',
      modelId: 'gpt-4o',
      ok: true,
      results: [
        { kind: 'text', ok: true, outcome: 'supported', status: 200, latencyMs: 10 },
        { kind: 'vision', ok: true, outcome: 'supported', status: 200, latencyMs: 20 },
      ],
      trace: [{ request: { headers: { Authorization: '[redacted]' } } }],
      inferredCapabilities: { supportsVision: true },
    })

    const result = await testProvider('provider-1', {
      modelId: 'gpt-4o',
      tests: { text: true, vision: true, json: false, streaming: false },
    })
    const [, requestInit] = fetchMock.mock.calls[0] as Parameters<typeof fetch>
    const requestBody = JSON.parse(String(requestInit?.body))

    expect(requestBody.tests).toEqual(['text', 'vision'])
    expect(result.passed).toBe(true)
    expect(result.latencyMs).toBe(30)
    expect(result.results[0]).toEqual({
      kind: 'text',
      passed: true,
      outcome: 'supported',
      status: 200,
      latencyMs: 10,
      message: 'HTTP 200 / 10 ms',
    })
    expect(result.redactedTrace[0]).toContain('[redacted]')
  })

  it('unwraps capability update responses', async () => {
    stubFetch({ capability: { ...capability, allowsAdultInput: true, source: 'user' } })

    const updated = await updateModelCapability('cap-1', {
      supportsVision: true,
      supportsImageGeneration: false,
      supportsStreaming: true,
      supportsJsonSchema: true,
      allowsAdultInput: true,
      allowsAdultGeneration: false,
    })

    expect(updated.id).toBe('cap-1')
    expect(updated.allowsAdultInput).toBe(true)
    expect(updated.source).toBe('user')
  })

  it('preserves an indeterminate capability check instead of reporting unsupported', async () => {
    stubFetch({
      providerId: 'provider-1',
      modelId: 'gpt-4o',
      ok: false,
      results: [
        {
          kind: 'vision',
          ok: false,
          outcome: 'indeterminate',
          status: 400,
          error: 'Capability check was inconclusive: HTTP 400.',
          latencyMs: 25,
        },
      ],
      trace: [],
    })

    const result = await testProvider('provider-1', {
      modelId: 'gpt-4o',
      tests: { text: false, vision: true, json: false, streaming: false },
    })

    expect(result.passed).toBe(false)
    expect(result.results[0]).toMatchObject({
      kind: 'vision',
      outcome: 'indeterminate',
      status: 400,
      passed: false,
    })
  })

  it('rejects provider tests with no selected probes before making a request', async () => {
    const fetchMock = stubFetch({})

    await expect(
      testProvider('provider-1', {
        modelId: 'gpt-4o',
        tests: { text: false, vision: false, json: false, streaming: false },
      }),
    ).rejects.toThrow(/Select at least one provider test/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('posts project backup export requests', async () => {
    const fetchMock = stubFetch({ fileName: 'backup.zip', absolutePath: 'C:/tmp/backup.zip', url: '/assets/exports/backup.zip' })

    const result = await exportProjectBackup({ projectId: 'project-1' })
    const [path, requestInit] = fetchMock.mock.calls[0] as Parameters<typeof fetch>

    expect(path).toBe('/api/export/project-backup')
    expect(requestInit?.method).toBe('POST')
    expect(JSON.parse(String(requestInit?.body))).toEqual({ projectId: 'project-1' })
    expect(result.fileName).toBe('backup.zip')
  })

  it('posts project backup restore requests as multipart form data', async () => {
    const fetchMock = stubFetch({
      project: { id: 'restored-project', title: 'Restored', mode: 'story', source: 'local' },
      pages: [],
      assets: [],
      characters: [],
      dialogues: [],
    })

    await importProjectBackup(new File(['zip'], 'backup.zip', { type: 'application/zip' }))
    const [path, requestInit] = fetchMock.mock.calls[0] as Parameters<typeof fetch>

    expect(path).toBe('/api/import/project-backup')
    expect(requestInit?.method).toBe('POST')
    expect(requestInit?.body).toBeInstanceOf(FormData)
  })

  it('waits for story analysis completion over job events', async () => {
    const fetchMock = stubFetch({ jobId: 'job-1' })
    vi.stubGlobal('EventSource', MockEventSource)
    const jobIds: string[] = []

    const pending = analyzeStory(
      { projectId: 'project-1', userBrief: '海边重逢', r18Enabled: false },
      { onJobId: (jobId) => jobIds.push(jobId) },
    )
    await waitForEventSource()
    MockEventSource.instances[0].emit({
      jobId: 'job-1',
      type: 'complete',
      progress: 1,
      message: 'Done',
      payload: projectDetail,
    })
    const result = await pending
    const [path, requestInit] = fetchMock.mock.calls[0] as Parameters<typeof fetch>

    expect(path).toBe('/api/story/analyze')
    expect(JSON.parse(String(requestInit?.body))).toEqual({ projectId: 'project-1', userBrief: '海边重逢', r18Enabled: false })
    expect(jobIds).toEqual(['job-1'])
    expect(result.jobId).toBe('job-1')
    expect(result.project.id).toBe('project-1')
    expect(MockEventSource.instances[0].closed).toBe(true)
  })

  it('posts job cancellation requests', async () => {
    const fetchMock = stubFetch({ ok: true })

    await cancelJob('job-1')
    const [path, requestInit] = fetchMock.mock.calls[0] as Parameters<typeof fetch>

    expect(path).toBe('/api/jobs/job-1/cancel')
    expect(requestInit?.method).toBe('POST')
  })

  it('preserves job error payloads for manual AI output repair', async () => {
    stubFetch({ jobId: 'job-raw' })
    vi.stubGlobal('EventSource', MockEventSource)

    const pending = analyzeStory({ projectId: 'project-1', userBrief: '', r18Enabled: false })
    await waitForEventSource()
    MockEventSource.instances[0].emit({
      jobId: 'job-raw',
      type: 'error',
      progress: 1,
      message: 'Failed',
      error: 'AI output could not be parsed after repair',
      payload: {
        raw: 'first invalid output',
        repairedRaw: 'second invalid output',
      },
    })

    await expect(pending).rejects.toMatchObject({
      name: 'JobFailedError',
      payload: {
        raw: 'first invalid output',
        repairedRaw: 'second invalid output',
      },
    } satisfies Partial<JobFailedError>)
  })

  it('saves editable Story Bible output', async () => {
    const storyBible = {
      synopsis: '手动修改后的故事。',
      tone: '温柔、克制。',
      userBrief: 'brief',
      r18Enabled: false,
      characters: [
        {
          id: 'character-1',
          projectId: 'project-1',
          name: '夏海',
          description: '外向。',
          voice: '短句。',
          color: '#c9282d',
          bubbleStyle: 'speech' as const,
        },
      ],
      pageBeats: [{ pageIndex: 0, summary: '第一页修改。', intent: '建立关系。' }],
    }
    const fetchMock = stubFetch({ ...projectDetail, project: { ...projectDetail.project, storyBible }, characters: storyBible.characters })

    const result = await saveStoryBible('project-1', storyBible)
    const [path, requestInit] = fetchMock.mock.calls[0] as Parameters<typeof fetch>

    expect(path).toBe('/api/projects/project-1/story-bible')
    expect(requestInit?.method).toBe('PUT')
    expect(JSON.parse(String(requestInit?.body))).toEqual(storyBible)
    expect(result.project.storyBible?.synopsis).toBe('手动修改后的故事。')
  })
})

function stubFetch(payload: unknown) {
  const fetchMock = vi.fn<typeof fetch>(
    async () => new Response(JSON.stringify(payload), { status: 200 }),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const projectDetail: ProjectDetail = {
  project: {
    id: 'project-1',
    title: 'Async Project',
    mode: 'story',
    source: 'local',
    readingDirection: 'rtl',
    createdAt: '2026-06-20T00:00:00.000Z',
    updatedAt: '2026-06-20T00:00:00.000Z',
  },
  pages: [],
  assets: [],
  characters: [],
  dialogues: [],
}

class MockEventSource {
  static instances: MockEventSource[] = []
  readonly url: string
  onmessage: ((event: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  closed = false

  constructor(url: string) {
    this.url = url
    MockEventSource.instances.push(this)
  }

  close() {
    this.closed = true
  }

  emit(event: JobEvent) {
    this.onmessage?.({ data: JSON.stringify(event) })
  }
}

async function waitForEventSource(): Promise<void> {
  for (let index = 0; index < 5; index += 1) {
    if (MockEventSource.instances.length) return
    await Promise.resolve()
  }
}
