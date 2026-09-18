import mongoose from 'mongoose'

const UserSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      trim: true,
      lowercase: true,
      maxlength: [254, 'Email is too long'],
      match: [/^\S+@\S+\.\S+$/, 'Email is invalid'],
    },
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      maxlength: [120, 'Name is too long'],
    },
    role: { type: String, enum: ['admin', 'member'], default: 'member' },
    // scrypt$N$r$p$salt$hash. Never selected by default, never serialized.
    passwordHash: { type: String, required: true, select: false },
    active: { type: Boolean, default: true },
    // Set for admin-created accounts and after an admin password reset.
    mustChangePassword: { type: Boolean, default: false },
    lastLoginAt: Date,
  },
  { timestamps: true }
)

UserSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.passwordHash
    delete ret.__v
    return ret
  },
})

export default mongoose.models.User || mongoose.model('User', UserSchema)
