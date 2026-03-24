import { Hono } from 'hono'
import { errorResponse, successResponse } from './utils/response'
import { requestId } from './middleware/requestId'
import { auth } from './middleware/auth'
import { rateLimit } from './middleware/rateLimit'
import { security } from './middleware/security'
import { cors } from 'hono/cors'

import metadataApp from './routes/metadata'
import publicDataApp from './routes/publicData'

type Bindings = {
  KV: KVNamespace
}

const app = new Hono<{ Bindings: Bindings }>()

// Global Middleware
app.use('*', requestId)
app.use('*', cors({
  origin: (origin) => {
    // Basic Server-to-Server and Dashboard Allowlist
    const allowedOrigins = ['https://dashboard.example.com']
    if (origin && allowedOrigins.includes(origin)) {
      return origin
    }
    return '' // Block otherwise or let server-to-server pass (if no origin header)
  },
}))
app.use('*', security)

// OpenAPI Schema Mock
app.get('/openapi.json', (c) => {
  return c.json({
    openapi: '3.0.0',
    info: {
      title: 'Public Data Wrapper API',
      version: '1.0.0',
      description: 'Wrap public datasets and fetch website metadata safely.'
    },
    paths: {
      '/v1/metadata': {
        get: {
          summary: 'Fetch website metadata',
          parameters: [{ name: 'url', in: 'query', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Success' } }
        }
      },
      '/v1/public/cities': {
        get: {
          summary: 'List cities dataset',
          parameters: [
              { name: 'page', in: 'query', schema: { type: 'integer' } },
              { name: 'limit', in: 'query', schema: { type: 'integer' } }
          ],
          responses: { '200': { description: 'Success' } }
        }
      }
    }
  })
})

// Apply Auth & Rate Limit to /v1/*
app.use('/v1/*', auth)
app.use('/v1/*', rateLimit)

// Register Routers
app.route('/v1', metadataApp)
app.route('/v1/public', publicDataApp)

// Global Error Handler
app.onError((err, c) => {
  console.error(`[Error] ${err.message}`, err)
  // Ensure no stack traces are sent to the client
  return errorResponse(c, 500, 'internal_server_error', 'An unexpected error occurred')
})

app.notFound((c) => {
  return errorResponse(c, 404, 'not_found', 'Route not found')
})

app.get('/', (c) => successResponse(c, { message: 'Public Data Wrapper API' }))

export default app
