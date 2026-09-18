import { useState } from 'react'
import { useRouter } from 'next/router'
import AuthCard from '../components/AuthCard'
import { api } from '../lib/api'
import { getAuth } from '../lib/auth'
import dbConnect from '../lib/mong-connect'
import { safeNext } from '../lib/security'
import User from '../model/user'

export async function getServerSideProps(context) {
  await dbConnect()
  const next = safeNext(context.query.next)

  if (await getAuth(context.req)) {
    return { redirect: { destination: next, permanent: false } }
  }
  // A brand-new install has no users yet.
  if (!(await User.exists({}))) {
    return { redirect: { destination: '/setup', permanent: false } }
  }
  return { props: { next } }
}

export default function Login({ next }) {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const submit = async (event) => {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      await api('/api/auth/login', {
        method: 'POST',
        body: { email, password },
        redirectOnAuthError: false,
      })
      router.push(next)
    } catch (err) {
      setError(err.message)
      setSubmitting(false)
    }
  }

  return (
    <AuthCard title="Sign in" subtitle="Enter your account details to continue.">
      <form onSubmit={submit} className="space-y-4">
        {error ? (
          <div className="alert alert-error text-sm" role="alert">
            <span>{error}</span>
          </div>
        ) : null}
        <label className="form-control block">
          <span className="label-text mb-1 block font-medium">Email</span>
          <input
            type="email"
            required
            autoComplete="username"
            autoFocus
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="input input-bordered w-full"
          />
        </label>
        <label className="form-control block">
          <span className="label-text mb-1 block font-medium">Password</span>
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="input input-bordered w-full"
          />
        </label>
        <button
          type="submit"
          className={`btn btn-primary w-full ${submitting ? 'loading' : ''}`}
          disabled={submitting}
        >
          Sign in
        </button>
      </form>
    </AuthCard>
  )
}
