import RateLimit from '../model/rateLimit'

// Fixed-window counter in MongoDB (shared across app instances). Returns
// { allowed, retryAfter } where retryAfter is in seconds.
export async function hit(key, { limit, windowMs }) {
  const now = new Date()
  // TTL cleanup only runs about once a minute, so drop an expired window ourselves.
  await RateLimit.deleteOne({ key, expiresAt: { $lte: now } })

  const update = {
    $inc: { count: 1 },
    $setOnInsert: { expiresAt: new Date(now.getTime() + windowMs) },
  }
  let doc
  try {
    doc = await RateLimit.findOneAndUpdate({ key }, update, { upsert: true, new: true }).lean()
  } catch (error) {
    // Two requests raced to create the same key: the loser just increments.
    if (error?.code !== 11000) throw error
    doc = await RateLimit.findOneAndUpdate({ key }, { $inc: { count: 1 } }, { new: true }).lean()
  }

  return {
    allowed: doc.count <= limit,
    retryAfter: Math.max(1, Math.ceil((doc.expiresAt.getTime() - now.getTime()) / 1000)),
  }
}

export const resetLimit = (key) => RateLimit.deleteOne({ key })

// Cheap per-IP limiter for general API traffic. Per app instance only (not shared),
// so it blunts floods but is not a hard guarantee; login uses the shared limiter above.
const buckets = new Map()

export function memoryHit(key, { limit, windowMs }) {
  const now = Date.now()
  let bucket = buckets.get(key)
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + windowMs }
    buckets.set(key, bucket)
    if (buckets.size > 10000) {
      for (const [k, b] of buckets) {
        if (b.resetAt <= now) buckets.delete(k)
      }
    }
  }
  bucket.count += 1
  return {
    allowed: bucket.count <= limit,
    retryAfter: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
  }
}
