// File bytes live in a MongoDB GridFS bucket, so the app container keeps its
// read-only filesystem. Metadata lives in the Attachment model.
import mongoose from 'mongoose'

const BUCKET = 'attachmentData'

export const getBucket = () => new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: BUCKET })

export function storeFile(buffer, filename) {
  return new Promise((resolve, reject) => {
    const stream = getBucket().openUploadStream(filename)
    stream.once('error', reject)
    stream.once('finish', () => resolve(stream.id))
    stream.end(buffer)
  })
}

// Deleting a file that is already gone is not an error.
export async function removeFile(id) {
  try {
    await getBucket().delete(new mongoose.Types.ObjectId(String(id)))
  } catch (error) {
    if (!/FileNotFound|File not found/i.test(error?.message || '')) throw error
  }
}

export const openFile = (id) => getBucket().openDownloadStream(new mongoose.Types.ObjectId(String(id)))
