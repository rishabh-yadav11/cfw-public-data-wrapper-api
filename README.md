# Public Data Wrapper API

Wrap one or more public datasets into clean JSON with filter, pagination, cache, and stable field names, plus safe website metadata fetching.

## Features
- **Public Data API:** Fetch, paginate, and search structured public datasets securely.
- **Website Metadata API:** Safely fetch webpage metadata (Title, Open Graph, Schema) with built-in SSRF guards.
- **Security Baseline:**
  - Strict input validation with `zod`.
  - Content-size limits (max 256KB body) and URL length checks (max 2048 chars).
  - Strict Token-Bucket Rate Limiting (Free, Pro, Agency tiers per IP & API Key).
  - API Key Rotation, Hashing, and Scopes validation (`publicdata:read`, `metadata:read`).
  - SSRF guard against Private IP / Localhost fetching.

## Requirements
- Node.js >= 18.0.0
- Cloudflare Wrangler CLI

## Setup
```bash
npm install
```

## KV Setup
This application uses Cloudflare KV for authentication, rate limiting, and caching.

**In `wrangler.jsonc`**, bind a KV namespace:
```jsonc
"kv_namespaces": [
  { "binding": "KV", "id": "YOUR_KV_NAMESPACE_ID" }
]
```

## Local Development
```bash
npm run dev
```

## Testing
Run all tests including CI pipeline steps:
```bash
npm test
npm run lint
npm run typecheck
```

## Environment Variables / Secrets
Keys you should create in your KV namespace to access the API locally or remotely:

Example API Key Meta to put in your KV:
- **Key:** `apikey:<hash_of_api_key>`
- **Value:** 
  ```json
  {
      "key_id": "test_1",
      "prefix": "test",
      "plan": "free",
      "scopes": ["metadata:read", "publicdata:read"],
      "status": "active",
      "created_at": 1711200000000
  }
  ```

## Usage Examples

**List Dataset:**
```bash
curl -H "Authorization: Bearer YOUR_API_KEY" "http://localhost:8787/v1/public/cities?page=1&limit=10"
```

**Fetch Metadata:**
```bash
curl -H "Authorization: Bearer YOUR_API_KEY" "http://localhost:8787/v1/metadata?url=https://example.com"
```

## Deployment Readiness
Ensure you have created and assigned your KV namespace using `wrangler kv:namespace create KV`.

Then deploy:
```bash
npm run deploy
```
