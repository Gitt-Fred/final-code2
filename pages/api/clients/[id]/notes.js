import dbConnect from '../../../../lib/mong-connect'
import Client from '../../../../model/client.js'
import Note from '../../../../model/note.js'
import {
  isObjectId,
  methodNotAllowed,
  notFound,
  persistenceDisabled,
  persistenceEnabled,
  sendError,
} from '../../../../lib/api-helpers'

export default async function handler(req, res) {
  const { id } = req.query
  const persistent = persistenceEnabled()

  if (!isObjectId(id)) {
    return notFound(res)
  }

  try {
    switch (req.method) {
      case 'GET': {
        if (!persistent) {
          return res.status(200).json({ success: true, data: [] })
        }
        await dbConnect()
        const notes = await Note.find({ client: id }).sort({ createdAt: -1 }).lean()
        return res.status(200).json({ success: true, data: notes })
      }
      case 'POST': {
        if (!persistent) {
          return persistenceDisabled(res)
        }
        await dbConnect()
        if (!(await Client.exists({ _id: id }))) {
          return notFound(res)
        }
        const text = typeof req.body?.text === 'string' ? req.body.text : ''
        const note = await Note.create({ client: id, text })
        return res.status(201).json({ success: true, data: note })
      }
      default:
        return methodNotAllowed(req, res, ['GET', 'POST'])
    }
  } catch (error) {
    return sendError(res, error)
  }
}
