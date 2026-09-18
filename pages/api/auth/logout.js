import dbConnect from '../../../lib/mong-connect'
import logger from '../../../lib/logger'
import { readSessionToken, withPublic } from '../../../lib/auth'
import { buildClearedCookie, destroySession } from '../../../lib/session'

export const config = { api: { bodyParser: { sizeLimit: '10kb' } } }

// Deletes the session server-side (so a copied cookie stops working) and clears the cookie.
async function logout(req, res, { ip }) {
  await dbConnect()
  await destroySession(readSessionToken(req))
  logger.info({ event: 'logout', ip })
  res.setHeader('Set-Cookie', buildClearedCookie())
  return res.status(200).json({ success: true, data: {} })
}

export default withPublic({ POST: { handler: logout } })
