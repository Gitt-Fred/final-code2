import logger from './logger'

// Whether the session cookie carries the Secure attribute. Defaults to on in
// production; COOKIE_SECURE=false is for plain-HTTP local use only.
export function cookieSecure() {
  const value = process.env.COOKIE_SECURE?.trim().toLowerCase()
  if (value === 'true') return true
  if (value === 'false') return false
  return process.env.NODE_ENV === 'production'
}

let warned = false
export function warnIfInsecureCookie() {
  if (!warned && process.env.NODE_ENV === 'production' && !cookieSecure()) {
    warned = true
    logger.warn('COOKIE_SECURE is false in production: session cookies can be sent over plain HTTP. Serve over HTTPS and set COOKIE_SECURE=true.')
  }
}

const trustProxy = () => process.env.TRUST_PROXY === 'true'

// X-Forwarded-For is only believed when TRUST_PROXY=true, and then only the last
// entry (the one our own proxy appended; earlier entries are client-controlled).
export function clientIp(req) {
  if (trustProxy()) {
    const forwarded = req.headers['x-forwarded-for']
    if (typeof forwarded === 'string') {
      const last = forwarded.split(',').at(-1).trim()
      if (last) return last.slice(0, 64)
    }
  }
  return req.socket?.remoteAddress || 'unknown'
}

// CSRF defence for state-changing requests, on top of SameSite=Lax cookies: the
// request must come from our own origin. Browsers always send Origin (or at least
// Referer) on cross-site POST/PUT/DELETE, and a page on another site cannot forge it.
export function checkOrigin(req) {
  let source = req.headers.origin
  if (!source && typeof req.headers.referer === 'string') {
    try {
      source = new URL(req.headers.referer).origin
    } catch {
      return false
    }
  }
  if (!source || source === 'null') return false

  const configured = (process.env.APP_ORIGIN || '')
    .split(',')
    .map((value) => value.trim().replace(/\/+$/, ''))
    .filter(Boolean)
  if (configured.length > 0) return configured.includes(source)

  try {
    return new URL(source).host === req.headers.host
  } catch {
    return false
  }
}

export const isJsonRequest = (req) =>
  /^application\/json\s*(;|$)/i.test(req.headers['content-type'] || '')

// Validates a post-login redirect target: only same-site relative paths, so
// /login?next=https://evil.example or //evil.example can never bounce a user away.
export function safeNext(value, fallback = '/') {
  if (typeof value !== 'string' || value.length === 0 || value.length > 500) return fallback
  if (!value.startsWith('/') || value.startsWith('//')) return fallback
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i)
    if (code < 0x20 || code === 0x7f || value[i] === '\\') return fallback
  }
  try {
    const parsed = new URL(value, 'http://placeholder.invalid')
    if (parsed.origin !== 'http://placeholder.invalid') return fallback
  } catch {
    return fallback
  }
  return value
}
