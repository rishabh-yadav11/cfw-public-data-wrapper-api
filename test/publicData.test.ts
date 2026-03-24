import { describe, it, expect, vi } from 'vitest'
import app from '../src/index'
import { hashApiKey } from '../src/utils/crypto'

const mockKV = {
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn()
}

const mockEnv = { KV: mockKV }

describe('Public Data API', () => {
    it('should return 401 without API key', async () => {
        const req = new Request('http://localhost/v1/public/cities')
        const res = await app.fetch(req, mockEnv as any)
        expect(res.status).toBe(401)
        const json: any = await res.json()
        expect(json.ok).toBe(false)
        expect(json.error.code).toBe('unauthorized')
    })

    it('should fetch cities with valid key', async () => {
        const req = new Request('http://localhost/v1/public/cities?page=1&limit=2')
        req.headers.set('Authorization', 'Bearer valid_key')
        
        const hashedKey = await hashApiKey('valid_key')
        mockKV.get.mockImplementation(async (key) => {
            if (key === `apikey:${hashedKey}`) {
                return JSON.stringify({
                    key_id: 'k1',
                    plan: 'free',
                    scopes: ['publicdata:read'],
                    status: 'active'
                })
            }
            return null
        })

        const res = await app.fetch(req, mockEnv as any)
        expect(res.status).toBe(200)
        const json: any = await res.json()
        expect(json.ok).toBe(true)
        expect(json.data.length).toBe(2)
        expect(json.meta.page).toBe(1)
        expect(json.meta.total).toBe(5)
    })

    it('should search cities', async () => {
        const req = new Request('http://localhost/v1/public/cities/search?q=tokyo')
        req.headers.set('Authorization', 'Bearer valid_key')

        const hashedKey = await hashApiKey('valid_key')
        mockKV.get.mockImplementation(async (key) => {
            if (key === `apikey:${hashedKey}`) {
                return JSON.stringify({
                    key_id: 'k1',
                    plan: 'free',
                    scopes: ['publicdata:read'],
                    status: 'active'
                })
            }
            return null
        })

        const res = await app.fetch(req, mockEnv as any)
        expect(res.status).toBe(200)
        const json: any = await res.json()
        expect(json.ok).toBe(true)
        expect(json.data[0].name).toBe('Tokyo')
    })

    it('should return 404 for unknown dataset', async () => {
        const req = new Request('http://localhost/v1/public/unknown_dataset')
        req.headers.set('Authorization', 'Bearer valid_key')
        
        const hashedKey = await hashApiKey('valid_key')
        mockKV.get.mockImplementation(async (key) => {
            if (key === `apikey:${hashedKey}`) {
                return JSON.stringify({
                    key_id: 'k1',
                    plan: 'free',
                    scopes: ['publicdata:read'],
                    status: 'active'
                })
            }
            return null
        })

        const res = await app.fetch(req, mockEnv as any)
        expect(res.status).toBe(404)
        const json: any = await res.json()
        expect(json.ok).toBe(false)
        expect(json.error.code).toBe('not_found')
    })
})
