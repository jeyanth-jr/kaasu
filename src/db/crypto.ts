/**
 * Optional passphrase encryption for backup files (AES-256-GCM, key from
 * PBKDF2-SHA256). Everything happens in the browser via WebCrypto.
 */
export const ENCRYPTED_FORMAT = "kaasu-backup-encrypted";
const ITERATIONS = 310_000;

export interface EncryptedBackup {
  format: typeof ENCRYPTED_FORMAT;
  version: 1;
  kdf: { name: "PBKDF2"; hash: "SHA-256"; iterations: number; salt: string };
  cipher: { name: "AES-GCM"; iv: string };
  data: string;
}

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function deriveKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations }, base, { name: "AES-GCM", length: 256 }, false, [
    "encrypt",
    "decrypt",
  ]);
}

function chunkedB64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
}

export async function encryptText(plain: string, passphrase: string): Promise<EncryptedBackup> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, ITERATIONS);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, new TextEncoder().encode(plain)));
  return {
    format: ENCRYPTED_FORMAT,
    version: 1,
    kdf: { name: "PBKDF2", hash: "SHA-256", iterations: ITERATIONS, salt: b64(salt) },
    cipher: { name: "AES-GCM", iv: b64(iv) },
    data: chunkedB64(ct),
  };
}

export function isEncrypted(json: unknown): json is EncryptedBackup {
  return typeof json === "object" && json !== null && (json as { format?: string }).format === ENCRYPTED_FORMAT;
}

export async function decryptText(enc: EncryptedBackup, passphrase: string): Promise<string | null> {
  try {
    const key = await deriveKey(passphrase, unb64(enc.kdf.salt), enc.kdf.iterations);
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(enc.cipher.iv) as BufferSource }, key, unb64(enc.data) as BufferSource);
    return new TextDecoder().decode(pt);
  } catch {
    return null; // wrong passphrase or tampered file
  }
}
