import mongoose from 'mongoose'

// Only the SHA-256 of the session token is stored, so a database leak does not
// hand out usable sessions.
const SessionSchema = new mongoose.Schema({
  tokenHash: { type: String, required: true, unique: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  expiresAt: { type: Date, required: true },
  lastSeenAt: { type: Date, required: true },
  userAgent: { type: String, maxlength: 200 },
  ip: { type: String, maxlength: 64 },
})

// MongoDB removes documents once expiresAt has passed (checked about once a minute;
// the app also enforces expiry itself).
SessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

export default mongoose.models.Session || mongoose.model('Session', SessionSchema)
