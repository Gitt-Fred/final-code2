import logger from '../../../lib/logger'
import { publicUser, withAuth } from '../../../lib/auth'
import { hashPassword, validatePassword, verifyPassword } from '../../../lib/password'
import { hit } from '../../../lib/rate-limit'
import { buildSessionCookie, createSession, destroyUserSessions } from '../../../lib/session'
import User from '../../../model/user'

export const config = { api: { bodyParser: { sizeLimit: '10kb' } } }

async function changePassword(req, res, { user, ip }) {
  const { currentPassword, newPassword } = req.body ?? {}
  if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
    return res.status(400).json({ success: false, error: 'Current and new password are required' })
  }

  // Stops someone with a stolen session from guessing the current password.
  const limit = await hit(`pwchange:${user._id}`, { limit: 10, windowMs: 15 * 60 * 1000 })
  if (!limit.allowed) {
    res.setHeader('Retry-After', String(limit.retryAfter))
    return res.status(429).json({ success: false, error: 'Too many attempts. Try again later.' })
  }

  const withHash = await User.findById(user._id).select('+passwordHash').lean()
  if (!(await verifyPassword(currentPassword, withHash.passwordHash))) {
    logger.warn({ event: 'password_change_failed', userId: String(user._id), ip })
    return res.status(400).json({ success: false, error: 'Current password is incorrect' })
  }

  const passwordError = validatePassword(newPassword, { email: user.email })
  if (passwordError) {
    return res.status(400).json({ success: false, error: passwordError })
  }
  if (newPassword === currentPassword) {
    return res.status(400).json({ success: false, error: 'New password must be different from the current one' })
  }

  await User.updateOne(
    { _id: user._id },
    { passwordHash: await hashPassword(newPassword), mustChangePassword: false }
  )
  // Sign out everywhere (including any session an attacker may hold), then issue a
  // fresh session for this browser.
  await destroyUserSessions(user._id)
  const { token, expiresAt } = await createSession(user, req)
  res.setHeader('Set-Cookie', buildSessionCookie(token, expiresAt))

  logger.info({ event: 'password_changed', userId: String(user._id), ip })
  return res.status(200).json({
    success: true,
    data: publicUser({ ...user, mustChangePassword: false }),
  })
}

export default withAuth({ POST: { allowPasswordChange: true, handler: changePassword } })
