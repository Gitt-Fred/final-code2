import { publicUser, withAuth } from '../../../lib/auth'

async function me(req, res, { user }) {
  return res.status(200).json({ success: true, data: publicUser(user) })
}

export default withAuth({ GET: { allowPasswordChange: true, handler: me } })
