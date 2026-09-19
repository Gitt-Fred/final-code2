import mongoose from 'mongoose'
import { sanitizeMultiline } from '../lib/sanitize'

const NoteSchema = new mongoose.Schema(
  {
    client: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Client',
      required: true,
      index: true,
    },
    text: {
      type: String,
      required: [true, 'Note text is required'],
      set: sanitizeMultiline,
      maxlength: [2000, 'Note is too long (2000 characters max)'],
    },
    // Absent on notes created before authentication existed (admin-only to delete).
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
)

export default mongoose.models.Note || mongoose.model('Note', NoteSchema)
