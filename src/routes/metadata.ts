import { Hono } from 'hono'
import { z } from 'zod'
import { safeFetch, SafeFetchError } from '../services/fetcher'
import { errorResponse, successResponse } from '../utils/response'

const metadataApp = new Hono<{ Bindings: { KV: KVNamespace } }>()

const urlSchema = z.string().url().max(2048)

const fetchAndParseHtml = async (urlStr: string) => {
    const response = await safeFetch(urlStr)
    const html = await response.text()
    
    // Simple RegEx parsing for demo, in production consider a robust HTML parser if needed (but CFW environment is limited)
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i)
    const descriptionMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["'][^>]*>/i)
    const canonicalMatch = html.match(/<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["'][^>]*>/i)
    const langMatch = html.match(/<html[^>]*lang=["']([^"']+)["'][^>]*>/i)
    const faviconMatch = html.match(/<link[^>]*rel=["'](?:shortcut )?icon["'][^>]*href=["']([^"']+)["'][^>]*>/i)
    const robotsMatch = html.match(/<meta[^>]*name=["']robots["'][^>]*content=["']([^"']+)["'][^>]*>/i)
    
    // OG Tags
    const ogTags: Record<string, string> = {}
    const ogRegex = /<meta[^>]*property=["']og:([^"']+)["'][^>]*content=["']([^"']+)["'][^>]*>/gi
    let match
    while ((match = ogRegex.exec(html)) !== null) {
        ogTags[match[1]] = match[2]
    }

    // Schema Summary (Basic extraction of first structured data block)
    const schemaMatch = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i)
    let schemaSummary = null
    if (schemaMatch && schemaMatch[1]) {
        try {
            const parsed = JSON.parse(schemaMatch[1])
            schemaSummary = parsed['@type'] || 'unknown'
        } catch(e) { /* ignore parse error */ }
    }

    const faviconUrl = faviconMatch ? new URL(faviconMatch[1], urlStr).toString() : new URL('/favicon.ico', urlStr).toString()

    return {
        title: titleMatch ? titleMatch[1].trim() : null,
        description: descriptionMatch ? descriptionMatch[1].trim() : null,
        canonical: canonicalMatch ? canonicalMatch[1].trim() : null,
        lang: langMatch ? langMatch[1].trim() : null,
        favicon: faviconUrl,
        robots: robotsMatch ? robotsMatch[1].trim() : null,
        og: ogTags,
        schema: schemaSummary
    }
}

// Caching Helper
const CACHE_TTL = 6 * 60 * 60 // 6 hours

const getCachedOrFetch = async (c: any, url: string, type: string, fetcher: () => Promise<any>) => {
    const cacheKey = `cache:metadata:${type}:${await crypto.subtle.digest('SHA-256', new TextEncoder().encode(url)).then(b => Array.from(new Uint8Array(b)).map(b => b.toString(16).padStart(2, '0')).join(''))}`
    const cached = await c.env.KV.get(cacheKey)
    if (cached) {
        return JSON.parse(cached)
    }

    const data = await fetcher()
    try {
        c.executionCtx.waitUntil(c.env.KV.put(cacheKey, JSON.stringify(data), { expirationTtl: CACHE_TTL }))
    } catch (e) {
        await c.env.KV.put(cacheKey, JSON.stringify(data), { expirationTtl: CACHE_TTL })
    }
    return data
}

metadataApp.get('/metadata', async (c) => {
    const urlParam = c.req.query('url')
    const parseResult = urlSchema.safeParse(urlParam)

    if (!parseResult.success) {
        return errorResponse(c, 400, 'invalid_input', 'Invalid or missing URL parameter')
    }

    try {
        const url = parseResult.data
        const data = await getCachedOrFetch(c, url, 'full', () => fetchAndParseHtml(url))
        return successResponse(c, data)
    } catch (error: any) {
        if (error instanceof SafeFetchError) {
            return errorResponse(c, 400, error.code, error.message)
        }
        return errorResponse(c, 500, 'fetch_failed', 'Failed to fetch or parse metadata')
    }
})

metadataApp.get('/favicon', async (c) => {
    const urlParam = c.req.query('url')
    const parseResult = urlSchema.safeParse(urlParam)

    if (!parseResult.success) {
        return errorResponse(c, 400, 'invalid_input', 'Invalid or missing URL parameter')
    }

    try {
        const url = parseResult.data
        const data = await getCachedOrFetch(c, url, 'favicon', async () => {
            const parsed = await fetchAndParseHtml(url)
            return { favicon: parsed.favicon }
        })
        return successResponse(c, data)
    } catch (error: any) {
        if (error instanceof SafeFetchError) {
            return errorResponse(c, 400, error.code, error.message)
        }
        return errorResponse(c, 500, 'fetch_failed', 'Failed to fetch favicon')
    }
})

metadataApp.get('/schema', async (c) => {
    const urlParam = c.req.query('url')
    const parseResult = urlSchema.safeParse(urlParam)

    if (!parseResult.success) {
        return errorResponse(c, 400, 'invalid_input', 'Invalid or missing URL parameter')
    }

    try {
        const url = parseResult.data
        const data = await getCachedOrFetch(c, url, 'schema', async () => {
            const parsed = await fetchAndParseHtml(url)
            return { schema: parsed.schema }
        })
        return successResponse(c, data)
    } catch (error: any) {
        if (error instanceof SafeFetchError) {
            return errorResponse(c, 400, error.code, error.message)
        }
        return errorResponse(c, 500, 'fetch_failed', 'Failed to fetch schema')
    }
})

const batchSchema = z.object({
    urls: z.array(z.string().url().max(2048)).max(50)
})

metadataApp.post('/metadata/batch', async (c) => {
    let body
    try {
        body = await c.req.json()
    } catch (e) {
        return errorResponse(c, 400, 'invalid_json', 'Request body must be valid JSON')
    }

    const parseResult = batchSchema.safeParse(body)
    if (!parseResult.success) {
        return errorResponse(c, 400, 'invalid_input', 'Invalid URLs array (max 50 items)')
    }

    const urls = parseResult.data.urls
    const results = await Promise.all(urls.map(async (url) => {
        try {
            return await getCachedOrFetch(c, url, 'full', () => fetchAndParseHtml(url))
        } catch (error: any) {
            return { error: error.message || 'Failed to fetch' }
        }
    }))

    return successResponse(c, results)
})

export default metadataApp
