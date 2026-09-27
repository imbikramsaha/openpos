// Optional passphrase encryption for backup files (AES-256-GCM, key from PBKDF2-SHA256).
// Layout: "KASAENC1" | uint32 header length | JSON header | ciphertext.

const MAGIC = 'KASAENC1'
const ITERATIONS = 310_000

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

async function deriveKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  if (!crypto.subtle) throw new Error('Encryption needs a secure (https) connection')
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

export async function encryptBlob(blob: Blob, passphrase: string): Promise<Blob> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveKey(passphrase, salt, ITERATIONS)
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, await blob.arrayBuffer())
  const header = new TextEncoder().encode(JSON.stringify({ v: 1, kdf: 'PBKDF2-SHA256', iterations: ITERATIONS, salt: b64(salt), iv: b64(iv) }))
  const len = new Uint8Array(4)
  new DataView(len.buffer).setUint32(0, header.length)
  return new Blob([MAGIC, len, header, cipher], { type: 'application/octet-stream' })
}

export async function isEncrypted(blob: Blob): Promise<boolean> {
  return (await blob.slice(0, MAGIC.length).text()) === MAGIC
}

export class WrongPassphrase extends Error {
  constructor() {
    super('wrong passphrase')
  }
}

export async function decryptBlob(blob: Blob, passphrase: string): Promise<Blob> {
  const buf = new Uint8Array(await blob.arrayBuffer())
  const len = new DataView(buf.buffer, MAGIC.length, 4).getUint32(0)
  const start = MAGIC.length + 4
  const header = JSON.parse(new TextDecoder().decode(buf.slice(start, start + len))) as { iterations: number; salt: string; iv: string }
  const key = await deriveKey(passphrase, unb64(header.salt), header.iterations)
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(header.iv) as BufferSource }, key, buf.slice(start + len))
    return new Blob([plain], { type: 'application/json' })
  } catch {
    throw new WrongPassphrase()
  }
}
