import { useState } from 'react'
import { useRouter } from 'next/router'
import Layout from '../components/Layout'
import { useToast } from '../components/Toast'
import { api } from '../lib/api'
import { requireUserSSR } from '../lib/auth'
import { PASSWORD_MIN_LENGTH } from '../lib/password'

export async function getServerSideProps(context) {
  const result = await requireUserSSR(context)
  if (result.props) {
    result.props.minLength = PASSWORD_MIN_LENGTH
  }
  return result
}

export default function Account({ user, minLength }) {
  const router = useRouter()
  const toast = useToast()
  const required = router.query.required === '1' || user.mustChangePassword
  const [values, setValues] = useState({ current: '', next: '', confirm: '' })
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const update = (field) => (event) => setValues((current) => ({ ...current, [field]: event.target.value }))

  const submit = async (event) => {
    event.preventDefault()
    if (values.next !== values.confirm) {
      setError('New passwords do not match')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      await api('/api/auth/change-password', {
        method: 'POST',
        body: { currentPassword: values.current, newPassword: values.next },
      })
      toast('Password changed. You have been signed out of your other sessions.')
      router.push('/')
    } catch (err) {
      setError(err.message)
      setSubmitting(false)
    }
  }

  return (
    <Layout title="Account" user={user}>
      <div className="mx-auto max-w-xl">
        <h1 className="mb-6 text-3xl font-bold">Account</h1>

        {required ? (
          <div className="alert alert-warning mb-6" role="alert">
            <span>You are using a temporary password. Choose a new one to continue.</span>
          </div>
        ) : null}

        <section className="mb-6 rounded-2xl border border-base-300 bg-base-100 p-6">
          <dl className="grid grid-cols-[6rem_1fr] gap-y-2 text-sm">
            <dt className="text-base-content/60">Name</dt>
            <dd>{user.name}</dd>
            <dt className="text-base-content/60">Email</dt>
            <dd className="break-all">{user.email}</dd>
            <dt className="text-base-content/60">Role</dt>
            <dd>{user.role}</dd>
          </dl>
        </section>

        <section className="rounded-2xl border border-base-300 bg-base-100 p-6">
          <h2 className="mb-4 text-xl font-semibold">Change password</h2>
          <form onSubmit={submit} className="space-y-4">
            {error ? (
              <div className="alert alert-error text-sm" role="alert">
                <span>{error}</span>
              </div>
            ) : null}
            <label className="form-control block">
              <span className="label-text mb-1 block font-medium">Current password</span>
              <input type="password" required autoComplete="current-password" value={values.current} onChange={update('current')} className="input input-bordered w-full" />
            </label>
            <label className="form-control block">
              <span className="label-text mb-1 block font-medium">New password</span>
              <input type="password" required minLength={minLength} maxLength={128} autoComplete="new-password" value={values.next} onChange={update('next')} className="input input-bordered w-full" />
              <span className="label-text-alt mt-1 block text-base-content/60">At least {minLength} characters.</span>
            </label>
            <label className="form-control block">
              <span className="label-text mb-1 block font-medium">Confirm new password</span>
              <input type="password" required maxLength={128} autoComplete="new-password" value={values.confirm} onChange={update('confirm')} className="input input-bordered w-full" />
            </label>
            <div className="flex justify-end">
              <button type="submit" className={`btn btn-primary ${submitting ? 'loading' : ''}`} disabled={submitting}>
                Change password
              </button>
            </div>
          </form>
        </section>
      </div>
    </Layout>
  )
}
