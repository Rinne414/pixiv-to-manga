const http = require('http')
const zlib = require('zlib')

const requests = []
const pixivPng = createPng(320, 480, [246, 246, 246])

const server = http.createServer((req, res) => {
  let body = ''
  req.on('data', (chunk) => {
    body += chunk
  })
  req.on('end', () => {
    requests.push({
      method: req.method,
      url: req.url,
      headers: req.headers,
      body,
    })

    if (req.url === '/requests' && req.method === 'GET') {
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ requests }))
      return
    }

    if (req.url === '/requests/reset' && req.method === 'POST') {
      requests.length = 0
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ ok: true }))
      return
    }

    const url = new URL(req.url, 'http://127.0.0.1:5199')

    if (url.pathname === '/ajax/illust/123456789/pages' && req.method === 'GET') {
      res.setHeader('Content-Type', 'application/json')
      res.end(
        JSON.stringify({
          error: false,
          body: [
            {
              urls: {
                original: 'http://127.0.0.1:5199/pixiv-assets/123456789_p0.png',
              },
            },
          ],
        }),
      )
      return
    }

    if (url.pathname === '/ajax/illust/987654321/pages' && req.method === 'GET') {
      res.setHeader('Content-Type', 'application/json')
      res.end(
        JSON.stringify({
          error: false,
          body: Array.from({ length: 200 }, (_, pageIndex) => ({
            urls: {
              original: `http://127.0.0.1:5199/pixiv-assets/987654321_p${pageIndex}.png`,
            },
          })),
        }),
      )
      return
    }

    if (url.pathname === '/pixiv-assets/123456789_p0.png' && req.method === 'GET') {
      res.setHeader('Content-Type', 'image/png')
      res.end(pixivPng)
      return
    }

    res.setHeader('Content-Type', 'application/json')
    if (req.url === '/models' && req.method === 'GET') {
      res.end(
        JSON.stringify({
          data: [
            { id: 'gpt-4o-smoke', owned_by: 'mock' },
            { id: 'invalid-json-smoke', owned_by: 'mock' },
            { id: 'slow-json-smoke', owned_by: 'mock' },
            { id: 'text-only-smoke', owned_by: 'mock' },
            { id: 'qwen-vl-smoke', owned_by: 'mock' },
          ],
        }),
      )
      return
    }

    if (req.url === '/chat/completions' && req.method === 'POST') {
      let parsedBody = {}
      try {
        parsedBody = JSON.parse(body)
      } catch {
        parsedBody = {}
      }
      const content =
        parsedBody && parsedBody.model === 'invalid-json-smoke'
          ? 'invalid-json-smoke output that is not valid JSON'
          : '{"ok":true}'
      const sendChatResponse = () => {
        if (parsedBody && parsedBody.stream) {
          res.setHeader('Content-Type', 'text/event-stream')
          res.end(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`)
        } else {
          res.end(
            JSON.stringify({
              id: 'mock-chatcmpl',
              object: 'chat.completion',
              choices: [{ message: { role: 'assistant', content } }],
              receivedAuthorization: req.headers.authorization || null,
              requestEcho: body,
            }),
          )
      }
      }
      if (parsedBody && parsedBody.model === 'slow-json-smoke') {
        setTimeout(sendChatResponse, 3000)
        return
      }
      sendChatResponse()
      return
    }

    res.statusCode = 404
    res.end(JSON.stringify({ error: 'not found', url: req.url }))
  })
})

server.listen(5199, '127.0.0.1', () => {
  console.log('mock provider listening on http://127.0.0.1:5199')
})

function createPng(width, height, rgb) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  const row = Buffer.alloc(1 + width * 3)
  row[0] = 0
  for (let offset = 1; offset < row.length; offset += 3) {
    row[offset] = rgb[0]
    row[offset + 1] = rgb[1]
    row[offset + 2] = rgb[2]
  }
  const raw = Buffer.concat(Array.from({ length: height }, () => row))

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii')
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0)
  return Buffer.concat([length, typeBuffer, data, crc])
}

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}
