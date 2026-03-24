export async function hashApiKey(key: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(key)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
  return hashHex
}

export async function verifySignature(secret: string, timestamp: string, nonce: string, body: string, signature: string): Promise<boolean> {
  const encoder = new TextEncoder()
  const keyMaterial = encoder.encode(secret)
  const key = await crypto.subtle.importKey(
    'raw',
    keyMaterial,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  )
  const dataToVerify = encoder.encode(`${timestamp}:${nonce}:${body}`)
  
  const sigBuffer = new Uint8Array(signature.match(/.{1,2}/g)?.map(byte => parseInt(byte, 16)) || [])

  return await crypto.subtle.verify('HMAC', key, sigBuffer, dataToVerify)
}
