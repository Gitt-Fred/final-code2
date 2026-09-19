import Attachment from '../../../model/attachment'
import logger from '../../../lib/logger'
import { withAuth } from '../../../lib/auth'
import { isObjectId, notFound } from '../../../lib/api-helpers'
import { contentDisposition, deleteAttachment } from '../../../lib/attachments'
import { openFile } from '../../../lib/gridfs'

export const config = { api: { bodyParser: { sizeLimit: '1kb' } } }

async function downloadFile(req, res) {
  const { id } = req.query
  if (!isObjectId(id)) return notFound(res)

  const doc = await Attachment.findById(id).lean()
  if (!doc) return notFound(res)

  // Every header comes from what the server detected at upload time.
  res.setHeader('Content-Type', doc.contentType)
  res.setHeader('Content-Length', String(doc.size))
  res.setHeader('Content-Disposition', contentDisposition(doc.filename))
  res.setHeader('X-Content-Type-Options', 'nosniff')
  // If a file were ever rendered as a document anyway, it runs no script, has no
  // same-origin access, and can load nothing.
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox")

  await new Promise((resolve) => {
    const stream = openFile(doc.fileId)
    stream.once('error', (error) => {
      logger.error({ err: error, attachmentId: id }, 'Could not read attachment')
      if (res.headersSent) res.destroy()
      else notFound(res)
      resolve()
    })
    stream.once('end', resolve)
    stream.pipe(res)
  })
}

// Uploaders can delete their own files; admins can delete any.
async function removeAttachment(req, res, { user }) {
  const { id } = req.query
  if (!isObjectId(id)) return notFound(res)

  const doc = await Attachment.findById(id).lean()
  if (!doc) return notFound(res)

  const isOwner = doc.createdBy && String(doc.createdBy) === String(user._id)
  if (user.role !== 'admin' && !isOwner) {
    return res.status(403).json({ success: false, error: 'Forbidden' })
  }

  await deleteAttachment(doc)
  logger.info({ event: 'file_deleted', userId: String(user._id), attachmentId: id })
  return res.status(200).json({ success: true, data: {} })
}

export default withAuth({
  GET: { handler: downloadFile },
  DELETE: { handler: removeAttachment },
})
