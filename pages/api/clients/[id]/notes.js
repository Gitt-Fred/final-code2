import Client from '../../../../model/client.js'
import Note from '../../../../model/note.js'
import { withAuth } from '../../../../lib/auth'
import { isObjectId, notFound } from '../../../../lib/api-helpers'

export const config = { api: { bodyParser: { sizeLimit: '20kb' } } }

async function listNotes(req, res) {
  const { id } = req.query
  if (!isObjectId(id)) return notFound(res)

  const notes = await Note.find({ client: id })
    .sort({ createdAt: -1 })
    .populate('createdBy', 'name')
    .lean()
  return res.status(200).json({ success: true, data: notes })
}

async function createNote(req, res, { user }) {
  const { id } = req.query
  if (!isObjectId(id)) return notFound(res)
  if (!(await Client.exists({ _id: id }))) return notFound(res)

  const text = typeof req.body?.text === 'string' ? req.body.text : ''
  const note = await Note.create({ client: id, text, createdBy: user._id })
  return res.status(201).json({ success: true, data: note })
}

export default withAuth({
  GET: { handler: listNotes },
  POST: { handler: createNote },
})
