import Router from 'next/router'

// Thin fetch wrapper for the app's own JSON API. Throws an Error carrying the
// server's message (and `status`) when the request fails.
//
// By default a 401 sends the browser to /login and a "must change password" 403
// sends it to /account. Pass redirectOnAuthError: false for the login and setup
// forms, where those responses are expected and shown inline.
export async function api(url, { method = 'GET', body, redirectOnAuthError = true } = {}) {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => ({}))

  if (redirectOnAuthError && typeof window !== 'undefined') {
    if (res.status === 401) {
      const here = window.location.pathname + window.location.search
      Router.push(`/login?next=${encodeURIComponent(here)}`)
    } else if (json.code === 'PASSWORD_CHANGE_REQUIRED') {
      Router.push('/account?required=1')
    }
  }

  if (!res.ok || json.success === false) {
    const error = new Error(json.error || `Request failed (${res.status})`)
    error.status = res.status
    throw error
  }
  return json
}
