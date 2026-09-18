import { useState } from 'react'
import { PlusIcon } from '@heroicons/react/outline'
import Layout from '../../components/Layout'
import Modal from '../../components/Modal'
import { useToast } from '../../components/Toast'
import { api } from '../../lib/api'
import { requireUserSSR } from '../../lib/auth'
import { formatDate } from '../../lib/format'
import useApi from '../../lib/useApi'

export async function getServerSideProps(context) {
  return requireUserSSR(context, { role: 'admin' })
}

function NewUserForm({ onSubmit, onCancel }) {
  const [values, setValues] = useState({ name: '', email: '', role: 'member' })
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const update = (field) => (event) => setValues((current) => ({ ...current, [field]: event.target.value }))

  const submit = async (event) => {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      await onSubmit(values)
    } catch (err) {
      setError(err.message)
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {error ? (
        <div className="alert alert-error text-sm" role="alert">
          <span>{error}</span>
        </div>
      ) : null}
      <label className="form-control block">
        <span className="label-text mb-1 block font-medium">Name</span>
        <input type="text" required maxLength={120} value={values.name} onChange={update('name')} className="input input-bordered w-full" />
      </label>
      <label className="form-control block">
        <span className="label-text mb-1 block font-medium">Email</span>
        <input type="email" required maxLength={254} value={values.email} onChange={update('email')} className="input input-bordered w-full" />
      </label>
      <label className="form-control block">
        <span className="label-text mb-1 block font-medium">Role</span>
        <select value={values.role} onChange={update('role')} className="select select-bordered w-full">
          <option value="member">Member: can manage customers and notes</option>
          <option value="admin">Admin: can also delete customers and manage users</option>
        </select>
      </label>
      <p className="text-sm text-base-content/70">
        A temporary password is generated and shown once. The person must replace it when they first sign in.
      </p>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={submitting}>
          Cancel
        </button>
        <button type="submit" className={`btn btn-primary ${submitting ? 'loading' : ''}`} disabled={submitting}>
          Create user
        </button>
      </div>
    </form>
  )
}

export default function Users({ user }) {
  const toast = useToast()
  const { data, error, reload } = useApi('/api/users')
  const [creating, setCreating] = useState(false)
  const [resetting, setResetting] = useState(null)
  const [credential, setCredential] = useState(null)

  const users = data?.data ?? []

  const createUser = async (values) => {
    const json = await api('/api/users', { method: 'POST', body: values })
    setCreating(false)
    setCredential({ name: json.data.user.name, email: json.data.user.email, password: json.data.temporaryPassword })
    reload()
  }

  const update = async (target, body, message) => {
    try {
      const json = await api(`/api/users/${target.id}`, { method: 'PATCH', body })
      toast(message)
      if (json.data.temporaryPassword) {
        setCredential({ name: target.name, email: target.email, password: json.data.temporaryPassword })
      }
      reload()
    } catch (err) {
      toast(err.message, 'error')
    }
  }

  const confirmReset = async () => {
    const target = resetting
    setResetting(null)
    await update(target, { resetPassword: true }, 'Password reset')
  }

  const copyPassword = async () => {
    try {
      await navigator.clipboard.writeText(credential.password)
      toast('Copied to clipboard')
    } catch {
      toast('Could not copy. Select the password and copy it manually.', 'error')
    }
  }

  return (
    <Layout title="Users" user={user}>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Users</h1>
          <p className="text-base-content/70">Create accounts and manage who can do what.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
          <PlusIcon className="mr-1 h-5 w-5" />
          Add user
        </button>
      </div>

      {error ? (
        <div className="alert alert-error">
          <span>Could not load users: {error.message}</span>
          <button type="button" className="btn btn-sm" onClick={reload}>
            Retry
          </button>
        </div>
      ) : !data ? (
        <div className="h-40 animate-pulse rounded-2xl bg-base-100" />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-base-300 bg-base-100">
          <table className="table w-full">
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th>Status</th>
                <th>Last sign-in</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((row) => {
                const isSelf = row.id === user.id
                return (
                  <tr key={row.id}>
                    <td>
                      <div className="font-medium">
                        {row.name} {isSelf ? <span className="badge badge-sm ml-1">you</span> : null}
                      </div>
                      <div className="text-sm text-base-content/60">{row.email}</div>
                    </td>
                    <td>
                      <select
                        aria-label={`Role for ${row.name}`}
                        value={row.role}
                        disabled={isSelf}
                        onChange={(event) => update(row, { role: event.target.value }, 'Role updated')}
                        className="select select-bordered select-sm"
                      >
                        <option value="member">member</option>
                        <option value="admin">admin</option>
                      </select>
                    </td>
                    <td>
                      {row.active ? (
                        <span className="badge badge-success badge-outline">active</span>
                      ) : (
                        <span className="badge badge-error badge-outline">disabled</span>
                      )}
                      {row.mustChangePassword ? <span className="badge badge-warning badge-outline ml-1">temp password</span> : null}
                    </td>
                    <td className="text-sm">{row.lastLoginAt ? formatDate(row.lastLoginAt) : 'Never'}</td>
                    <td className="text-right">
                      <div className="flex justify-end gap-2">
                        <button type="button" className="btn btn-outline btn-xs" onClick={() => setResetting(row)}>
                          Reset password
                        </button>
                        <button
                          type="button"
                          className="btn btn-outline btn-xs"
                          disabled={isSelf}
                          onClick={() => update(row, { active: !row.active }, row.active ? 'User disabled' : 'User enabled')}
                        >
                          {row.active ? 'Disable' : 'Enable'}
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={creating} onClose={() => setCreating(false)} title="Add user">
        <NewUserForm onSubmit={createUser} onCancel={() => setCreating(false)} />
      </Modal>

      <Modal open={Boolean(resetting)} onClose={() => setResetting(null)} title="Reset password">
        <p className="mb-6">
          Reset the password for <strong>{resetting?.name}</strong>? They will be signed out everywhere and must choose a new
          password at their next sign-in.
        </p>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={() => setResetting(null)}>
            Cancel
          </button>
          <button type="button" className="btn btn-error" onClick={confirmReset}>
            Reset password
          </button>
        </div>
      </Modal>

      <Modal open={Boolean(credential)} onClose={() => setCredential(null)} title="Temporary password">
        <p className="mb-4 text-sm">
          Give this to <strong>{credential?.name}</strong> ({credential?.email}). It is shown only once and must be changed at first
          sign-in.
        </p>
        <div className="mb-6 rounded-lg bg-base-200 p-4 text-center font-mono text-lg tracking-wide select-all">
          {credential?.password}
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={copyPassword}>
            Copy
          </button>
          <button type="button" className="btn btn-primary" onClick={() => setCredential(null)}>
            Done
          </button>
        </div>
      </Modal>
    </Layout>
  )
}
