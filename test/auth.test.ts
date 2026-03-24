import { describe, it, expect, vi } from 'vitest'
import app from '../src/index'
import { hashApiKey } from '../src/utils/crypto'

const mockKV = {
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn()
}

const mockEnv = { KV: mockKV }

describe('Auth & Rate Limit', () => {
    it('should block requests without auth header', async () => {
        const req = new Request('http://localhost/v1/metadata')
        const res = await app.fetch(req, mockEnv as any)
        expect(res.status).toBe(401)
        const json: any = await res.json()
        expect(json.error.code).toBe('unauthorized')
    })

    it('should block revoked keys', async () => {
        const req = new Request('http://localhost/v1/metadata')
        req.headers.set('Authorization', 'Bearer revoked_key')
        
        const hashedKey = await hashApiKey('revoked_key')
        mockKV.get.mockImplementation(async (key) => {
            if (key === `apikey:${hashedKey}`) {
                return JSON.stringify({
                    key_id: 'k2',
                    plan: 'free',
                    scopes: ['metadata:read'],
                    status: 'revoked'
                })
            }
            return null
        })

        const res = await app.fetch(req, mockEnv as any)
        expect(res.status).toBe(401)
        const json: any = await res.json()
        expect(json.error.message).toBe('API key is revoked')
    })
    
    it('should enforce rate limits', async () => {
         const req = new Request('http://localhost/v1/metadata')
         req.headers.set('Authorization', 'Bearer limit_key')
         
         const hashedKey = await hashApiKey('limit_key')
         mockKV.get.mockImplementation(async (key) => {
             if (key === `apikey:${hashedKey}`) {
                 return JSON.stringify({
                     key_id: 'k3',
                     plan: 'free',
                     scopes: ['metadata:read'],
                     status: 'active'
                 })
             }
             if (key.startsWith('ratelimit:k3')) {
                  // Mock empty bucket
                  return JSON.stringify({ tokens: 0, last_refill: Date.now() })
             }
             return null
         })
 
         const res = await app.fetch(req, mockEnv as any)
         expect(res.status).toBe(429)
         const json: any = await res.json()
         expect(json.error.code).toBe('rate_limit_exceeded')
         expect(res.headers.has('Retry-After')).toBe(true)
    })
})
