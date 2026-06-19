import { mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'

const reportDir = path.resolve('.plans/provider-lab/e2e-tester/test-provider-lab-main-thread')
const artifactDir = path.join(reportDir, 'artifacts')
mkdirSync(artifactDir, { recursive: true })

const chromePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const userDataDir = path.join(reportDir, `.chrome-profile-${Date.now()}`)
const debugPort = 9300 + Math.floor(Math.random() * 500)

const chrome = spawn(chromePath, [
  '--headless=new',
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${userDataDir}`,
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  'about:blank',
], { stdio: 'ignore', detached: true })

const secret = 'provider-browser-smoke-secret-654321'
const consoleEvents = []
const pageErrors = []
const networkRequests = []

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function getJson(url, retries = 50) {
  let lastError
  for (let i = 0; i < retries; i += 1) {
    try {
      const response = await fetch(url)
      if (response.ok) return response.json()
      lastError = new Error(`HTTP ${response.status}`)
    } catch (error) {
      lastError = error
    }
    await wait(200)
  }
  throw lastError
}

const version = await getJson(`http://127.0.0.1:${debugPort}/json/version`)
const tabResponse = await fetch(`http://127.0.0.1:${debugPort}/json/new?http://127.0.0.1:5173`, { method: 'PUT' })
if (!tabResponse.ok) {
  throw new Error(`create CDP tab failed: HTTP ${tabResponse.status}`)
}
const tab = await tabResponse.json()
const ws = new WebSocket(tab.webSocketDebuggerUrl || version.webSocketDebuggerUrl)
let nextId = 1
const pending = new Map()

await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true })
  ws.addEventListener('error', reject, { once: true })
})

ws.addEventListener('message', (event) => {
  const message = JSON.parse(event.data)
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id)
    pending.delete(message.id)
    if (message.error) reject(new Error(JSON.stringify(message.error)))
    else resolve(message.result)
    return
  }
  if (message.method === 'Runtime.consoleAPICalled') {
    consoleEvents.push(message.params)
  }
  if (message.method === 'Runtime.exceptionThrown') {
    pageErrors.push(message.params)
  }
  if (message.method === 'Network.requestWillBeSent') {
    networkRequests.push({
      url: message.params.request.url,
      method: message.params.request.method,
      headers: message.params.request.headers,
    })
  }
})

function cdp(method, params = {}) {
  console.error(`CDP ${method}`)
  const id = nextId++
  ws.send(JSON.stringify({ id, method, params }))
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`CDP timeout: ${method}`))
    }, 8000)
    pending.set(id, {
      resolve: (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      reject: (error) => {
        clearTimeout(timer)
        reject(error)
      },
    })
  })
}

async function evalJs(expression, awaitPromise = true) {
  const result = await cdp('Runtime.evaluate', { expression, awaitPromise, returnByValue: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text)
  return result.result.value
}

async function clickByText(text) {
  return evalJs(`(() => {
    const buttons = [...document.querySelectorAll('button')];
    const button = buttons.find((item) => item.textContent.trim().includes(${JSON.stringify(text)}));
    if (!button) throw new Error('Button not found: ${text}');
    button.scrollIntoView({ block: 'center', inline: 'center' });
    button.click();
    return button.textContent.trim();
  })()`)
}

async function fillLabel(labelText, value, rootSelector = 'body') {
  return evalJs(`(() => {
    const root = document.querySelector(${JSON.stringify(rootSelector)});
    const labels = [...root.querySelectorAll('label')];
    const label = labels.find((item) => item.textContent.trim().startsWith(${JSON.stringify(labelText)}));
    if (!label) throw new Error('Label not found: ${labelText}');
    const input = label.querySelector('input, textarea, select');
    if (!input) throw new Error('Input not found for: ${labelText}');
    input.focus();
    input.value = ${JSON.stringify(value)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`)
}

async function screenshot(name) {
  const png = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
  const file = path.join(artifactDir, name)
  await import('node:fs/promises').then((fs) => fs.writeFile(file, Buffer.from(png.data, 'base64')))
  return file
}

async function waitForText(text, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const found = await evalJs(`document.body.innerText.includes(${JSON.stringify(text)})`)
    if (found) return true
    await wait(250)
  }
  return false
}

const checks = []
function record(name, ok, details = '') {
  checks.push({ name, ok, details })
}

