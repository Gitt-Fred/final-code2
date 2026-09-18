// Liveness probe for Docker. Deliberately unauthenticated and minimal: no version,
// no dependency status, nothing useful to an attacker.
export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', ['GET', 'HEAD'])
    return res.status(405).json({ status: 'method not allowed' })
  }
  return res.status(200).json({ status: 'ok' })
}
