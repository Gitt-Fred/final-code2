import { randomBytes, randomInt, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCallback)

// scrypt cost, following OWASP's guidance (N=2^15, r=8, p=3 uses ~32 MiB per hash).
// The parameters are stored inside each hash, so they can be raised later without
// invalidating existing passwords.
const PARAMS = { N: 2 ** 15, r: 8, p: 3 }
const KEY_LENGTH = 64
const MAX_MEMORY = 128 * 1024 * 1024

export const PASSWORD_MIN_LENGTH = 12
// Upper bound stops someone submitting megabytes of "password" to burn CPU.
export const PASSWORD_MAX_LENGTH = 128

const derive = (password, salt, { N, r, p }) =>
  scrypt(password, salt, KEY_LENGTH, { N, r, p, maxmem: MAX_MEMORY })

export async function hashPassword(password) {
  const salt = randomBytes(16)
  const key = await derive(password, salt, PARAMS)
  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64'), key.toString('base64')].join('$')
}

export async function verifyPassword(password, stored) {
  const [scheme, n, r, p, saltB64, keyB64] = String(stored).split('$')
  const params = { N: Number(n), r: Number(r), p: Number(p) }
  const sane =
    scheme === 'scrypt' &&
    saltB64 &&
    keyB64 &&
    Number.isInteger(params.N) && params.N > 1 && params.N <= 2 ** 17 &&
    Number.isInteger(params.r) && params.r > 0 && params.r <= 16 &&
    Number.isInteger(params.p) && params.p > 0 && params.p <= 16
  if (!sane) return false

  const expected = Buffer.from(keyB64, 'base64')
  const actual = await derive(password, Buffer.from(saltB64, 'base64'), params)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

let dummyHash
// Used when the account does not exist, so a failed login takes as long whether or
// not the email is registered (prevents account enumeration by timing).
export async function verifyAgainstDummy(password) {
  dummyHash ??= hashPassword(randomBytes(16).toString('hex'))
  await verifyPassword(password, await dummyHash)
  return false
}

const COMMON_PASSWORDS = new Set([
  'password1234', 'password12345', 'passwordpassword', '123456789012', '1234567890123',
  'qwertyuiop12', 'qwertyuiopas', 'letmein12345', 'administrator', 'welcome12345',
  'iloveyou1234', 'changeme1234', 'admin1234567',
])

// Returns an error message, or null when the password is acceptable.
// Length matters more than composition rules (NIST 800-63B), so we require length
// and reject the obvious.
export function validatePassword(password, { email } = {}) {
  if (typeof password !== 'string' || password.length === 0) return 'Password is required'
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters`
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `Password must be at most ${PASSWORD_MAX_LENGTH} characters`
  }
  const lower = password.toLowerCase()
  if (email && lower === String(email).toLowerCase()) return 'Password must not be your email address'
  if (COMMON_PASSWORDS.has(lower) || /^(.)\1+$/.test(password)) return 'That password is too easy to guess'
  return null
}

// No look-alike characters (0/O, 1/l/I) so it can be read out or typed from a screen.
const TEMP_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'

export function generateTempPassword(length = 16) {
  let out = ''
  for (let i = 0; i < length; i += 1) {
    out += TEMP_ALPHABET[randomInt(TEMP_ALPHABET.length)]
  }
  return out
}
