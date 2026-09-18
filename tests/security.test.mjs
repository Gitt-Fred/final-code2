// Black-box security tests. They talk to a RUNNING stack over HTTP:
//
//   docker compose down -v && docker compose up -d --build
//   npm run test:e2e
//
// The stack must be a fresh install (no users yet), because the suite exercises
// first-run setup. Set BASE_URL to test somewhere other than http://localhost:3000, and
// E2E_EXPECT_SECURE=true if that deployment marks session cookies Secure.
import assert from 'node:assert/strict'
import http from 'node:http'
import { before, describe, it } from 'node:test'

const BASE = new URL(process.env.BASE_URL || 'http://localhost:3000')
const EXPECT_SECURE = process.env.E2E_EXPECT_SECURE === 'true'
const PASSWORD = 'correct horse battery staple'
const OBJECT_ID = '000000000000000000000000'

// Low-level request so we control every header (Origin, Referer, Content-Type, cookies).
// Pass origin: null to send no Origin header at all.
function request(method, path, { body, raw, cookie, origin = BASE.origin, headers = {}, contentType = 'application/json' } = {}) {
  return new Promise((resolve, reject) => {
    const payload = raw ?? (body === undefined ? undefined : JSON.stringify(body))
    const sent = { ...headers }
    if (origin) sent.Origin = origin
    if (cookie) sent.Cookie = cookie
    if (payload !== undefined) {
      sent['Content-Type'] = contentType
      sent['Content-Length'] = Buffer.byteLength(payload)
    }
    const req = http.request({ host: BASE.hostname, port: BASE.port, method, path, headers: sent }, (res) => {
      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString()
        let data
        try {
          data = JSON.parse(text)
        } catch {
          // Not JSON (HTML pages, plain-text framework errors).
        }
        const setCookie = res.headers['set-cookie'] || []
        const session = setCookie.map((c) => c.split(';')[0]).find((c) => c.startsWith('crm_session='))
        resolve({ status: res.statusCode, headers: res.headers, setCookie, text, data, session })
      })
    })
    req.on('error', reject)
    if (payload !== undefined) req.write(payload)
    req.end()
  })
}

const get = (path, opts) => request('GET', path, opts)
const post = (path, body, opts) => request('POST', path, { body, ...opts })

async function login(email, password = PASSWORD) {
  const res = await post('/api/auth/login', { email, password })
  assert.equal(res.status, 200, `login as ${email} failed: ${res.text}`)
  assert.ok(res.session, 'login should set a session cookie')
  return res
}

// Shared state, filled in as the suite progresses.
const state = {}

describe('unauthenticated access', () => {
  before(async () => {
    const res = await get('/api/auth/setup')
    assert.equal(res.status, 200)
    assert.equal(
      res.data.data.needsSetup,
      true,
      'This suite needs a fresh install. Run: docker compose down -v && docker compose up -d --build'
    )
  })

  const protectedRoutes = [
    ['GET', '/api/clients'],
    ['GET', `/api/clients/${OBJECT_ID}`],
    ['GET', `/api/clients/${OBJECT_ID}/notes`],
    ['POST', '/api/clients'],
    ['PUT', `/api/clients/${OBJECT_ID}`],
    ['DELETE', `/api/clients/${OBJECT_ID}`],
    ['POST', `/api/clients/${OBJECT_ID}/notes`],
    ['DELETE', `/api/notes/${OBJECT_ID}`],
    ['GET', '/api/news?company=x'],
    ['GET', '/api/users'],
    ['POST', '/api/users'],
    ['PATCH', `/api/users/${OBJECT_ID}`],
    ['GET', '/api/auth/me'],
    ['POST', '/api/auth/change-password'],
  ]
  for (const [method, path] of protectedRoutes) {
    it(`${method} ${path} requires authentication`, async () => {
      const res = await request(method, path, { body: method === 'GET' || method === 'DELETE' ? undefined : {} })
      assert.equal(res.status, 401)
      assert.equal(res.data.success, false)
    })
  }

  it('health endpoint is public and reveals nothing', async () => {
    const res = await get('/api/health')
    assert.equal(res.status, 200)
    assert.deepEqual(res.data, { status: 'ok' })
  })

  it('a fresh install sends page requests to first-run setup', async () => {
    const res = await get('/')
    assert.equal(res.status, 307)
    assert.equal(res.headers.location, '/setup')
  })
})

