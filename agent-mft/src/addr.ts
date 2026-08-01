/**
 * addr.ts — deterministic address system.
 *
 * Addresses are stable, short, cross-backend reference handles (e.g. `A1F3`).
 * Generated from a monotonic sequence with a fixed offset for obfuscation.
 * Addresses are never reused and survive mirror rebuilds (deterministic mapping).
 */

const OFFSET = 0x5f5e100; // 100,000,000 — first address is not "0000"

const ADDR_RE = /^[0-9A-Z]{1,8}$/;

/** seq → short code (Base36, uppercase, deterministic). */
export function encodeAddr(seq: number): string {
  if (!Number.isInteger(seq) || seq < 0) {
    throw new Error(`invalid address sequence: ${seq}`);
  }
  return (seq + OFFSET).toString(36).toUpperCase();
}

/** short code → seq. Returns null when the code is not a valid address. */
export function decodeAddr(addr: string): number | null {
  const a = addr.trim().toUpperCase();
  if (!ADDR_RE.test(a)) return null;
  const n = Number.parseInt(a, 36);
  if (!Number.isSafeInteger(n)) return null;
  const seq = n - OFFSET;
  return seq >= 0 ? seq : null;
}

/** Validate an address without decoding. */
export function isValidAddr(addr: string): boolean {
  return ADDR_RE.test(addr.trim().toUpperCase());
}

/** Human-friendly display: `#A1F3`. */
export function displayAddr(addr: string): string {
  return `#${addr.toUpperCase()}`;
}
