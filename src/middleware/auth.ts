import { createMiddleware } from 'hono/factory'
import { hashApiKey } from '../utils/crypto'
import { errorResponse } from '../utils/response'

type Env = {
  KV: KVNamespace
}

export type ApiKeyMeta = {
  key_id: string
  prefix: string
  plan: 'free' | 'pro' | 'agency' | 'admin'
  scopes: string[]
  status: 'active' | 'revoked' | 'expired'
  created_at: number
  last_used_at?: number
}

export const auth = createMiddleware<{ Bindings: Env, Variables: { apiKey: ApiKeyMeta, apiKeyHash: string } }>(async (c, next) => {
  const authHeader = c.req.header('Authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return errorResponse(c, 401, 'unauthorized', 'Missing or invalid Authorization header')
  }

  const token = authHeader.slice(7)
  const hashedToken = await hashApiKey(token)

  const metaStr = await c.env.KV.get(`apikey:${hashedToken}`)
  if (!metaStr) {
    return errorResponse(c, 401, 'unauthorized', 'Invalid API key')
  }

  const meta: ApiKeyMeta = JSON.parse(metaStr)

  if (meta.status !== 'active') {
    return errorResponse(c, 401, 'unauthorized', `API key is ${meta.status}`)
  }

  // Admin Keys IP Allowlist (Mock Implementation for demo)
  if (meta.plan === 'admin') {
     const clientIP = c.req.header('CF-Connecting-IP') || 'unknown'
     const allowedIPsStr = await c.env.KV.get('admin:allowlist')
     const allowedIPs = allowedIPsStr ? JSON.parse(allowedIPsStr) : []
     if (!allowedIPs.includes(clientIP)) {
         return errorResponse(c, 403, 'forbidden', 'IP not allowed for admin key')
     }
  }

  // Check scopes (Metadata Read or PublicData Read)
  const path = new URL(c.req.url).pathname
  if (path.startsWith('/v1/metadata') || path.startsWith('/v1/favicon') || path.startsWith('/v1/schema')) {
    if (!meta.scopes.includes('metadata:read') && !meta.scopes.includes('admin')) {
      return errorResponse(c, 403, 'forbidden', 'Missing metadata:read scope')
    }
  } else if (path.startsWith('/v1/public')) {
    if (!meta.scopes.includes('publicdata:read') && !meta.scopes.includes('admin')) {
      return errorResponse(c, 403, 'forbidden', 'Missing publicdata:read scope')
    }
  }

  meta.last_used_at = Date.now()
  try {
    c.executionCtx.waitUntil(c.env.KV.put(`apikey:${hashedToken}`, JSON.stringify(meta)))
  } catch (e) {
    // In some test environments, executionCtx might not be fully mocked
    await c.env.KV.put(`apikey:${hashedToken}`, JSON.stringify(meta))
  }

  c.set('apiKey', meta)
  c.set('apiKeyHash', hashedToken)
  
  await next()
})
