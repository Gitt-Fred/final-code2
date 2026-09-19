import mongoose from 'mongoose'

// Metadata for a file attached to a customer. The bytes are in GridFS (lib/gridfs.js).
// Every field here is set by the server from the detected file type, never from
// what the browser claimed.
const AttachmentSchema = new mongoose.Schema(
  {
    client: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true, index: true },
    filename: { type: String, required: true, maxlength: 120 },
    contentType: { type: String, required: true },
    kind: { type: String, enum: ['image', 'document', 'text'], required: true },
    size: { type: Number, required: true },
    fileId: { type: mongoose.Schema.Types.ObjectId, required: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
)

export default mongoose.models.Attachment || mongoose.model('Attachment', AttachmentSchema)