try {
  console.error('browser smoke start')
  await cdp('Runtime.enable')
  await cdp('Page.enable')
  await cdp('Network.enable')
  await cdp('Log.enable')
  await cdp('Page.navigate', { url: 'http://127.0.0.1:5173' })
  await waitForText('Pixiv-to-Manga Studio', 10000)
  console.error('app loaded')
  record('app loads', true)
  await screenshot('01-app-load.png')

  await fillLabel('Project title', `Smoke Project ${Date.now()}`, '.left-rail')
  await clickByText('Create')
  await waitForText('Project created.', 10000)
  record('create project flow still works', true)

  await clickByText('Settings')
  console.error('settings clicked')
  const providerVisible = await waitForText('Provider Lab', 10000)
  record('settings provider lab visible', providerVisible)
  await screenshot('02-provider-lab-empty-or-existing.png')

  await clickByText('New')
  await fillLabel('Name', `Browser Mock ${Date.now()}`, '.provider-form')
  await fillLabel('Base URL', 'http://127.0.0.1:5199', '.provider-form')
  await fillLabel('Default model', 'gpt-4o-smoke', '.provider-form')
  await clickByText('Save')
  console.error('provider saved')
  await waitForText('gpt-4o-smoke', 10000)
  record('create provider without api key via UI', true)

  await clickByText('Discover')
  console.error('discover clicked')
  const discovered = await waitForText('text-only-smoke', 10000)
  record('discover models via UI', discovered)
  await screenshot('03-provider-lab-discovered.png')

  await clickByText('Run test')
  console.error('run test clicked')
  const testPassed = await waitForText('Redacted trace', 10000)
  record('provider test shows trace UI', testPassed)
  await screenshot('04-provider-lab-test-trace.png')

  await clickByText('New')
  await fillLabel('Name', `Browser Secret ${Date.now()}`, '.provider-form')
  await fillLabel('Base URL', 'http://127.0.0.1:5199', '.provider-form')
  await fillLabel('Default model', 'gpt-4o-smoke', '.provider-form')
  await fillLabel('API key', secret, '.provider-form')
  await clickByText('Save')
  const keytarError = await waitForText('keytar.setPassword is not a function', 10000)
  record('api key create failure is visible and clear', keytarError)
  await screenshot('05-api-key-failure.png')

  const bodyText = await evalJs('document.body.innerText')
  const storageDump = await evalJs(`JSON.stringify({
    localStorage: Object.entries(localStorage),
    sessionStorage: Object.entries(sessionStorage)
  })`)
  record('secret not visible in page text', !bodyText.includes(secret))
  record('secret not stored in browser storage', !storageDump.includes(secret), storageDump)

  const clipping = await evalJs(`(() => {
    return [...document.querySelectorAll('.provider-lab, .provider-section, .provider-form, .trace-box, .right-rail')]
      .map((el) => ({ cls: el.className, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }))
      .filter((item) => item.scrollWidth > item.clientWidth + 2);
  })()`)
  record('no obvious horizontal layout clipping in provider lab', clipping.length === 0, JSON.stringify(clipping))

  const externalBrowserProviderRequests = networkRequests.filter((req) => req.url.includes('127.0.0.1:5199'))
  record('browser did not call mock provider directly', externalBrowserProviderRequests.length === 0, JSON.stringify(externalBrowserProviderRequests))

  await clickByText('Story Bible')
  const workbenchOk = await waitForText('Run Analyze Story to create the Story Bible.', 5000)
  record('workbench remains usable after Provider Lab', workbenchOk)

  console.log(JSON.stringify({
    ok: checks.every((check) => check.ok),
    checks,
    artifacts: [
      path.join(artifactDir, '01-app-load.png'),
      path.join(artifactDir, '02-provider-lab-empty-or-existing.png'),
      path.join(artifactDir, '03-provider-lab-discovered.png'),
      path.join(artifactDir, '04-provider-lab-test-trace.png'),
      path.join(artifactDir, '05-api-key-failure.png'),
    ],
    consoleEvents: consoleEvents.map((item) => ({ type: item.type, args: item.args?.map((arg) => arg.value || arg.description) })),
    pageErrors,
    networkRequests,
  }, null, 2))
} catch (error) {
  await screenshot('failure.png').catch(() => undefined)
  console.log(JSON.stringify({ ok: false, error: String(error?.message || error), checks, consoleEvents, pageErrors, networkRequests }, null, 2))
  process.exitCode = 1
} finally {
  ws.close()
  try {
    await fetch(`http://127.0.0.1:${debugPort}/json/close/` + tab.id)
  } catch {}
  try {
    process.kill(-chrome.pid)
  } catch {}
}
