import logger from '../../lib/logger'
import { memoryHit } from '../../lib/rate-limit'
import { clientIp } from '../../lib/security'

// Browsers POST Content-Security-Policy violation reports here (see next.config.js).
// It is public on purpose: reports are sent without cookies and sometimes without an
// Origin header. It only ever writes a log line, so the protections are a per-IP
// rate limit, a tiny body cap, and trimming every field before it is logged.
export const config = { api: { bodyParser: { sizeLimit: '8kb' } } }

const REPORT_TYPES = new Set(['application/csp-report', 'application/reports+json', 'application/json'])
const clip = (value) => (typeof value === 'string' ? value.slice(0, 200) : undefined)

function pathOnly(url) {
  try {
    return new URL(url).pathname.slice(0, 200)
  } catch {
    return clip(url)
  }
}

// Handles both the legacy report-uri shape ({ "csp-report": {...} }) and the
// Reporting API shape ([{ type: "csp-violation", body: {...} }]).
function extractReports(body) {
  let parsed = body
  if (typeof body === 'string') {
    try {
      parsed = JSON.parse(body)
    } catch {
      return []
    }
  }
  if (parsed?.['csp-report']) return [parsed['csp-report']]
  if (Array.isArray(parsed)) return parsed.slice(0, 10).map((entry) => entry?.body).filter(Boolean)
  return []
}

export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).end()
  }

  const ip = clientIp(req)
  if (!memoryHit(`csp:${ip}`, { limit: 30, windowMs: 60 * 1000 }).allowed) {
    return res.status(429).end()
  }

  const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase()
  if (!REPORT_TYPES.has(type)) return res.status(415).end()

  for (const report of extractReports(req.body)) {
    logger.warn(
      {
        event: 'csp_violation',
        ip,
        page: pathOnly(report['document-uri'] ?? report.documentURL),
        directive: clip(report['effective-directive'] ?? report.effectiveDirective ?? report['violated-directive']),
        blocked: clip(report['blocked-uri'] ?? report.blockedURL),
        source: clip(report['source-file'] ?? report.sourceFile),
        line: Number(report['line-number'] ?? report.lineNumber) || undefined,
        sample: clip(report['script-sample'] ?? report.sample),
        disposition: clip(report.disposition),
      },
      'Content-Security-Policy violation reported'
    )
  }
  return res.status(204).end()
}
