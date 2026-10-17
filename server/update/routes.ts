import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { isTrustedLocalRequest } from './guard'
import type { UpdateManager } from './service'

const settingsSchema = z.object({ autoCheck: z.boolean() })

export function registerUpdateRoutes(server: FastifyInstance, deps: { updates: UpdateManager }): void {
  const { updates } = deps
  // Scoped so the origin guard covers only the update endpoints.
  void server.register(async (scope) => {
    scope.addHook('onRequest', async (request, reply) => {
      // Anything that changes state also has to come from the page served by this very server port.
      const strict = request.method !== 'GET'
      if (!isTrustedLocalRequest(request.headers, { requireSamePort: strict })) {
        await reply.status(403).send({ error: 'Update requests are only accepted from this computer.' })
      }
    })

    scope.get('/api/update/status', async () => updates.status())

    scope.post('/api/update/check', async () => updates.check())

    scope.post('/api/update/install', async (_request, reply) => {
      updates.startInstall()
      return reply.status(202).send(updates.status())
    })

    scope.put('/api/update/settings', async (request) => {
      const input = settingsSchema.parse(request.body)
      return updates.setAutoCheck(input.autoCheck)
    })
  })
}
