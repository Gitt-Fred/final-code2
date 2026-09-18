import { useState } from 'react'
import { useRouter } from 'next/router'
import AuthCard from '../components/AuthCard'
import { api } from '../lib/api'
import dbConnect from '../lib/mong-connect'
import { PASSWORD_MIN_LENGTH } from '../lib/password'
import User from '../model/user'

// First-run setup only exists until the first admin has been created.
export async function getServerSideProps() {
  await dbConnect()
  if (await User.exists({})) {
    return { redirect: { destination: '/login', permanent: false } }
  }
  return { props: { minLength: PASSWORD_MIN_LENGTH } }
}

export default function Setup({ minLength }) {
  const router = useRouter()
  const [values, setValues] = useState({ name: '', email: '', password: '', confirm: '' })
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const update = (field) => (event) => setValues((current) => ({ ...current, [field]: event.target.value }))

  const submit = async (event) => {
    event.preventDefault()
    if (values.password !== values.confirm) {
      setError('Passwords do not match')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      await api('/api/auth/setup', {
        method: 'POST',
        body: { name: values.name, email: values.email, password: values.password },
        redirectOnAuthError: false,
      })
      router.push('/')
    } catch (err) {
      setError(err.message)
      setSubmitting(false)
    }
  }

  return (
    <AuthCard
      title="Create the admin account"
      subtitle="This is a fresh install. The first account you create becomes the administrator; it can then add everyone else."
    >
      <form onSubmit={submit} className="space-y-4">
        {error ? (
          <div className="alert alert-error text-sm" role="alert">
            <span>{error}</span>
          </div>
        ) : null}
        <label className="form-control block">
          <span className="label-text mb-1 block font-medium">Name</span>
          <input type="text" required maxLength={120} autoComplete="name" autoFocus value={values.name} onChange={update('name')} className="input input-bordered w-full" />
        </label>
        <label className="form-control block">
          <span className="label-text mb-1 block font-medium">Email</span>
          <input type="email" required maxLength={254} autoComplete="username" value={values.email} onChange={update('email')} className="input input-bordered w-full" />
        </label>
        <label className="form-control block">
          <span className="label-text mb-1 block font-medium">Password</span>
          <input type="password" required minLength={minLength} maxLength={128} autoComplete="new-password" value={values.password} onChange={update('password')} className="input input-bordered w-full" />
          <span className="label-text-alt mt-1 block text-base-content/60">At least {minLength} characters. A short passphrase of several words works well.</span>
        </label>
        <label className="form-control block">
          <span className="label-text mb-1 block font-medium">Confirm password</span>
          <input type="password" required maxLength={128} autoComplete="new-password" value={values.confirm} onChange={update('confirm')} className="input input-bordered w-full" />
        </label>
        <button type="submit" className={`btn btn-primary w-full ${submitting ? 'loading' : ''}`} disabled={submitting}>
          Create admin account
        </button>
      </form>
    </AuthCard>
  )
}
