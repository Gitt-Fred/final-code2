import logger from '../../../lib/logger'
import { publicUser, withAuth } from '../../../lib/auth'
import { generateTempPassword, hashPassword } from '../../../lib/password'
import { destroyUserSessions } from '../../../lib/session'
import { isObjectId, notFound } from '../../../lib/api-helpers'
import User from '../../../model/user'

export const config = { api: { bodyParser: { sizeLimit: '10kb' } } }

const bad = (res, status, error) => res.status(status).json({ success: false, error })

// Admin-only. Accepts any of: name, role, active, resetPassword.
async function updateUser(req, res, { user: actor, ip }) {
  const { id } = req.query
  if (!isObjectId(id)) return notFound(res)

  const target = await User.findById(id).lean()
  if (!target) return notFound(res)

  const { name, role, active, resetPassword } = req.body ?? {}
  const changes = {}
  let revokeSessions = false
  let temporaryPassword

  if (name !== undefined) {
    if (typeof name !== 'string') return bad(res, 400, 'Name must be text')
    changes.name = name
  }
  if (role !== undefined) {
    if (role !== 'admin' && role !== 'member') return bad(res, 400, 'Role must be admin or member')
    if (role !== target.role) {
      changes.role = role
      revokeSessions = true
    }
  }
  if (active !== undefined) {
    if (typeof active !== 'boolean') return bad(res, 400, 'Active must be true or false')
    if (active !== target.active) {
      changes.active = active
      revokeSessions = true
    }
  }
  if (resetPassword === true) {
    temporaryPassword = generateTempPassword()
    changes.passwordHash = await hashPassword(temporaryPassword)
    changes.mustChangePassword = true
    revokeSessions = true
  }

  if (Object.keys(changes).length === 0) {
    return bad(res, 400, 'Nothing to update')
  }

  const isSelf = String(target._id) === String(actor._id)
  if (isSelf && (changes.role !== undefined || changes.active === false)) {
    return bad(res, 400, 'You cannot change your own role or disable your own account')
  }

  // Never leave the workspace without an active admin.
  const losesAdmin = target.role === 'admin' && target.active && (changes.role === 'member' || changes.active === false)
  if (losesAdmin) {
    const otherAdmins = await User.countDocuments({ role: 'admin', active: true, _id: { $ne: target._id } })
    if (otherAdmins === 0) return bad(res, 409, 'There must be at least one active admin')
  }

  const updated = await User.findByIdAndUpdate(id, { $set: changes }, { new: true, runValidators: true }).lean()
  if (revokeSessions) {
    await destroyUserSessions(target._id)
  }

  logger.info({
    event: 'user_updated',
    actorId: String(actor._id),
    userId: String(target._id),
    fields: Object.keys(changes).filter((key) => key !== 'passwordHash'),
    passwordReset: Boolean(temporaryPassword),
    ip,
  })
  return res.status(200).json({ success: true, data: { user: publicUser(updated), temporaryPassword } })
}

export default withAuth({ PATCH: { role: 'admin', handler: updateUser } })
