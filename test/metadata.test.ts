import { describe, it, expect, vi } from 'vitest'
import app from '../src/index'
import { hashApiKey } from '../src/utils/crypto'
import * as fetcher from '../src/services/fetcher'

const mockKV = {
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn()
}

const mockEnv = { KV: mockKV }

describe('Metadata API', () => {
    it('should fetch metadata for valid URL', async () => {
        const req = new Request('http://localhost/v1/metadata?url=https://example.com')
        req.headers.set('Authorization', 'Bearer valid_key')
        
        const hashedKey = await hashApiKey('valid_key')
        mockKV.get.mockImplementation(async (key) => {
            if (key === `apikey:${hashedKey}`) {
                return JSON.stringify({
                    key_id: 'k1',
                    plan: 'free',
                    scopes: ['metadata:read'],
                    status: 'active'
                })
            }
            return null
        })

        // Mock safeFetch
        vi.spyOn(fetcher, 'safeFetch').mockResolvedValue(new Response('<html><head><title>Test Title</title></head><body></body></html>'))

        const res = await app.fetch(req, mockEnv as any)
        expect(res.status).toBe(200)
        const json: any = await res.json()
        expect(json.ok).toBe(true)
        expect(json.data.title).toBe('Test Title')
    })

    it('should block local IP SSRF', async () => {
        const req = new Request('http://localhost/v1/metadata?url=http://127.0.0.1/admin')
        req.headers.set('Authorization', 'Bearer valid_key')
        
        // Ensure mock returns for valid_key
        const hashedKey = await hashApiKey('valid_key')
        mockKV.get.mockImplementation(async (key) => {
            if (key === `apikey:${hashedKey}`) {
                return JSON.stringify({
                    key_id: 'k1',
                    plan: 'free',
                    scopes: ['metadata:read'],
                    status: 'active'
                })
            }
            if (key.startsWith('ratelimit:k1')) {
                return JSON.stringify({ tokens: 10, last_refill: Date.now() })
            }
            return null
        })

        // Restore safeFetch to run actual SSRF check logic, just mocking network call
        vi.restoreAllMocks()
        // re-apply mock for valid_key after restoreAllMocks
        mockKV.get.mockImplementation(async (key) => {
            if (key === `apikey:${hashedKey}`) {
                return JSON.stringify({
                    key_id: 'k1',
                    plan: 'free',
                    scopes: ['metadata:read'],
                    status: 'active'
                })
            }
            if (key.startsWith('ratelimit:k1')) {
                return JSON.stringify({ tokens: 10, last_refill: Date.now() })
            }
            return null
        })


        const res = await app.fetch(req, mockEnv as any)
        expect(res.status).toBe(400)
        const json: any = await res.json()
        expect(json.ok).toBe(false)
        expect(json.error.code).toBe('ssrf_blocked')
    })
})
