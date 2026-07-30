import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/**
 * Password hashing on Node's built-in scrypt — a memory-hard KDF, not a bare
 * digest. Chosen over bcrypt/argon2 specifically because it needs no new
 * dependency: the live deploy directory is a standalone pnpm install with no
 * workspace, so adding a native module there means hand-copying its .pnpm
 * store entries. Core crypto sidesteps that entirely.
 *
 * Cost: N=2^15, r=8, p=1 → ~32 MB and ~100 ms per hash, which is the point.
 * maxmem must be raised explicitly; Node's 32 MB default would reject it.
 *
 * Stored as `scrypt$N$r$p$salt$hash` (base64) so the parameters travel with
 * the hash and can be raised later without invalidating existing passwords.
 */
const N = 32768;
const R = 8;
const P = 1;
const KEYLEN = 64;
const MAXMEM = 64 * 1024 * 1024;

export const MIN_PASSWORD_LENGTH = 8;

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(plain, salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

/**
 * Constant-time verify. Returns false for anything malformed rather than
 * throwing, so a corrupt stored value can never be mistaken for a match.
 */
export async function verifyPassword(plain: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[4]!, "base64");
    expected = Buffer.from(parts[5]!, "base64");
  } catch {
    return false;
  }
  if (!salt.length || !expected.length) return false;

  try {
    const got = await scrypt(plain, salt, expected.length, { N: n, r, p, maxmem: MAXMEM });
    return got.length === expected.length && timingSafeEqual(got, expected);
  } catch {
    return false;
  }
}
