import pino from 'pino'

// Shared structured logger. Never log passwords, session tokens, or password hashes.
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  redact: ['password', 'newPassword', 'currentPassword', 'token', 'passwordHash', 'req.headers.cookie'],
})

export default logger
