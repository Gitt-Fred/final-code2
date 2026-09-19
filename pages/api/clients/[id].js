import Client from '../../../model/client.js'
import News from '../../../model/news.js'
import Note from '../../../model/note.js'
import { withAuth } from '../../../lib/auth'
import { isObjectId, notFound, pickClientFields } from '../../../lib/api-helpers'
import { deleteClientAttachments } from '../../../lib/attachments'

export const config = { api: { bodyParser: { sizeLimit: '50kb' } } }

// News documents hold an `articles` array per company; flatten them for the client.
function collectArticles(newsDocs) {
  return newsDocs.flatMap((doc) => {
    if (Array.isArray(doc.articles)) return doc.articles
    return doc.articles ? [doc.articles] : []
  })
}

async function getClient(req, res) {
  const { id } = req.query
  if (!isObjectId(id)) return notFound(res)

  const client = await Client.findById(id).populate('createdBy', 'name').lean()
  if (!client) return notFound(res)

  const newsDocs = client.company ? await News.find({ company: client.company }).lean() : []
  return res.status(200).json({
    success: true,
    data: { ...client, articles: collectArticles(newsDocs) },
  })
}

async function updateClient(req, res) {
  const { id } = req.query
  if (!isObjectId(id)) return notFound(res)

  const update = pickClientFields(req.body)
  if (Object.keys(update).length === 0) {
    return res.status(400).json({ success: false, error: 'No fields to update' })
  }
  const client = await Client.findByIdAndUpdate(id, update, {
    new: true,
    runValidators: true,
  }).lean()
  return client ? res.status(200).json({ success: true, data: client }) : notFound(res)
}

async function deleteClient(req, res) {
  const { id } = req.query
  if (!isObjectId(id)) return notFound(res)

  const deleted = await Client.findByIdAndDelete(id)
  if (!deleted) return notFound(res)
  await Note.deleteMany({ client: id })
  await deleteClientAttachments(id)
  return res.status(200).json({ success: true, data: {} })
}

export default withAuth({
  GET: { handler: getClient },
  PUT: { handler: updateClient },
  DELETE: { role: 'admin', handler: deleteClient },
})
