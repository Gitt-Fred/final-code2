import logger from '../../../lib/logger'
import { publicUser, withAuth } from '../../../lib/auth'
import { generateTempPassword, hashPassword } from '../../../lib/password'
import User from '../../../model/user'

export const config = { api: { bodyParser: { sizeLimit: '10kb' } } }

async function listUsers(req, res) {
  const users = await User.find({}).sort({ createdAt: 1 }).lean()
  return res.status(200).json({ success: true, data: users.map(publicUser) })
}

// Admin creates the account and gets a one-time temporary password to hand over.
// The new user must replace it at first sign-in.
async function createUser(req, res, { user: actor, ip }) {
  const { name, email, role } = req.body ?? {}
  if (typeof name !== 'string' || typeof email !== 'string') {
    return res.status(400).json({ success: false, error: 'Name and email are required' })
  }
  if (role !== undefined && role !== 'admin' && role !== 'member') {
    return res.status(400).json({ success: false, error: 'Role must be admin or member' })
  }

  const temporaryPassword = generateTempPassword()
  const created = await User.create({
    name,
    email,
    role: role ?? 'member',
    passwordHash: await hashPassword(temporaryPassword),
    mustChangePassword: true,
  })

  logger.info({ event: 'user_created', actorId: String(actor._id), userId: String(created._id), role: created.role, ip })
  return res.status(201).json({ success: true, data: { user: publicUser(created), temporaryPassword } })
}

export default withAuth({
  GET: { role: 'admin', handler: listUsers },
  POST: { role: 'admin', handler: createUser },
})
