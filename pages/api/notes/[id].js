import dbConnect from '../../../lib/mong-connect'
import Note from '../../../model/note.js'
import {
  isObjectId,
  methodNotAllowed,
  notFound,
  persistenceDisabled,
  persistenceEnabled,
  sendError,
} from '../../../lib/api-helpers'

export default async function handler(req, res) {
  const { id } = req.query

  if (!isObjectId(id)) {
    return notFound(res)
  }
  if (req.method !== 'DELETE') {
    return methodNotAllowed(req, res, ['DELETE'])
  }
  if (!persistenceEnabled()) {
    return persistenceDisabled(res)
  }

  try {
    await dbConnect()
    const deleted = await Note.findByIdAndDelete(id)
    return deleted ? res.status(200).json({ success: true, data: {} }) : notFound(res)
  } catch (error) {
    return sendError(res, error)
  }
}
