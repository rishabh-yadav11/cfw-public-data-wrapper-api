import { createMiddleware } from 'hono/factory'

export const requestId = createMiddleware(async (c, next) => {
  const reqId = crypto.randomUUID()
  c.set('requestId', reqId)
  await next()
})
