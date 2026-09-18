import dbConnect from '../../../lib/mong-connect'
import Client from '../../../model/client.js'
import News from '../../../model/news.js'
import Note from '../../../model/note.js'
import {
  isObjectId,
  methodNotAllowed,
  notFound,
  persistenceDisabled,
  persistenceEnabled,
  pickClientFields,
  sampleClients,
  sendError,
} from '../../../lib/api-helpers'

// News documents hold an `articles` array per company; flatten them for the client.
function collectArticles(newsDocs) {
  return newsDocs.flatMap((doc) => {
    if (Array.isArray(doc.articles)) return doc.articles
    return doc.articles ? [doc.articles] : []
  })
}

export default async function handler(req, res) {
  const { id } = req.query
  const persistent = persistenceEnabled()

  if (!isObjectId(id)) {
    return notFound(res)
  }

  try {
    if (persistent) {
      await dbConnect()
    }

    switch (req.method) {
      case 'GET': {
        if (!persistent) {
          const sample = sampleClients.find((client) => client._id === id)
          return sample
            ? res.status(200).json({ success: true, data: { ...sample, articles: [] } })
            : notFound(res)
        }

        const client = await Client.findById(id).lean()
        if (!client) {
          return notFound(res)
        }
        const newsDocs = client.company ? await News.find({ company: client.company }).lean() : []
        return res.status(200).json({
          success: true,
          data: { ...client, articles: collectArticles(newsDocs) },
        })
      }
      case 'PUT': {
        if (!persistent) {
          return persistenceDisabled(res)
        }
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
      case 'DELETE': {
        if (!persistent) {
          return persistenceDisabled(res)
        }
        const deleted = await Client.findByIdAndDelete(id)
        if (!deleted) {
          return notFound(res)
        }
        await Note.deleteMany({ client: id })
        return res.status(200).json({ success: true, data: {} })
      }
      default:
        return methodNotAllowed(req, res, ['GET', 'PUT', 'DELETE'])
    }
  } catch (error) {
    return sendError(res, error)
  }
}
