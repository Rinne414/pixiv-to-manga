const base = 'http://127.0.0.1:4174'
const results = []

async function request(path, init = {}) {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
  })
  const text = await response.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = { raw: text }
  }
  return { status: response.status, ok: response.ok, text, json }
}

function assert(condition, name, details = '') {
  results.push({ name, ok: Boolean(condition), details })
  if (!condition) throw new Error(`${name}: ${details}`)
}

let providerId = ''
try {
  const created = await request('/api/providers', {
    method: 'POST',
    body: JSON.stringify({
      name: `Smoke Mock No Key ${Date.now()}`,
      baseUrl: 'http://127.0.0.1:5199',
      defaultModel: 'gpt-4o-smoke',
      isLocal: true,
    }),
  })
  assert(created.ok, 'create provider without api key', `HTTP ${created.status} ${created.text}`)
  providerId = created.json.provider.id
  assert(created.json.provider.hasApiKey === false, 'provider reports no key')

  const discovered = await request(`/api/providers/${providerId}/models/discover`, { method: 'POST', body: JSON.stringify({}) })
  assert(discovered.ok, 'discover models without api key', `HTTP ${discovered.status} ${discovered.text}`)
  assert(discovered.json.models.some((model) => model.modelId === 'gpt-4o-smoke'), 'discover includes gpt-4o-smoke')

  const tested = await request(`/api/providers/${providerId}/test`, {
    method: 'POST',
    body: JSON.stringify({ modelId: 'gpt-4o-smoke', tests: ['text', 'vision', 'json', 'streaming'] }),
  })
  assert(tested.ok, 'run provider test without api key', `HTTP ${tested.status} ${tested.text}`)
  assert(tested.json.ok === true, 'provider test passed against mock')
  assert(!tested.text.includes('iVBORw0KGgo='), 'provider test response redacts image payload')
  assert(JSON.stringify(tested.json.trace).includes('[redacted image payload]'), 'provider test trace redacts image payload')

  const caps = await request('/api/model-capabilities')
  assert(caps.ok, 'list model capabilities', `HTTP ${caps.status}`)
  const cap = caps.json.capabilities.find((item) => item.providerId === providerId && item.modelId === 'gpt-4o-smoke')
  assert(Boolean(cap), 'capability record exists')

  const patched = await request(`/api/model-capabilities/${cap.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ allowsAdultInput: true, allowsAdultGeneration: false }),
  })
  assert(patched.ok, 'patch capability flags', `HTTP ${patched.status} ${patched.text}`)
  assert(patched.json.capability.allowsAdultInput === true, 'capability adult input flag saved')

  console.log(JSON.stringify({ ok: true, providerId, results }, null, 2))
} catch (error) {
  console.log(JSON.stringify({ ok: false, providerId, error: String(error?.message || error), results }, null, 2))
  process.exitCode = 1
}
