export class SafeFetchError extends Error {
  constructor(public code: string, message: string) {
    super(message)
    this.name = 'SafeFetchError'
  }
}

export async function safeFetch(urlStr: string, options: RequestInit = {}): Promise<Response> {
  let currentUrl = urlStr
  let redirects = 0
  const MAX_REDIRECTS = 5
  const TIMEOUT_MS = 8000
  const MAX_SIZE = 2 * 1024 * 1024 // 2MB

  while (redirects <= MAX_REDIRECTS) {
    const url = new URL(currentUrl)

    // Allowlist Schemes
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new SafeFetchError('invalid_scheme', 'Only http and https schemes are allowed')
    }

    // Block localhost, private IP ranges, link-local
    const hostname = url.hostname
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname.startsWith('10.') ||
      hostname.startsWith('192.168.') ||
      hostname.startsWith('169.254.') ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname)
    ) {
      throw new SafeFetchError('ssrf_blocked', 'Access to internal or private networks is blocked')
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS)

    try {
      const response = await fetch(currentUrl, {
        ...options,
        redirect: 'manual', // Handle redirects manually
        signal: controller.signal,
      })
      clearTimeout(timeoutId)

      // Handle Redirects
      if (response.status >= 300 && response.status < 400 && response.headers.has('Location')) {
        const location = response.headers.get('Location')
        if (location) {
          currentUrl = new URL(location, currentUrl).toString()
          redirects++
          continue
        }
      }

      // Check Content-Length if provided
      const contentLength = response.headers.get('Content-Length')
      if (contentLength && parseInt(contentLength, 10) > MAX_SIZE) {
        throw new SafeFetchError('payload_too_large', 'Response size exceeds 2MB limit')
      }

      // Read response body safely, checking size
      const reader = response.body?.getReader()
      let receivedLength = 0
      const chunks: Uint8Array[] = []

      if (reader) {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          
          if (value) {
            receivedLength += value.length
            if (receivedLength > MAX_SIZE) {
              throw new SafeFetchError('payload_too_large', 'Response size exceeds 2MB limit during stream')
            }
            chunks.push(value)
          }
        }
      }

      const combinedChunks = new Uint8Array(receivedLength)
      let offset = 0
      for (const chunk of chunks) {
          combinedChunks.set(chunk, offset)
          offset += chunk.length
      }

      // Return a new response with the read body
      return new Response(combinedChunks, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers
      })

    } catch (error: any) {
      // @ts-ignore
      if (typeof clearTimeout !== 'undefined') clearTimeout(timeoutId)
      if (error.name === 'AbortError') {
        throw new SafeFetchError('timeout', 'Request timed out after 8 seconds')
      }
      throw error
    }
  }

  throw new SafeFetchError('too_many_redirects', 'Exceeded maximum number of redirects (5)')
}
