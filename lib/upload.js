// Reads a raw upload body into memory with hard limits. Used by the attachment
// upload route, which turns off Next's body parser.

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024
const MAX_CONCURRENT = 4

export function maxUploadBytes() {
  const configured = Number.parseInt(process.env.MAX_UPLOAD_BYTES, 10)
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_MAX_BYTES
}

export class UploadError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

// Whole files are held in memory while they are checked (a ZIP's directory is at
// its end), and the container has a fixed memory limit, so only a few uploads run
// at once per app instance.
let active = 0

export async function withUploadSlot(task) {
  if (active >= MAX_CONCURRENT) {
    throw new UploadError(503, 'The server is busy with other uploads. Try again in a moment.')
  }
  active += 1
  try {
    return await task()
  } finally {
    active -= 1
  }
}

// Resolves to a Buffer, or rejects with an UploadError. A declared Content-Length
// over the limit is refused before anything is read; a body that grows past it
// (chunked, or a lying header) stops being kept as soon as it crosses the limit.
// Either way nothing more is buffered: once the 413 is sent, Node reads and discards
// the rest (bounded by the server's request timeout). Resetting the connection
// instead can make proxies drop the response before the client ever sees it.
export function readBody(req, limit = maxUploadBytes()) {
  return new Promise((resolve, reject) => {
    const tooLarge = () => new UploadError(413, `Files must be ${Math.floor(limit / (1024 * 1024))} MB or smaller`)
    const declared = Number.parseInt(req.headers['content-length'], 10)
    if (Number.isFinite(declared) && declared > limit) {
      reject(tooLarge())
      return
    }

    const chunks = []
    let size = 0
    let done = false
    const finish = (error, value) => {
      if (done) return
      done = true
      req.off('data', onData)
      if (error) reject(error)
      else resolve(value)
    }
    const onData = (chunk) => {
      size += chunk.length
      if (size > limit) {
        finish(tooLarge())
        return
      }
      chunks.push(chunk)
    }
    req.on('data', onData)
    req.on('end', () => finish(null, Buffer.concat(chunks, size)))
    req.on('error', (error) => finish(error))
    req.on('aborted', () => finish(new UploadError(400, 'Upload was interrupted')))
  })
}
