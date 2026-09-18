// Shared helpers for the API routes under pages/api.

// PERSISTENCE arrives as a string, so `if (process.env.PERSISTENCE)` is truthy
// even for "false". Compare explicitly instead.
export const persistenceEnabled = () => process.env.PERSISTENCE === 'true'

// Served when persistence is off (no MongoDB). Read-only.
export const sampleClients = [
  {
    _id: '6224b7351a1c6bc7727bcfbe',
    name: 'John Doe',
    email: 'john@doe.com',
    company: 'Doe',
    website: 'https://doe.com',
  },
  {
    _id: '6224b7371a8a6bc7727bcfbe',
    name: 'Omri',
    email: 'omri@develeap.com',
    company: 'Develeap',
    website: 'https://develeap.com',
  },
]

const CLIENT_FIELDS = ['name', 'email', 'company', 'website']

// Only copy known string fields out of a request body.
export function pickClientFields(body) {
  const picked = {}
  for (const field of CLIENT_FIELDS) {
    if (typeof body?.[field] === 'string') {
      picked[field] = body[field]
    }
  }
  return picked
}

export const isObjectId = (value) =>
  typeof value === 'string' && /^[0-9a-f]{24}$/i.test(value)

export const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function parsePagination(query, defaultLimit = 12, maxLimit = 50) {
  const page = Math.max(parseInt(query.page, 10) || 1, 1)
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || defaultLimit, 1), maxLimit)
  return { page, limit }
}

export function sendError(res, error) {
  if (error?.name === 'ValidationError') {
    const message = Object.values(error.errors).map((e) => e.message).join(', ')
    return res.status(400).json({ success: false, error: message })
  }
  console.error(error)
  return res.status(500).json({ success: false, error: 'Something went wrong' })
}

export const notFound = (res) =>
  res.status(404).json({ success: false, error: 'Not found' })

export const persistenceDisabled = (res) =>
  res.status(503).json({
    success: false,
    error: 'Persistence is disabled, so this action is unavailable.',
  })

export const methodNotAllowed = (req, res, allowed) => {
  res.setHeader('Allow', allowed)
  return res.status(405).json({ success: false, error: `Method ${req.method} not allowed` })
}
