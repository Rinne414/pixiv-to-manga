const http = require('http')

const server = http.createServer((req, res) => {
  let body = ''
  req.on('data', (chunk) => {
    body += chunk
  })
  req.on('end', () => {
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
      if (parsedBody && parsedBody.model === 'slow-json-smoke') {
        setTimeout(() => {
          res.end(
            JSON.stringify({
              id: 'mock-chatcmpl',
              object: 'chat.completion',
              choices: [{ message: { role: 'assistant', content } }],
              receivedAuthorization: req.headers.authorization || null,
              requestEcho: body,
            }),
          )
        }, 3000)
        return
      }
      res.end(
        JSON.stringify({
          id: 'mock-chatcmpl',
          object: 'chat.completion',
          choices: [{ message: { role: 'assistant', content } }],
          receivedAuthorization: req.headers.authorization || null,
          requestEcho: body,
        }),
      )
      return
    }

    res.statusCode = 404
    res.end(JSON.stringify({ error: 'not found', url: req.url }))
  })
})

server.listen(5199, '127.0.0.1', () => {
  console.log('mock provider listening on http://127.0.0.1:5199')
})
