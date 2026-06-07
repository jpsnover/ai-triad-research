// Client-side AES-256-GCM encryption/decryption for key sharing.
// Mirrors the Node.js crypto implementation in src/main/apiKeyStore.ts
// using the Web Crypto API so it works in PWA/browser context.

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

interface KeySharePayload {
  v: 1;
  salt: string;
  iv: string;
  data: string;
  tag: string;
}

export async function encryptKeysForSharing(
  keys: Record<string, string>,
  passphrase: string,
): Promise<KeySharePayload> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const derivedKey = await deriveKey(passphrase, salt);

  const plaintext = new TextEncoder().encode(JSON.stringify({ keys }));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, tagLength: 128 },
    derivedKey,
    plaintext,
  );

  // Web Crypto appends the 16-byte auth tag to the ciphertext
  const combined = new Uint8Array(ciphertext);
  const data = combined.slice(0, combined.length - 16);
  const tag = combined.slice(combined.length - 16);

  return {
    v: 1,
    salt: bytesToHex(salt),
    iv: bytesToHex(iv),
    data: bytesToHex(data),
    tag: bytesToHex(tag),
  };
}

export async function decryptKeysFromSharing(
  payload: KeySharePayload,
  passphrase: string,
): Promise<Record<string, string>> {
  const salt = hexToBytes(payload.salt);
  const iv = hexToBytes(payload.iv);
  const data = hexToBytes(payload.data);
  const tag = hexToBytes(payload.tag);
  const derivedKey = await deriveKey(passphrase, salt);

  // Web Crypto expects ciphertext + tag concatenated
  const combined = new Uint8Array(data.length + tag.length);
  combined.set(data);
  combined.set(tag, data.length);

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv, tagLength: 128 },
    derivedKey,
    combined,
  );

  const { keys } = JSON.parse(new TextDecoder().decode(decrypted)) as { keys: Record<string, string> };
  return keys;
}
