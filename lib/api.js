// Thin fetch wrapper for the app's own JSON API. Throws an Error carrying the
// server's message when the request fails.
export async function api(url, { method = 'GET', body } = {}) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => ({}))

  if (!res.ok || json.success === false) {
    throw new Error(json.error || `Request failed (${res.status})`)
  }
  return json
}
