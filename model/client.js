import mongoose from 'mongoose'

const ClientSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      maxlength: [120, 'Name is too long'],
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      maxlength: [254, 'Email is too long'],
      match: [/^\S+@\S+\.\S+$/, 'Email is invalid'],
    },
    // Joined against the news collection by company name.
    company: {
      type: String,
      trim: true,
      maxlength: [120, 'Company is too long'],
      index: true,
    },
    website: {
      type: String,
      maxlength: [2048, 'Website is too long'],
      // Accept "example.com" and store it as "https://example.com".
      set: (value) => {
        const trimmed = typeof value === 'string' ? value.trim() : value
        return trimmed && !/^https?:\/\//i.test(trimmed) ? `https://${trimmed}` : trimmed
      },
      match: [/^https?:\/\/\S+$/i, 'Website is invalid'],
    },
    // Absent on customers created before authentication existed.
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
)

export default mongoose.models.Client || mongoose.model('Client', ClientSchema)
