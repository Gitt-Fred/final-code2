import dbConnect from '../../../lib/mong-connect'
import logger from '../../../lib/logger'
import { publicUser, withPublic } from '../../../lib/auth'
import { hashPassword, validatePassword } from '../../../lib/password'
import { hit } from '../../../lib/rate-limit'
import { buildSessionCookie, createSession } from '../../../lib/session'
import Setup from '../../../model/setup'
import User from '../../../model/user'

export const config = { api: { bodyParser: { sizeLimit: '10kb' } } }

async function status(req, res) {
  await dbConnect()
  const hasUsers = Boolean(await User.exists({}))
  return res.status(200).json({ success: true, data: { needsSetup: !hasUsers } })
}

// First-run setup: creates the initial admin, and only ever works once.
async function setup(req, res, { ip }) {
  await dbConnect()

  const limit = await hit(`setup:${ip}`, { limit: 10, windowMs: 60 * 60 * 1000 })
  if (!limit.allowed) {
    res.setHeader('Retry-After', String(limit.retryAfter))
    return res.status(429).json({ success: false, error: 'Too many attempts. Try again later.' })
  }

  const alreadyDone = { success: false, error: 'Setup has already been completed' }
  if (await User.exists({})) {
    return res.status(409).json(alreadyDone)
  }

  const { name, email, password } = req.body ?? {}
  if (typeof name !== 'string' || typeof email !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ success: false, error: 'Name, email, and password are required' })
  }
  const passwordError = validatePassword(password, { email })
  if (passwordError) {
    return res.status(400).json({ success: false, error: passwordError })
  }

  // Build indexes first, then take the lock. Inserting this fixed-id document is
  // atomic, so of two simultaneous requests only one gets past this point.
  await User.init()
  // No users exist, so a lock left over from a crashed attempt (or from deleting the
  // users to recover access) would block setup forever. A fresh lock still means
  // another request is mid-setup, so only clear one that is over a minute old.
  await Setup.deleteOne({ _id: 'setup', createdAt: { $lt: new Date(Date.now() - 60 * 1000) } })
  try {
    await Setup.create({ _id: 'setup' })
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json(alreadyDone)
    throw error
  }

  let user
  try {
    user = await User.create({ name, email, role: 'admin', passwordHash: await hashPassword(password) })
  } catch (error) {
    // Release the lock so a mistyped email can be corrected and retried.
    await Setup.deleteOne({ _id: 'setup' })
    throw error
  }

  logger.info({ event: 'initial_admin_created', userId: String(user._id), ip })
  const { token, expiresAt } = await createSession(user, req)
  res.setHeader('Set-Cookie', buildSessionCookie(token, expiresAt))
  return res.status(201).json({ success: true, data: publicUser(user) })
}

export default withPublic({ GET: { handler: status }, POST: { handler: setup } })
