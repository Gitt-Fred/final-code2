import mongoose from 'mongoose'

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
      trim: true,
      maxlength: [2000, 'Note is too long (2000 characters max)'],
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
)

export default mongoose.models.Note || mongoose.model('Note', NoteSchema)
