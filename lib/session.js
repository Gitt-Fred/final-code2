import { createHash, randomBytes } from 'node:crypto'
import Session from '../model/session'
import User from '../model/user'
import { clientIp, cookieSecure } from './security'

export const SESSION_COOKIE = 'crm_session'

const IDLE_TIMEOUT_MS = 8 * 60 * 60 * 1000 // signed out after 8h of inactivity
const ABSOLUTE_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000 // and never lasts more than 7 days
const TOUCH_INTERVAL_MS = 5 * 60 * 1000 // refresh lastSeenAt at most every 5 minutes

// 32 random bytes as base64url is always 43 characters.
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/

export const hashToken = (token) => createHash('sha256').update(token).digest('hex')

export async function createSession(user, req) {
  const token = randomBytes(32).toString('base64url')
  const now = Date.now()
  const expiresAt = new Date(now + ABSOLUTE_TIMEOUT_MS)
  await Session.create({
    tokenHash: hashToken(token),
    user: user._id,
    expiresAt,
    lastSeenAt: new Date(now),
    userAgent: String(req.headers['user-agent'] || '').slice(0, 200),
    ip: clientIp(req),
  })
  return { token, expiresAt }
}

// Returns { session, user } for a valid, unexpired session belonging to an active
// user, or null. Expired and orphaned sessions are removed as they are found.
export async function findSessionUser(token) {
  if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) return null

  const session = await Session.findOne({ tokenHash: hashToken(token) }).lean()
  if (!session) return null

  const now = Date.now()
  const expired = session.expiresAt.getTime() <= now || now - session.lastSeenAt.getTime() > IDLE_TIMEOUT_MS
  const user = expired ? null : await User.findById(session.user).lean()
  if (!user || !user.active) {
    await Session.deleteOne({ _id: session._id })
    return null
  }

  if (now - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await Session.updateOne({ _id: session._id }, { lastSeenAt: new Date(now) })
  }
  return { session, user }
}

export async function destroySession(token) {
  if (typeof token === 'string' && TOKEN_PATTERN.test(token)) {
    await Session.deleteOne({ tokenHash: hashToken(token) })
  }
}

// Used on password change, role change, and disabling an account.
export const destroyUserSessions = (userId) => Session.deleteMany({ user: userId })

const cookieAttributes = () => `Path=/; HttpOnly; SameSite=Lax${cookieSecure() ? '; Secure' : ''}`

export function buildSessionCookie(token, expiresAt) {
  const maxAge = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000))
  return `${SESSION_COOKIE}=${token}; ${cookieAttributes()}; Max-Age=${maxAge}`
}

export const buildClearedCookie = () => `${SESSION_COOKIE}=; ${cookieAttributes()}; Max-Age=0`
