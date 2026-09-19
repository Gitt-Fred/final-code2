import Attachment from '../../../../model/attachment'
import Client from '../../../../model/client.js'
import logger from '../../../../lib/logger'
import { withAuth } from '../../../../lib/auth'
import { isObjectId, notFound } from '../../../../lib/api-helpers'
import { maxFilesPerClient, publicAttachment } from '../../../../lib/attachments'
import { ACCEPTED_DESCRIPTION, detectFileType } from '../../../../lib/file-type'
import { removeFile, storeFile } from '../../../../lib/gridfs'
import { hit } from '../../../../lib/rate-limit'
import { sanitizeFilename } from '../../../../lib/sanitize'
import { UploadError, readBody, withUploadSlot } from '../../../../lib/upload'

// The upload is the raw request body (Content-Type: application/octet-stream), so
// Next must not try to parse it. See lib/upload.js for the size limits.
export const config = { api: { bodyParser: false } }

async function listFiles(req, res) {
  const { id } = req.query
  if (!isObjectId(id)) return notFound(res)

  const docs = await Attachment.find({ client: id }).sort({ createdAt: -1 }).populate('createdBy', 'name').lean()
  return res.status(200).json({ success: true, data: docs.map(publicAttachment) })
}

async function uploadFile(req, res, { user, ip }) {
  const { id } = req.query
  if (!isObjectId(id)) return notFound(res)
  if (!(await Client.exists({ _id: id }))) return notFound(res)

  const limit = await hit(`upload:${user._id}`, { limit: 30, windowMs: 10 * 60 * 1000 })
  if (!limit.allowed) {
    res.setHeader('Retry-After', String(limit.retryAfter))
    return res.status(429).json({ success: false, error: 'Too many uploads. Try again later.' })
  }

  // Not atomic with the insert below, so two simultaneous uploads can overshoot by
  // one; this is a tidiness cap, not a security boundary.
  const maxFiles = maxFilesPerClient()
  if ((await Attachment.countDocuments({ client: id })) >= maxFiles) {
    return res.status(409).json({ success: false, error: `A customer can have at most ${maxFiles} files` })
  }

  const declaredName = typeof req.query.name === 'string' ? req.query.name.slice(0, 255) : ''

  let buffer
  try {
    buffer = await withUploadSlot(() => readBody(req))
  } catch (error) {
    if (!(error instanceof UploadError)) throw error
    return res.status(error.status).json({ success: false, error: error.message })
  }
  if (buffer.length === 0) {
    return res.status(400).json({ success: false, error: 'The file is empty' })
  }

  const type = detectFileType(buffer, declaredName)
  if (!type) {
    logger.warn(
      { event: 'upload_rejected', userId: String(user._id), ip, clientId: id, size: buffer.length },
      'Rejected upload of a disallowed file type'
    )
    return res.status(415).json({ success: false, error: `That file type is not allowed. Upload ${ACCEPTED_DESCRIPTION}.` })
  }

  const filename = sanitizeFilename(declaredName, type.ext)
  const fileId = await storeFile(buffer, filename)
  let doc
  try {
    doc = await Attachment.create({
      client: id,
      filename,
      contentType: type.mime,
      kind: type.kind,
      size: buffer.length,
      fileId,
      createdBy: user._id,
    })
  } catch (error) {
    await removeFile(fileId)
    throw error
  }

  logger.info({
    event: 'file_uploaded',
    userId: String(user._id),
    clientId: id,
    attachmentId: String(doc._id),
    contentType: type.mime,
    size: buffer.length,
  })
  const created = { ...doc.toObject(), createdBy: { _id: user._id, name: user.name } }
  return res.status(201).json({ success: true, data: publicAttachment(created) })
}

export default withAuth({
  GET: { handler: listFiles },
  POST: { contentType: 'application/octet-stream', handler: uploadFile },
})
