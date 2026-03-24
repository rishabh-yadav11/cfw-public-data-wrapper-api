import { Hono } from 'hono'
import { z } from 'zod'
import { errorResponse, successResponse } from '../utils/response'

const publicDataApp = new Hono<{ Bindings: { KV: KVNamespace } }>()

// Mock Internal Datasets
const datasets: Record<string, any[]> = {
  cities: [
    { id: 'c1', name: 'New York', population: 8419000, country: 'USA' },
    { id: 'c2', name: 'Tokyo', population: 13929286, country: 'Japan' },
    { id: 'c3', name: 'London', population: 8982000, country: 'UK' },
    { id: 'c4', name: 'Paris', population: 2161000, country: 'France' },
    { id: 'c5', name: 'Berlin', population: 3645000, country: 'Germany' }
  ]
}

const ALLOWED_DATASETS = ['cities']

const datasetParamSchema = z.enum(['cities']) // Add more as datasets grow

// Cache TTL Map
const TTL_MAP: Record<string, number> = {
  cities: 3600 // 1 hour
}

publicDataApp.get('/:dataset', async (c) => {
  const datasetName = c.req.param('dataset')
  const parseResult = datasetParamSchema.safeParse(datasetName)
  
  if (!parseResult.success) {
    return errorResponse(c, 404, 'not_found', 'Dataset not found or not allowlisted')
  }

  const page = parseInt(c.req.query('page') || '1', 10)
  const limit = parseInt(c.req.query('limit') || '10', 10)

  if (isNaN(page) || page < 1 || isNaN(limit) || limit < 1 || limit > 100) {
     return errorResponse(c, 400, 'invalid_query', 'Invalid page or limit')
  }

  const data = datasets[datasetName]
  const start = (page - 1) * limit
  const end = start + limit
  
  const items = data.slice(start, end)
  
  // Example Cache
  const cacheKey = `cache:publicdata:${datasetName}:list:p${page}l${limit}`
  const cached = await c.env.KV.get(cacheKey)
  if (cached) {
      const parsed = JSON.parse(cached)
      return successResponse(c, parsed.items, parsed.meta)
  }

  const meta = { total: data.length, page, limit, pages: Math.ceil(data.length / limit) }
  
  try {
      c.executionCtx.waitUntil(c.env.KV.put(cacheKey, JSON.stringify({ items, meta }), { expirationTtl: TTL_MAP[datasetName] }))
  } catch (e) {
      await c.env.KV.put(cacheKey, JSON.stringify({ items, meta }), { expirationTtl: TTL_MAP[datasetName] })
  }

  return successResponse(c, items, meta)
})

publicDataApp.get('/:dataset/search', async (c) => {
  const datasetName = c.req.param('dataset')
  
  if (!ALLOWED_DATASETS.includes(datasetName)) {
    return errorResponse(c, 404, 'not_found', 'Dataset not found or not allowlisted')
  }

  const query = c.req.query('q')
  if (!query) {
      return errorResponse(c, 400, 'invalid_query', 'Query parameter "q" is required')
  }

  const data = datasets[datasetName]
  const results = data.filter(item => JSON.stringify(item).toLowerCase().includes(query.toLowerCase()))

  // Example Cache
  const cacheKey = `cache:publicdata:${datasetName}:search:${query}`
  const cached = await c.env.KV.get(cacheKey)
  if (cached) {
      return successResponse(c, JSON.parse(cached), { total: JSON.parse(cached).length })
  }

  try {
      c.executionCtx.waitUntil(c.env.KV.put(cacheKey, JSON.stringify(results), { expirationTtl: TTL_MAP[datasetName] }))
  } catch(e) {
      await c.env.KV.put(cacheKey, JSON.stringify(results), { expirationTtl: TTL_MAP[datasetName] })
  }

  return successResponse(c, results, { total: results.length })
})

publicDataApp.get('/:dataset/:id', async (c) => {
  const datasetName = c.req.param('dataset')
  const id = c.req.param('id')
  
  if (!ALLOWED_DATASETS.includes(datasetName)) {
    return errorResponse(c, 404, 'not_found', 'Dataset not found or not allowlisted')
  }

  const data = datasets[datasetName]
  const item = data.find(i => i.id === id)

  if (!item) {
    return errorResponse(c, 404, 'not_found', 'Item not found')
  }

  // Example Cache
  const cacheKey = `cache:publicdata:${datasetName}:id:${id}`
  const cached = await c.env.KV.get(cacheKey)
  if (cached) {
      return successResponse(c, JSON.parse(cached))
  }

  try {
      c.executionCtx.waitUntil(c.env.KV.put(cacheKey, JSON.stringify(item), { expirationTtl: TTL_MAP[datasetName] }))
  } catch(e) {
      await c.env.KV.put(cacheKey, JSON.stringify(item), { expirationTtl: TTL_MAP[datasetName] })
  }

  return successResponse(c, item)
})

publicDataApp.post('/:dataset/query', async (c) => {
  const datasetName = c.req.param('dataset')
  
  if (!ALLOWED_DATASETS.includes(datasetName)) {
    return errorResponse(c, 404, 'not_found', 'Dataset not found or not allowlisted')
  }

  let body
  try {
      body = await c.req.json()
  } catch (e) {
      return errorResponse(c, 400, 'invalid_json', 'Request body must be valid JSON')
  }

  const querySchema = z.object({
      filter: z.record(z.any()).optional(),
      sort: z.string().optional()
  })

  const parseResult = querySchema.safeParse(body)
  if (!parseResult.success) {
      return errorResponse(c, 400, 'invalid_input', 'Invalid query body')
  }

  let data = [...datasets[datasetName]]

  if (parseResult.data.filter) {
      const filters = parseResult.data.filter
      data = data.filter(item => {
          return Object.entries(filters).every(([key, value]) => item[key] === value)
      })
  }

  if (parseResult.data.sort) {
      const sortKey = parseResult.data.sort
      data.sort((a, b) => {
          if (a[sortKey] < b[sortKey]) return -1
          if (a[sortKey] > b[sortKey]) return 1
          return 0
      })
  }

  return successResponse(c, data, { total: data.length })
})

export default publicDataApp