describe('first-run setup', () => {
  it('rejects a weak password and non-string input', async () => {
    const weak = await post('/api/auth/setup', { name: 'A', email: 'a@example.test', password: 'short' })
    assert.equal(weak.status, 400)
    const injected = await post('/api/auth/setup', { name: 'A', email: { $ne: null }, password: PASSWORD })
    assert.equal(injected.status, 400)
  })

  it('lets exactly one of several simultaneous requests create the admin', async () => {
    const attempts = await Promise.all(
      [1, 2, 3, 4, 5].map((n) =>
        post('/api/auth/setup', { name: `Admin ${n}`, email: `first-${n}@example.test`, password: PASSWORD })
      )
    )
    const winners = attempts.filter((res) => res.status === 201)
    assert.equal(winners.length, 1, `expected one winner, got statuses ${attempts.map((r) => r.status)}`)
    assert.ok(attempts.filter((res) => res.status !== 201).every((res) => res.status === 409))

    state.admin = { email: winners[0].data.data.email, cookie: winners[0].session, id: winners[0].data.data.id }
    assert.equal(winners[0].data.data.role, 'admin')
  })

  it('closes for good once an admin exists', async () => {
    const again = await post('/api/auth/setup', { name: 'Late', email: 'late@example.test', password: PASSWORD })
    assert.equal(again.status, 409)
    const status = await get('/api/auth/setup')
    assert.equal(status.data.data.needsSetup, false)
  })
})

