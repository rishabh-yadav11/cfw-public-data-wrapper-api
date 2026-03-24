import { Context } from 'hono'

export function successResponse(c: Context, data: any, meta?: any) {
  const requestId = c.get('requestId') || 'unknown'
  return c.json({ ok: true, data, meta, request_id: requestId })
}

export function errorResponse(c: Context, statusCode: any, code: string, message: string) {
  const requestId = c.get('requestId') || 'unknown'
  return c.json({ ok: false, error: { code, message }, request_id: requestId }, statusCode as any)
}
