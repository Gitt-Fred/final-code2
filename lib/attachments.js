import Attachment from '../model/attachment'
import { removeFile } from './gridfs'

const DEFAULT_MAX_FILES = 20

export function maxFilesPerClient() {
  const configured = Number.parseInt(process.env.MAX_FILES_PER_CLIENT, 10)
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_MAX_FILES
}

function publicAuthor(createdBy) {
  if (!createdBy) return null
  if (createdBy._id) return { _id: String(createdBy._id), name: createdBy.name }
  return { _id: String(createdBy) }
}

// What the browser gets: no internal GridFS id.
export const publicAttachment = (doc) => ({
  _id: String(doc._id),
  filename: doc.filename,
  contentType: doc.contentType,
  kind: doc.kind,
  size: doc.size,
  createdAt: doc.createdAt,
  createdBy: publicAuthor(doc.createdBy),
})

// Removes the bytes first, then the metadata, so a failure part-way never leaves
// unreachable chunks behind (a leftover metadata row just 404s on download).
export async function deleteAttachment(doc) {
  await removeFile(doc.fileId)
  await Attachment.deleteOne({ _id: doc._id })
}

export async function deleteClientAttachments(clientId) {
  const docs = await Attachment.find({ client: clientId }).select('fileId').lean()
  for (const doc of docs) {
    await deleteAttachment(doc)
  }
}

// RFC 6266 Content-Disposition with an ASCII fallback and an RFC 5987 UTF-8 name.
// Always "attachment": navigating to a file downloads it and never renders it as a
// page in our origin. <img src> ignores this header, so image previews still work.
export function contentDisposition(filename) {
  const fallback = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}
