// Cached Mongoose connection.
// Based on https://github.com/vercel/next.js/blob/canary/examples/with-mongodb-mongoose/utils/dbConnect.js
import mongoose from 'mongoose'
import logger from './logger'

/**
 * Global is used here to maintain a cached connection across hot reloads
 * in development. This prevents connections growing exponentially
 * during API Route usage.
 */
let cached = global.mongoose

if (!cached) {
  cached = global.mongoose = { conn: null, promise: null }
}

async function dbConnect() {
  if (cached.conn) {
    return cached.conn
  }

  if (!cached.promise) {
    // Checked here rather than at import time so `next build` works without a database.
    const uri = process.env.MONGODB_URI
    if (!uri) {
      throw new Error('MONGODB_URI is not set. See .env.local.example.')
    }

    cached.promise = mongoose.connect(uri).catch((error) => {
      // Drop the failed promise so the next request retries instead of failing forever.
      cached.promise = null
      logger.error({ err: error.message }, 'MongoDB connection failed')
      throw error
    })
  }

  cached.conn = await cached.promise
  return cached.conn
}

export default dbConnect
