import { createHash } from 'node:crypto'
import dbConnect from '../../../lib/mong-connect'
import logger from '../../../lib/logger'
import { publicUser, withPublic } from '../../../lib/auth'
import { verifyAgainstDummy, verifyPassword, PASSWORD_MAX_LENGTH } from '../../../lib/password'
import { hit, resetLimit } from '../../../lib/rate-limit'
import { buildSessionCookie, createSession } from '../../../lib/session'
import User from '../../../model/user'

export const config = { api: { bodyParser: { sizeLimit: '10kb' } } }

const WINDOW_MS = 15 * 60 * 1000
// Per account: stops password guessing. Per IP: stops one client spraying many
// accounts, while leaving room for an office sharing a single address.
const IP_LIMIT = 100
const ACCOUNT_LIMIT = 10

// Same message and status for "no such account", "wrong password", and "disabled",
// so the response never reveals which accounts exist.
const INVALID = { success: false, error: 'Invalid email or password' }

async function login(req, res, { ip }) {
  const { email, password } = req.body ?? {}
  if (
    typeof email !== 'string' || typeof password !== 'string' ||
    email.length === 0 || email.length > 254 ||
    password.length === 0 || password.length > PASSWORD_MAX_LENGTH
  ) {
    return res.status(400).json({ success: false, error: 'Email and password are required' })
  }

  await dbConnect()
  const normalized = email.trim().toLowerCase()
  const accountKey = `login:acct:${createHash('sha256').update(normalized).digest('hex')}`

  // Counted whether or not the account exists, so limits don't leak existence either.
  const [byIp, byAccount] = await Promise.all([
    hit(`login:ip:${ip}`, { limit: IP_LIMIT, windowMs: WINDOW_MS }),
    hit(accountKey, { limit: ACCOUNT_LIMIT, windowMs: WINDOW_MS }),
  ])
  if (!byIp.allowed || !byAccount.allowed) {
    logger.warn({ event: 'login_rate_limited', ip })
    res.setHeader('Retry-After', String(Math.max(byIp.retryAfter, byAccount.retryAfter)))
    return res.status(429).json({ success: false, error: 'Too many attempts. Try again later.' })
  }

  const user = await User.findOne({ email: normalized }).select('+passwordHash').lean()
  const valid = user
    ? await verifyPassword(password, user.passwordHash)
    : await verifyAgainstDummy(password)

  if (!user || !valid || !user.active) {
    logger.warn({ event: 'login_failed', ip })
    return res.status(401).json(INVALID)
  }

  await resetLimit(accountKey)
  await User.updateOne({ _id: user._id }, { lastLoginAt: new Date() })
  const { token, expiresAt } = await createSession(user, req)
  res.setHeader('Set-Cookie', buildSessionCookie(token, expiresAt))
  logger.info({ event: 'login_success', userId: String(user._id), ip })
  return res.status(200).json({ success: true, data: publicUser(user) })
}

export default withPublic({ POST: { handler: login } })
