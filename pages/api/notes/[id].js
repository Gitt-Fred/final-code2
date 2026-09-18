import Note from '../../../model/note.js'
import { withAuth } from '../../../lib/auth'
import { isObjectId, notFound } from '../../../lib/api-helpers'

export const config = { api: { bodyParser: { sizeLimit: '10kb' } } }

// Members can delete their own notes; admins can delete any. Notes from before
// accounts existed have no author, so only an admin can remove them.
async function deleteNote(req, res, { user }) {
  const { id } = req.query
  if (!isObjectId(id)) return notFound(res)

  const note = await Note.findById(id).lean()
  if (!note) return notFound(res)

  const isAuthor = note.createdBy && String(note.createdBy) === String(user._id)
  if (user.role !== 'admin' && !isAuthor) {
    return res.status(403).json({ success: false, error: 'Forbidden' })
  }

  await Note.deleteOne({ _id: id })
  return res.status(200).json({ success: true, data: {} })
}

export default withAuth({ DELETE: { handler: deleteNote } })
