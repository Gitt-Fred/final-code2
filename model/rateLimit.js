import mongoose from 'mongoose'

// Fixed-window counters, kept in MongoDB so limits hold across app instances.
const RateLimitSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  count: { type: Number, required: true, default: 0 },
  expiresAt: { type: Date, required: true },
})

RateLimitSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

export default mongoose.models.RateLimit || mongoose.model('RateLimit', RateLimitSchema)
