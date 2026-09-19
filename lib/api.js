import Router from 'next/router'

// Thin fetch wrapper for the app's own JSON API. Throws an Error carrying the
// server's message (and `status`) when the request fails.
//
// By default a 401 sends the browser to /login and a "must change password" 403
// sends it to /account. Pass redirectOnAuthError: false for the login and setup
// forms, where those responses are expected and shown inline.
function handleAuthRedirect(status, json) {
  if (typeof window === 'undefined') return
  if (status === 401) {
    const here = window.location.pathname + window.location.search
    Router.push(`/login?next=${encodeURIComponent(here)}`)
  } else if (json.code === 'PASSWORD_CHANGE_REQUIRED') {
    Router.push('/account?required=1')
  }
}

function checkResponse(ok, status, json) {
  if (!ok || json.success === false) {
    const error = new Error(json.error || `Request failed (${status})`)
    error.status = status
    throw error
  }
  return json
}

export async function api(url, { method = 'GET', body, redirectOnAuthError = true } = {}) {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => ({}))
  if (redirectOnAuthError) handleAuthRedirect(res.status, json)
  return checkResponse(res.ok, res.status, json)
}

// Uploads a File as the raw request body. The name travels in the query string;
// the server decides the real type from the bytes. XMLHttpRequest rather than
// fetch because fetch cannot report upload progress.
export function upload(url, file, { onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    const separator = url.includes('?') ? '&' : '?'
    xhr.open('POST', `${url}${separator}name=${encodeURIComponent(file.name)}`)
    xhr.withCredentials = true
    xhr.setRequestHeader('Content-Type', 'application/octet-stream')
    if (onProgress) {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress(event.loaded / event.total)
      }
    }
    xhr.onload = () => {
      let json = {}
      try {
        json = JSON.parse(xhr.responseText)
      } catch {
        // Non-JSON error page; fall through with an empty body.
      }
      handleAuthRedirect(xhr.status, json)
      try {
        resolve(checkResponse(xhr.status >= 200 && xhr.status < 300, xhr.status, json))
      } catch (error) {
        reject(error)
      }
    }
    xhr.onerror = () => reject(new Error('Upload failed. Check your connection and try again.'))
    xhr.send(file)
  })
}
