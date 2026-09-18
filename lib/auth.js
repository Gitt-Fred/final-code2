import dbConnect from './mong-connect'
import logger from './logger'
import { memoryHit } from './rate-limit'
import { checkOrigin, clientIp, isJsonRequest, safeNext, warnIfInsecureCookie } from './security'
import { SESSION_COOKIE, findSessionUser } from './session'
import { methodNotAllowed, sendError } from './api-helpers'
import User from '../model/user'

// The shape of a user that is safe to send to a browser (never the hash).
export const publicUser = (user) => ({
  id: String(user._id),
  email: user.email,
  name: user.name,
  role: user.role,
  active: user.active,
  mustChangePassword: Boolean(user.mustChangePassword),
  lastLoginAt: user.lastLoginAt ? new Date(user.lastLoginAt).toISOString() : null,
  createdAt: user.createdAt ? new Date(user.createdAt).toISOString() : null,
})

export const readSessionToken = (req) => req.cookies?.[SESSION_COOKIE]

export async function getAuth(req) {
  return findSessionUser(readSessionToken(req))
}

const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH'])
const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

function createHandler(routes, { requireAuth }) {
  warnIfInsecureCookie()

  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store')

    const route = routes[req.method]
    if (!route) {
      return methodNotAllowed(req, res, Object.keys(routes))
    }

    const ip = clientIp(req)
    const flood = memoryHit(`api:${ip}`, { limit: 300, windowMs: 60 * 1000 })
    if (!flood.allowed) {
      res.setHeader('Retry-After', String(flood.retryAfter))
      return res.status(429).json({ success: false, error: 'Too many requests' })
    }

    if (STATE_CHANGING.has(req.method)) {
      if (!checkOrigin(req)) {
        logger.warn({ ip, method: req.method, url: req.url, origin: req.headers.origin }, 'Blocked cross-origin request')
        return res.status(403).json({ success: false, error: 'Cross-origin request blocked' })
      }
      if (BODY_METHODS.has(req.method) && !isJsonRequest(req)) {
        return res.status(415).json({ success: false, error: 'Content-Type must be application/json' })
      }
    }

    try {
      let user = null
      if (requireAuth) {
        await dbConnect()
        const auth = await getAuth(req)
        if (!auth) {
          return res.status(401).json({ success: false, error: 'Authentication required' })
        }
        user = auth.user

        if (user.mustChangePassword && !route.allowPasswordChange) {
          return res.status(403).json({
            success: false,
            error: 'You must change your password first',
            code: 'PASSWORD_CHANGE_REQUIRED',
          })
        }
        if (route.role === 'admin' && user.role !== 'admin') {
          logger.warn({ userId: String(user._id), method: req.method, url: req.url }, 'Forbidden: admin required')
          return res.status(403).json({ success: false, error: 'Forbidden' })
        }
      }
      return await route.handler(req, res, { user, ip })
    } catch (error) {
      return sendError(res, error)
    }
  }
}

// Routes are keyed by HTTP method:
//   withAuth({ GET: { handler }, DELETE: { role: 'admin', handler } })
// Every route requires a signed-in user; `role: 'admin'` additionally requires an
// admin. Set `allowPasswordChange` on the few routes a user may call before they
// have replaced a temporary password.
export const withAuth = (routes) => createHandler(routes, { requireAuth: true })

// Same protections (method check, flood limit, CSRF, content type) without needing
// a session, for login, setup, and logout.
export const withPublic = (routes) => createHandler(routes, { requireAuth: false })

// Guard for pages, used from getServerSideProps. Returns Next's { redirect } or
// { props } so pages can `return requireUserSSR(context)`.
export async function requireUserSSR(context, { role } = {}) {
  await dbConnect()
  const auth = await getAuth(context.req)

  if (!auth) {
    // A brand-new install has no users at all: send people to first-run setup.
    if ((await User.estimatedDocumentCount()) === 0) {
      return { redirect: { destination: '/setup', permanent: false } }
    }
    const next = encodeURIComponent(safeNext(context.resolvedUrl))
    return { redirect: { destination: `/login?next=${next}`, permanent: false } }
  }

  const { user } = auth
  if (user.mustChangePassword && !context.resolvedUrl.startsWith('/account')) {
    return { redirect: { destination: '/account?required=1', permanent: false } }
  }
  if (role === 'admin' && user.role !== 'admin') {
    return { redirect: { destination: '/', permanent: false } }
  }
  return { props: { user: publicUser(user) } }
}
