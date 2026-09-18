import mongoose from 'mongoose'

// A single document with a fixed _id. Inserting it is the atomic guard that lets
// exactly one first-run setup request create the initial admin.
const SetupSchema = new mongoose.Schema(
  { _id: { type: String, required: true } },
  { timestamps: { createdAt: true, updatedAt: false } }
)

export default mongoose.models.Setup || mongoose.model('Setup', SetupSchema)
