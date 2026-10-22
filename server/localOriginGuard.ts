import type { FastifyInstance } from 'fastify'
import { isTrustedLocalRequest } from './update/guard'

const GUARDED_ROUTE_PREFIXES = ['/api/', '/assets/']

export interface LocalOriginGuardOptions {
  /** Packaged builds: state-changing calls must come from the page served by this very port. */
  strictWrites: boolean
}

/**
 * The server listens on 127.0.0.1 only, yet any web page open in the browser can still reach it,
 * through DNS rebinding (a foreign Host) or a cross-site request. The API and `/assets/` (the whole
 * data folder) therefore answer only this computer's own Studio page. The built client stays open
 * so a bookmark or link to the Studio still loads it.
 */
export function registerLocalOriginGuard(server: FastifyInstance, options: LocalOriginGuardOptions): void {
  server.addHook('onRequest', async (request, reply) => {
    // The matched route pattern, so percent-encoded paths cannot slip past a prefix check.
    const route = request.routeOptions.url
    if (!route || !GUARDED_ROUTE_PREFIXES.some((prefix) => route.startsWith(prefix))) return
    const isRead = request.method === 'GET' || request.method === 'HEAD'
    if (!isTrustedLocalRequest(request.headers, { requireSamePort: options.strictWrites && !isRead })) {
      await reply.status(403).send({ error: 'Requests are only accepted from the Studio page on this computer.' })
    }
  })
}
