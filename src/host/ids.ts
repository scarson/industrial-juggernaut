// ABOUTME: Crypto-random room ids + seat tokens (Crockford base32) and hex SHA-256 token digests.
// ABOUTME: Identity randomness only — WebCrypto, never the engine PCG32 (pitfall GEO-3 / DO-ID-1).

// PINNED, URL-safe Crockford base32 alphabet (no I/L/O/U). Room ids appear in share links, so
// this alphabet is a wire contract: changing it silently breaks every already-issued room URL.
// Do NOT reorder or substitute characters.
export const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * Encode bytes as unpadded base32 over the pinned {@link ALPHABET}.
 *
 * Big-endian bit-shift accumulation: bytes feed an accumulator MSB-first, and every full 5-bit
 * group is emitted. A partial final group is left-padded with zero bits (there are no padding
 * chars). So N bytes produce ceil(N*8/5) chars: 12 bytes -> 20, 16 bytes -> 26.
 */
export function encodeBase32(bytes: Uint8Array): string {
  let accumulator = 0;
  let bits = 0;
  let out = "";
  for (const byte of bytes) {
    accumulator = (accumulator << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += ALPHABET[(accumulator >>> bits) & 0x1f];
    }
  }
  if (bits > 0) {
    // Left-pad the leftover bits with zeros to fill a final 5-bit group.
    out += ALPHABET[(accumulator << (5 - bits)) & 0x1f];
  }
  return out;
}

// GEO-3 / DO-ID-1: room + seat identity is NOT game randomness. It MUST come from WebCrypto and
// must never consume or depend on the engine's seeded PCG32 stream (which would couple identity
// generation to gameplay determinism and could collide draws). WebCrypto only, below.

/** A >=96-bit crypto-random room id (12 bytes -> 20 base32 chars) for share-link addressing. */
export function newRoomId(): string {
  return encodeBase32(crypto.getRandomValues(new Uint8Array(12)));
}

/** A 128-bit crypto-random seat token (16 bytes -> 26 base32 chars). */
export function newSeatToken(): string {
  return encodeBase32(crypto.getRandomValues(new Uint8Array(16)));
}

/** Lowercase hex SHA-256 (64 chars) of a token, for storing/comparing authorized-seat digests. */
export async function tokenDigest(token: string): Promise<string> {
  const buffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
