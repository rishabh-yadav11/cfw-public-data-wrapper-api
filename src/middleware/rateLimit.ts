import { createMiddleware } from 'hono/factory'
import { errorResponse } from '../utils/response'
import { ApiKeyMeta } from './auth'

export const rateLimit = createMiddleware<{ Bindings: { KV: KVNamespace }, Variables: { apiKey: ApiKeyMeta } }>(async (c, next) => {
  const ip = c.req.header('CF-Connecting-IP') || '127.0.0.1'
  const meta = c.get('apiKey')
  
  if (!meta) {
      return errorResponse(c, 401, 'unauthorized', 'API Key not found')
  }

  // Rate Limiting Logic (Simplified Token Bucket using KV)
  const limits = {
      free: { rpm: 60, burst: 10, daily: 5000 },
      pro: { rpm: 300, burst: 30, daily: 100000 },
      agency: { rpm: 1000, burst: 100, daily: -1 },
      admin: { rpm: -1, burst: -1, daily: -1 }
  }

  const plan = limits[meta.plan]
  
  // Skip rate limits for admin
  if (plan.rpm === -1) {
      await next()
      return
  }

  const now = Date.now()
  const bucketKey = `ratelimit:${meta.key_id}:${ip}`
  const dailyKey = `ratelimit:daily:${meta.key_id}:${new Date().toISOString().split('T')[0]}`

  // Fetch current state
  const bucketStateStr = await c.env.KV.get(bucketKey)
  let bucketState = bucketStateStr ? JSON.parse(bucketStateStr) : { tokens: plan.burst, last_refill: now }
  
  const dailyStateStr = await c.env.KV.get(dailyKey)
  let dailyState = dailyStateStr ? parseInt(dailyStateStr, 10) : 0

  // Check Daily Limits
  if (plan.daily !== -1 && dailyState >= plan.daily) {
      return errorResponse(c, 429, 'rate_limit_exceeded', 'Daily rate limit exceeded')
  }

  // Refill Tokens
  const elapsedTime = now - bucketState.last_refill
  const refillAmount = (elapsedTime / 60000) * plan.rpm
  bucketState.tokens = Math.min(plan.burst, bucketState.tokens + refillAmount)
  bucketState.last_refill = now

  // Consume Token
  if (bucketState.tokens < 1) {
      const retryAfter = Math.ceil((1 - bucketState.tokens) * (60 / plan.rpm))
      c.res.headers.set('Retry-After', retryAfter.toString())
      c.res.headers.set('X-RateLimit-Limit', plan.rpm.toString())
      c.res.headers.set('X-RateLimit-Remaining', '0')
      c.res.headers.set('X-RateLimit-Reset', (now + retryAfter * 1000).toString())
      return errorResponse(c, 429, 'rate_limit_exceeded', 'Rate limit exceeded')
  }

  bucketState.tokens -= 1
  dailyState += 1

  // Save state
  try {
    c.executionCtx.waitUntil(c.env.KV.put(bucketKey, JSON.stringify(bucketState), { expirationTtl: 60 }))
    c.executionCtx.waitUntil(c.env.KV.put(dailyKey, dailyState.toString(), { expirationTtl: 86400 }))
  } catch (e) {
    await c.env.KV.put(bucketKey, JSON.stringify(bucketState), { expirationTtl: 60 })
    await c.env.KV.put(dailyKey, dailyState.toString(), { expirationTtl: 86400 })
  }

  c.res.headers.set('X-RateLimit-Limit', plan.rpm.toString())
  c.res.headers.set('X-RateLimit-Remaining', Math.floor(bucketState.tokens).toString())

  await next()
})
