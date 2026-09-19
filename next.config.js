const isProd = process.env.NODE_ENV === 'production'

// Violations of either policy below are POSTed here and logged (pages/api/csp-report.js).
const reportUri = 'report-uri /api/csp-report'

// Content Security Policy. Production is strict: scripts only from our own origin
// (no inline scripts, which is why the theme script lives in public/theme-init.js).
// Stylesheets must come from our origin too; only inline style *attributes* are
// allowed, because Headless UI transitions set them. Development needs eval, inline
// scripts, and injected <style> tags for React Refresh, so it is relaxed there only.
const csp = [
  "default-src 'self'",
  isProd ? "script-src 'self'" : "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
  // Fallback for browsers without the CSP3 -elem/-attr split, which ignore those two.
  "style-src 'self' 'unsafe-inline'",
  isProd ? "style-src-elem 'self'" : "style-src-elem 'self' 'unsafe-inline'",
  "style-src-attr 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  isProd ? "connect-src 'self'" : "connect-src 'self' ws:",
  "frame-src 'none'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  reportUri,
].join('; ')

// Trusted Types make the browser itself refuse to pass plain strings to HTML and
// script sinks (innerHTML, script.src, eval...). Next's runtime creates one policy,
// named "nextjs", which is the only one allowed. This runs in report-only mode:
// nothing is blocked, violations are reported. Once the reports stay clean, move it
// into the enforced policy above.
const trustedTypesReportOnly = ["require-trusted-types-for 'script'", 'trusted-types nextjs', reportUri].join('; ')

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  ...(isProd ? [{ key: 'Content-Security-Policy-Report-Only', value: trustedTypesReportOnly }] : []),
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
  // Browsers ignore HSTS over plain HTTP, so this only takes effect once you serve HTTPS.
  ...(isProd
    ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' }]
    : []),
]

module.exports = {
  output: 'standalone',
  // Don't advertise the framework in an X-Powered-By header.
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }]
  },
}
