import { useState } from 'react'
import { TrashIcon } from '@heroicons/react/outline'
import { api } from '../lib/api'
import { formatDate } from '../lib/format'
import useApi from '../lib/useApi'
import { useToast } from './Toast'

export default function Notes({ clientId, currentUser }) {
  const toast = useToast()
  const { data, error, reload } = useApi(`/api/clients/${clientId}/notes`)
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)

  const addNote = async (event) => {
    event.preventDefault()
    setSaving(true)
    try {
      await api(`/api/clients/${clientId}/notes`, { method: 'POST', body: { text } })
      setText('')
      reload()
    } catch (err) {
      toast(err.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  const deleteNote = async (noteId) => {
    try {
      await api(`/api/notes/${noteId}`, { method: 'DELETE' })
      toast('Note deleted')
      reload()
    } catch (err) {
      toast(err.message, 'error')
    }
  }

  const notes = data?.data ?? []

  return (
    <section className="rounded-2xl border border-base-300 bg-base-100 p-6">
      <h2 className="mb-4 text-xl font-semibold">Notes</h2>

      <form onSubmit={addNote} className="mb-6">
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          maxLength={2000}
          rows={3}
          className="textarea textarea-bordered w-full"
          placeholder="Write a note about this customer"
          aria-label="New note"
        />
        <div className="mt-2 flex justify-end">
          <button
            type="submit"
            className={`btn btn-primary btn-sm ${saving ? 'loading' : ''}`}
            disabled={saving || text.trim() === ''}
          >
            Add note
          </button>
        </div>
      </form>

      {error ? (
        <div className="alert alert-error text-sm">
          <span>Could not load notes: {error.message}</span>
          <button type="button" className="btn btn-xs" onClick={reload}>
            Retry
          </button>
        </div>
      ) : !data ? (
        <div className="space-y-3">
          <div className="h-16 animate-pulse rounded-lg bg-base-200" />
          <div className="h-16 animate-pulse rounded-lg bg-base-200" />
        </div>
      ) : notes.length === 0 ? (
        <p className="text-base-content/70">No notes yet.</p>
      ) : (
        <ul className="space-y-3">
          {notes.map((note) => {
            // The API enforces this too: authors delete their own notes, admins any.
            const canDelete = currentUser.role === 'admin' || note.createdBy?._id === currentUser.id
            return (
              <li key={note._id} className="rounded-lg bg-base-200 p-4">
                <p className="whitespace-pre-wrap break-words">{note.text}</p>
                <div className="mt-2 flex items-center justify-between text-xs text-base-content/60">
                  <span>
                    {note.createdBy?.name ? `${note.createdBy.name} · ` : ''}
                    {formatDate(note.createdAt)}
                  </span>
                  {canDelete ? (
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs"
                      onClick={() => deleteNote(note._id)}
                      aria-label="Delete note"
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  ) : null}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