describe('session cookie', () => {
  it('is HttpOnly, SameSite=Lax, path-scoped, and has no Domain', async () => {
    const res = await login(state.admin.email)
    const header = res.setCookie.find((c) => c.startsWith('crm_session='))
    assert.match(header, /;\s*HttpOnly/i)
    assert.match(header, /;\s*SameSite=Lax/i)
    assert.match(header, /;\s*Path=\//i)
    assert.doesNotMatch(header, /Domain=/i)
    assert.match(header, /;\s*Max-Age=\d+/i)
    assert.equal(/;\s*Secure/i.test(header), EXPECT_SECURE)
    state.admin.cookie = res.session
  })

  it('never exposes a password hash', async () => {
    const me = await get('/api/auth/me', { cookie: state.admin.cookie })
    assert.equal(me.status, 200)
    assert.equal(me.data.data.role, 'admin')
    assert.doesNotMatch(me.text, /passwordHash|scrypt\$/)
  })

  it('rejects garbage and malformed cookies', async () => {
    for (const cookie of ['crm_session=nope', 'crm_session=' + 'A'.repeat(43), 'crm_session=' + 'x'.repeat(5000)]) {
      const res = await get('/api/auth/me', { cookie })
      assert.equal(res.status, 401)
    }
  })

  it('logout revokes the session on the server, not just in the browser', async () => {
    const second = await login(state.admin.email)
    const before = await get('/api/auth/me', { cookie: second.session })
    assert.equal(before.status, 200)

    const out = await post('/api/auth/logout', {}, { cookie: second.session })
    assert.equal(out.status, 200)
    // Replaying the old token must fail even though the "browser" still has it.
    const after = await get('/api/auth/me', { cookie: second.session })
    assert.equal(after.status, 401)
  })
})

describe('login hardening', () => {
  it('gives an identical response for a wrong password and an unknown account', async () => {
    const wrong = await post('/api/auth/login', { email: state.admin.email, password: 'definitely-not-it-1234' })
    const unknown = await post('/api/auth/login', { email: 'nobody@example.test', password: 'definitely-not-it-1234' })
    assert.equal(wrong.status, 401)
    assert.equal(unknown.status, 401)
    assert.deepEqual(wrong.data, unknown.data)
  })

  it('rejects NoSQL operator payloads', async () => {
    const both = await post('/api/auth/login', { email: { $ne: null }, password: { $ne: null } })
    assert.equal(both.status, 400)
    const password = await post('/api/auth/login', { email: state.admin.email, password: { $gt: '' } })
    assert.equal(password.status, 400)
  })

  it('rejects an oversized password without spending time hashing it', async () => {
    const started = Date.now()
    const res = await post('/api/auth/login', { email: state.admin.email, password: 'A'.repeat(10000) })
    assert.equal(res.status, 400)
    assert.ok(Date.now() - started < 1000, 'oversized password should be rejected immediately')
  })

  it('throttles repeated failures and reveals nothing about which accounts exist', async () => {
    const statuses = []
    for (let i = 0; i < 12; i += 1) {
      const res = await post('/api/auth/login', { email: 'lockout-probe@example.test', password: 'wrong-password-123' })
      statuses.push(res.status)
      if (res.status === 429) {
        assert.ok(Number(res.headers['retry-after']) > 0, 'a 429 should carry Retry-After')
      }
    }
    assert.equal(statuses[0], 401)
    assert.equal(statuses.at(-1), 429, `expected the account to be throttled, got ${statuses}`)
  })
})

describe('CSRF and request validation', () => {
  it('blocks state-changing requests from another origin', async () => {
    const cookie = state.admin.cookie
    const body = { name: 'Evil' }
    assert.equal((await post('/api/clients', body, { cookie, origin: 'http://evil.example' })).status, 403)
    assert.equal((await request('PUT', `/api/clients/${OBJECT_ID}`, { body, cookie, origin: 'http://evil.example' })).status, 403)
    assert.equal((await request('DELETE', `/api/clients/${OBJECT_ID}`, { cookie, origin: 'http://evil.example' })).status, 403)
    assert.equal((await post('/api/auth/logout', {}, { cookie, origin: 'null' })).status, 403)
  })

  it('blocks a request that carries no Origin or Referer', async () => {
    const res = await post('/api/clients', { name: 'No origin' }, { cookie: state.admin.cookie, origin: null })
    assert.equal(res.status, 403)
  })

  it('accepts a matching Referer when Origin is absent, but not a foreign one', async () => {
    const good = await post('/api/clients', { name: 'Via referer' }, {
      cookie: state.admin.cookie, origin: null, headers: { Referer: `${BASE.origin}/` },
    })
    assert.equal(good.status, 201)
    const bad = await post('/api/clients', { name: 'Bad referer' }, {
      cookie: state.admin.cookie, origin: null, headers: { Referer: 'http://evil.example/page' },
    })
    assert.equal(bad.status, 403)
  })

  it('does not apply the origin check to safe (read) requests', async () => {
    const res = await get('/api/clients', { cookie: state.admin.cookie, origin: 'http://evil.example' })
    assert.equal(res.status, 200)
  })

  it('requires JSON bodies', async () => {
    const res = await post('/api/clients', undefined, {
      cookie: state.admin.cookie, raw: 'name=x', contentType: 'text/plain',
    })
    assert.equal(res.status, 415)
  })

  it('answers malformed JSON with a clean 400 and leaks no stack trace', async () => {
    const res = await post('/api/clients', undefined, { cookie: state.admin.cookie, raw: '{not json' })
    assert.equal(res.status, 400)
    assert.doesNotMatch(res.text, /\bat .*\.js|node_modules|SyntaxError/i)
  })

  it('rejects an oversized body', async () => {
    const res = await post('/api/clients', { name: 'x', company: 'y'.repeat(60 * 1024) }, { cookie: state.admin.cookie })
    assert.equal(res.status, 413)
  })

  it('returns 405 with an Allow header for unsupported methods', async () => {
    const res = await request('PATCH', '/api/clients', { body: {}, cookie: state.admin.cookie })
    assert.equal(res.status, 405)
    assert.ok(res.headers.allow)
  })

  it('validates input and never trusts client-supplied ownership', async () => {
    const bad = await post('/api/clients', { name: '' }, { cookie: state.admin.cookie })
    assert.equal(bad.status, 400)
    const created = await post('/api/clients', { name: 'Owned', createdBy: OBJECT_ID, role: 'admin' }, { cookie: state.admin.cookie })
    assert.equal(created.status, 201)
    assert.equal(created.data.data.createdBy, state.admin.id, 'createdBy must come from the session, not the request')
    assert.equal(created.data.data.role, undefined)
    state.client = created.data.data
  })
})

describe('roles and permissions', () => {
  it('admin creates a member with a one-time temporary password', async () => {
    const res = await post('/api/users', { name: 'Mia Member', email: 'mia@example.test', role: 'member' }, { cookie: state.admin.cookie })
    assert.equal(res.status, 201)
    assert.equal(res.data.data.user.mustChangePassword, true)
    assert.match(res.data.data.temporaryPassword, /^[A-Za-z0-9]{16}$/)
    assert.doesNotMatch(JSON.stringify(res.data.data.user), /passwordHash|scrypt\$/)
    state.member = { email: 'mia@example.test', id: res.data.data.user.id, temp: res.data.data.temporaryPassword }

    const list = await get('/api/users', { cookie: state.admin.cookie })
    assert.equal(list.status, 200)
    assert.doesNotMatch(list.text, /passwordHash|scrypt\$/)
  })

  it('a duplicate email is rejected', async () => {
    const res = await post('/api/users', { name: 'Dup', email: 'MIA@example.test' }, { cookie: state.admin.cookie })
    assert.equal(res.status, 409)
  })

  it('a temporary password only opens the door to the change-password screen', async () => {
    const session = await login(state.member.email, state.member.temp)
    state.member.tempCookie = session.session

    const me = await get('/api/auth/me', { cookie: session.session })
    assert.equal(me.status, 200)
    assert.equal(me.data.data.mustChangePassword, true)

    const blocked = await get('/api/clients', { cookie: session.session })
    assert.equal(blocked.status, 403)
    assert.equal(blocked.data.code, 'PASSWORD_CHANGE_REQUIRED')

    const page = await get('/', { cookie: session.session })
    assert.equal(page.status, 307)
    assert.match(page.headers.location, /^\/account/)
  })

  it('changing the password validates input, revokes old sessions, and issues a new one', async () => {
    const cookie = state.member.tempCookie
    const wrongCurrent = await post('/api/auth/change-password', { currentPassword: 'wrong-current-1234', newPassword: 'a brand new passphrase' }, { cookie })
    assert.equal(wrongCurrent.status, 400)
    const weak = await post('/api/auth/change-password', { currentPassword: state.member.temp, newPassword: 'short' }, { cookie })
    assert.equal(weak.status, 400)
    const same = await post('/api/auth/change-password', { currentPassword: state.member.temp, newPassword: state.member.temp }, { cookie })
    assert.equal(same.status, 400)

    const changed = await post('/api/auth/change-password', { currentPassword: state.member.temp, newPassword: 'a brand new passphrase' }, { cookie })
    assert.equal(changed.status, 200)
    assert.ok(changed.session, 'a fresh session cookie is issued')

    assert.equal((await get('/api/auth/me', { cookie })).status, 401, 'the pre-change session must be dead')
    state.member.cookie = changed.session
    assert.equal((await get('/api/clients', { cookie: state.member.cookie })).status, 200)
    state.member.password = 'a brand new passphrase'
  })

  it('members share the workspace: they can read and edit customers', async () => {
    const cookie = state.member.cookie
    const read = await get(`/api/clients/${state.client._id}`, { cookie })
    assert.equal(read.status, 200)
    const edit = await request('PUT', `/api/clients/${state.client._id}`, { body: { company: 'Shared Co' }, cookie })
    assert.equal(edit.status, 200)
    const created = await post('/api/clients', { name: 'Made by Mia' }, { cookie })
    assert.equal(created.status, 201)
    assert.equal(created.data.data.createdBy, state.member.id)
  })

  it('members cannot delete customers, manage users, or escalate themselves', async () => {
    const cookie = state.member.cookie
    assert.equal((await request('DELETE', `/api/clients/${state.client._id}`, { cookie })).status, 403)
    assert.equal((await get('/api/users', { cookie })).status, 403)
    assert.equal((await post('/api/users', { name: 'X', email: 'x@example.test' }, { cookie })).status, 403)
    const escalate = await request('PATCH', `/api/users/${state.member.id}`, { body: { role: 'admin' }, cookie })
    assert.equal(escalate.status, 403)
    const me = await get('/api/auth/me', { cookie })
    assert.equal(me.data.data.role, 'member', 'role must be unchanged')

    // The admin pages bounce members back to the home page.
    const page = await get('/admin/users', { cookie })
    assert.equal(page.status, 307)
    assert.equal(page.headers.location, '/')
  })

  it('note deletion: authors and admins only', async () => {
    const adminNote = await post(`/api/clients/${state.client._id}/notes`, { text: 'Admin note' }, { cookie: state.admin.cookie })
    const memberNote = await post(`/api/clients/${state.client._id}/notes`, { text: 'Member note' }, { cookie: state.member.cookie })
    assert.equal(adminNote.status, 201)
    assert.equal(memberNote.status, 201)

    assert.equal((await request('DELETE', `/api/notes/${adminNote.data.data._id}`, { cookie: state.member.cookie })).status, 403)
    assert.equal((await request('DELETE', `/api/notes/${memberNote.data.data._id}`, { cookie: state.member.cookie })).status, 200)

    const another = await post(`/api/clients/${state.client._id}/notes`, { text: 'Another' }, { cookie: state.member.cookie })
    assert.equal((await request('DELETE', `/api/notes/${another.data.data._id}`, { cookie: state.admin.cookie })).status, 200)
    assert.equal((await request('DELETE', `/api/notes/${adminNote.data.data._id}`, { cookie: state.admin.cookie })).status, 200)
  })

  it('admins cannot lock themselves out', async () => {
    const cookie = state.admin.cookie
    assert.equal((await request('PATCH', `/api/users/${state.admin.id}`, { body: { role: 'member' }, cookie })).status, 400)
    assert.equal((await request('PATCH', `/api/users/${state.admin.id}`, { body: { active: false }, cookie })).status, 400)
  })

  it('unknown and malformed ids return 404', async () => {
    const cookie = state.admin.cookie
    assert.equal((await get(`/api/clients/${OBJECT_ID}`, { cookie })).status, 404)
    assert.equal((await get('/api/clients/not-an-id', { cookie })).status, 404)
    assert.equal((await request('PATCH', `/api/users/${OBJECT_ID}`, { body: { active: false }, cookie })).status, 404)
  })

  it('disabling a user kills their live session immediately', async () => {
    const cookie = state.member.cookie
    assert.equal((await get('/api/clients', { cookie })).status, 200)

    const off = await request('PATCH', `/api/users/${state.member.id}`, { body: { active: false }, cookie: state.admin.cookie })
    assert.equal(off.status, 200)

    assert.equal((await get('/api/clients', { cookie })).status, 401)
    const relogin = await post('/api/auth/login', { email: state.member.email, password: state.member.password })
    assert.equal(relogin.status, 401)
    assert.deepEqual(relogin.data, { success: false, error: 'Invalid email or password' })
  })

  it('re-enabling and resetting a password forces a new change and drops old sessions', async () => {
    const on = await request('PATCH', `/api/users/${state.member.id}`, { body: { active: true }, cookie: state.admin.cookie })
    assert.equal(on.status, 200)
    const session = await login(state.member.email, state.member.password)

    const reset = await request('PATCH', `/api/users/${state.member.id}`, { body: { resetPassword: true }, cookie: state.admin.cookie })
    assert.equal(reset.status, 200)
    assert.match(reset.data.data.temporaryPassword, /^[A-Za-z0-9]{16}$/)
    assert.equal(reset.data.data.user.mustChangePassword, true)

    assert.equal((await get('/api/auth/me', { cookie: session.session })).status, 401, 'reset signs the user out everywhere')
    const old = await post('/api/auth/login', { email: state.member.email, password: state.member.password })
    assert.equal(old.status, 401, 'the old password no longer works')
  })

  it('account throttling applies to real accounts too, even with the correct password', async () => {
    const created = await post('/api/users', { name: 'Lock Target', email: 'locked@example.test' }, { cookie: state.admin.cookie })
    const temp = created.data.data.temporaryPassword
    let last
    for (let i = 0; i < 11; i += 1) {
      last = await post('/api/auth/login', { email: 'locked@example.test', password: 'wrong-password-123' })
    }
    assert.equal(last.status, 429)
    const correct = await post('/api/auth/login', { email: 'locked@example.test', password: temp })
    assert.equal(correct.status, 429, 'correct credentials must not bypass the throttle')
  })
})

describe('redirects and pages', () => {
  it('sends signed-out visitors to /login and remembers where they were going', async () => {
    const res = await get('/clients/abc')
    assert.equal(res.status, 307)
    assert.equal(res.headers.location, '/login?next=%2Fclients%2Fabc')
  })

  it('never redirects to another site after login (open redirect)', async () => {
    const cookie = state.admin.cookie
    for (const next of ['//evil.example', 'https://evil.example', '/\\evil.example', 'javascript:alert(1)']) {
      const res = await get(`/login?next=${encodeURIComponent(next)}`, { cookie })
      assert.equal(res.status, 307, `next=${next}`)
      assert.equal(res.headers.location, '/', `next=${next} must fall back to /`)
    }
    const ok = await get(`/login?next=${encodeURIComponent('/clients/abc')}`, { cookie })
    assert.equal(ok.headers.location, '/clients/abc')
  })

  it('sanitises an unsafe next value before it reaches the signed-out login page', async () => {
    const res = await get(`/login?next=${encodeURIComponent('//evil.example')}`)
    assert.equal(res.status, 200)
    // Next embeds the raw query string in __NEXT_DATA__, so check the page's props instead:
    // that is the value the form redirects to after a successful sign-in.
    const nextData = /<script id="__NEXT_DATA__" type="application\/json"[^>]*>(.*?)<\/script>/s.exec(res.text)
    assert.ok(nextData, '__NEXT_DATA__ present')
    assert.equal(JSON.parse(nextData[1]).props.pageProps.next, '/')
  })

  it('first-run setup is unreachable once an admin exists', async () => {
    const res = await get('/setup')
    assert.equal(res.status, 307)
    assert.equal(res.headers.location, '/login')
  })

  it('the admin area is only for signed-in admins', async () => {
    const signedOut = await get('/admin/users')
    assert.equal(signedOut.status, 307)
    assert.match(signedOut.headers.location, /^\/login/)
    assert.equal((await get('/admin/users', { cookie: state.admin.cookie })).status, 200)
  })
})

describe('response headers and information leakage', () => {
  const pages = ['/login', '/api/health', '/api/auth/setup']
  for (const path of pages) {
    it(`sets security headers on ${path}`, async () => {
      const { headers } = await get(path)
      const csp = headers['content-security-policy']
      assert.ok(csp, 'Content-Security-Policy is set')
      const scriptSrc = csp.split(';').map((d) => d.trim()).find((d) => d.startsWith('script-src'))
      assert.equal(scriptSrc, "script-src 'self'", 'scripts only from our own origin, no inline or eval')
      assert.match(csp, /frame-ancestors 'none'/)
      assert.match(csp, /object-src 'none'/)
      assert.equal(headers['x-content-type-options'], 'nosniff')
      assert.equal(headers['x-frame-options'], 'DENY')
      assert.ok(headers['referrer-policy'])
      assert.ok(headers['permissions-policy'])
      assert.equal(headers['cross-origin-opener-policy'], 'same-origin')
      assert.equal(headers['x-powered-by'], undefined, 'do not advertise the framework')
    })
  }

  it('marks authenticated API responses as uncacheable', async () => {
    const res = await get('/api/clients', { cookie: state.admin.cookie })
    assert.match(res.headers['cache-control'], /no-store/)
  })

  it('ships no inline executable scripts (so the CSP can forbid them)', async () => {
    const { text } = await get('/login')
    const inline = [...text.matchAll(/<script(?![^>]*\bsrc=)(?![^>]*type="application\/json")[^>]*>/g)]
    assert.equal(inline.length, 0)
  })

  it('does not leak internals on unknown routes or server errors', async () => {
    const missing = await get('/api/definitely-not-a-route', { cookie: state.admin.cookie })
    assert.equal(missing.status, 404)
    assert.doesNotMatch(missing.text, /node_modules|\bat .*\.js:\d+/)
  })

  it('escapes regex characters in search instead of running them', async () => {
    const res = await get(`/api/clients?q=${encodeURIComponent('.*')}`, { cookie: state.admin.cookie })
    assert.equal(res.status, 200)
    assert.equal(res.data.total, 0)
  })

  it('ignores query-operator injection on the news lookup', async () => {
    const res = await get('/api/news?company[$ne]=x', { cookie: state.admin.cookie })
    assert.equal(res.status, 200)
    assert.deepEqual(res.data.data, [])
  })
})
