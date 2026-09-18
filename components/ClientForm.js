import { useState } from 'react'

const emptyValues = { name: '', company: '', email: '', website: '' }

// Shared by "Add customer" and "Edit customer". `onSubmit(values)` should reject
// with an Error to show its message inside the form.
export default function ClientForm({ initialValues = emptyValues, submitLabel, onSubmit, onCancel }) {
  const [values, setValues] = useState({ ...emptyValues, ...initialValues })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const update = (field) => (event) => setValues((current) => ({ ...current, [field]: event.target.value }))

  const handleSubmit = async (event) => {
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
    <form onSubmit={handleSubmit} className="space-y-4">
      {error ? (
        <div className="alert alert-error text-sm">
          <span>{error}</span>
        </div>
      ) : null}

      <label className="form-control block">
        <span className="label-text mb-1 block font-medium">Name</span>
        <input
          type="text"
          required
          maxLength={120}
          value={values.name}
          onChange={update('name')}
          className="input input-bordered w-full"
          placeholder="Jane Smith"
        />
      </label>
      <label className="form-control block">
        <span className="label-text mb-1 block font-medium">Company</span>
        <input
          type="text"
          maxLength={120}
          value={values.company}
          onChange={update('company')}
          className="input input-bordered w-full"
          placeholder="Acme Inc."
        />
      </label>
      <label className="form-control block">
        <span className="label-text mb-1 block font-medium">Email</span>
        <input
          type="email"
          maxLength={254}
          value={values.email}
          onChange={update('email')}
          className="input input-bordered w-full"
          placeholder="jane@acme.com"
        />
      </label>
      <label className="form-control block">
        <span className="label-text mb-1 block font-medium">Website</span>
        <input
          type="text"
          value={values.website}
          onChange={update('website')}
          className="input input-bordered w-full"
          placeholder="acme.com"
        />
      </label>

      <div className="flex justify-end gap-2 pt-2">
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={submitting}>
          Cancel
        </button>
        <button type="submit" className={`btn btn-primary ${submitting ? 'loading' : ''}`} disabled={submitting}>
          {submitLabel}
        </button>
      </div>
    </form>
  )
}
