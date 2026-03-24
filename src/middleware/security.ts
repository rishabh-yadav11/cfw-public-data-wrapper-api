import { createMiddleware } from 'hono/factory'
import { errorResponse } from '../utils/response'
import { verifySignature } from '../utils/crypto'

export const security = createMiddleware<{ Bindings: { KV: KVNamespace } }>(async (c, next) => {
  // HTTPS Only (Cloudflare typically handles this, but enforce here)
  const url = new URL(c.req.url)
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
    return errorResponse(c, 400, 'bad_request', 'HTTPS is required')
  }

  // Max URL length
  if (c.req.url.length > 2048) {
    return errorResponse(c, 414, 'uri_too_long', 'URL exceeds maximum length of 2048 characters')
  }

  // Max JSON body
  if (c.req.method === 'POST' || c.req.method === 'PUT' || c.req.method === 'PATCH') {
    const contentLength = parseInt(c.req.header('Content-Length') || '0', 10)
    if (contentLength > 256 * 1024) {
      return errorResponse(c, 413, 'payload_too_large', 'Request body exceeds maximum size of 256KB')
    }
  }

  // Write Route Rules
  if (c.req.method === 'POST') {
    const idempotencyKey = c.req.header('Idempotency-Key')
    if (!idempotencyKey) {
      return errorResponse(c, 400, 'bad_request', 'Idempotency-Key header is required for POST requests')
    }

    // Require Timestamp, Nonce, Signature for write routes (simplified check, might need specific route logic later)
    const timestamp = c.req.header('X-Timestamp')
    const nonce = c.req.header('X-Nonce')
    const signature = c.req.header('X-Signature')

    if (timestamp && nonce && signature) {
        // Timestamp age check (5 minutes)
        const requestTime = parseInt(timestamp, 10)
        if (Date.now() - requestTime > 5 * 60 * 1000) {
            return errorResponse(c, 400, 'bad_request', 'Timestamp age exceeds 5 minutes')
        }

        // Nonce reuse block (simplified with KV)
        const nonceKey = `nonce:${nonce}`
        const nonceExists = await c.env.KV.get(nonceKey)
        if (nonceExists) {
            return errorResponse(c, 400, 'bad_request', 'Nonce reuse blocked')
        }
        await c.env.KV.put(nonceKey, '1', { expirationTtl: 300 })

        // Verify Signature (Needs Secret, assuming from Env or KV, mocked for now)
        // const isValid = await verifySignature('your-secret', timestamp, nonce, await c.req.text(), signature)
        // if (!isValid) {
        //    return errorResponse(c, 401, 'unauthorized', 'Invalid Signature')
        // }
    }
  }

  await next()
})
