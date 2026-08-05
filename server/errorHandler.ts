import type { FastifyInstance } from 'fastify'
import { ZodError } from 'zod'

export function registerStudioErrorHandler(server: FastifyInstance): void {
  server.setErrorHandler((error, _request, reply) => {
    const message = error instanceof ZodError
      ? `Invalid request: ${error.issues
          .slice(0, 3)
          .map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`)
          .join('; ')}`
      : error instanceof Error
        ? error.message
        : 'Request failed with a non-Error value'
    const statusCode = error instanceof ZodError ? 400 : errorStatusCode(error)
    server.log.error({ message, statusCode }, 'Request failed')
    reply.status(statusCode).send({ error: message })
  })
}

function errorStatusCode(error: unknown): number {
  if (!error || typeof error !== 'object' || !('statusCode' in error)) return 400
  const statusCode = error.statusCode
  return typeof statusCode === 'number' && Number.isInteger(statusCode) && statusCode >= 400 && statusCode <= 599 ? statusCode : 400
}
