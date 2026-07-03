// ABOUTME: Workers-pool tests for crypto-random room ids, seat tokens, and hex SHA-256 digests.
// ABOUTME: Runs under @cloudflare/vitest-pool-workers (workerd) where WebCrypto is ambient.
import { describe, expect, test } from "vitest";
import { ALPHABET, encodeBase32, newRoomId, newSeatToken, tokenDigest } from "../../src/host/ids";

// Every char produced by the pinned alphabet must be one of these; used as a charset guard.
const inAlphabet = (s: string) => [...s].every((c) => ALPHABET.includes(c));

describe("newRoomId", () => {
  test("is 20 chars, all in the pinned alphabet", () => {
    const id = newRoomId();
    // 12 bytes = 96 bits, 5 bits/char, ceil(96/5) = 20 chars.
    expect(id).toHaveLength(20);
    expect(inAlphabet(id)).toBe(true);
  });

  test("two calls differ", () => {
    expect(newRoomId()).not.toBe(newRoomId());
  });
});

describe("newSeatToken", () => {
  test("is 26 chars, all in the pinned alphabet", () => {
    const token = newSeatToken();
    // 16 bytes = 128 bits, 5 bits/char, ceil(128/5) = 26 chars.
    expect(token).toHaveLength(26);
    expect(inAlphabet(token)).toBe(true);
  });

  test("two calls differ", () => {
    expect(newSeatToken()).not.toBe(newSeatToken());
  });
});

describe("tokenDigest", () => {
  test("is 64 lowercase hex chars", async () => {
    const digest = await tokenDigest(newSeatToken());
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });

  test("is stable — same input awaited twice yields the same digest", async () => {
    const token = newSeatToken();
    expect(await tokenDigest(token)).toBe(await tokenDigest(token));
  });

  test("differs across distinct tokens", async () => {
    expect(await tokenDigest(newSeatToken())).not.toBe(await tokenDigest(newSeatToken()));
  });

  test("matches the known SHA-256 vector for 'abc'", async () => {
    // Independent vector (FIPS 180-4 example): SHA-256("abc").
    expect(await tokenDigest("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("encodeBase32", () => {
  // Hand-derivation for [0x12, 0x34, 0x56] (24 bits):
  //   0x12=00010010  0x34=00110100  0x56=01010110
  //   concat: 000100100011010001010110
  //   5-bit groups (pad tail with zero bits): 00010|01000|11010|00101|0110->01100
  //   indices: 2, 8, 26, 5, 12  ->  alphabet: '2','8','T','5','C'  ->  "28T5C"
  test("encodes a fixed 3-byte vector by the pinned bit-shift math", () => {
    expect(encodeBase32(new Uint8Array([0x12, 0x34, 0x56]))).toBe("28T5C");
  });

  // Hand-derivation for [0xFF, 0xFF] (16 bits):
  //   concat: 1111111111111111
  //   5-bit groups (pad tail): 11111|11111|11111|1->10000
  //   indices: 31, 31, 31, 16  ->  alphabet: 'Z','Z','Z','G'  ->  "ZZZG"
  test("pads the tail group with zero bits (no padding chars)", () => {
    expect(encodeBase32(new Uint8Array([0xff, 0xff]))).toBe("ZZZG");
  });

  test("all-zero bytes encode to all-'0' chars", () => {
    expect(encodeBase32(new Uint8Array([0x00, 0x00]))).toBe("0000");
  });

  test("all-0xFF vector uses only alphabet chars", () => {
    const out = encodeBase32(new Uint8Array(16).fill(0xff));
    expect(out).toHaveLength(26);
    expect(inAlphabet(out)).toBe(true);
  });
});
