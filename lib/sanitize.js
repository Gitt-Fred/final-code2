// Cleans untrusted text before it is stored. React already escapes everything it
// renders, so this is defence in depth: it keeps markup, invisible characters, and
// bidi tricks out of the database, where a future export, email, or PDF could trip on them.

// C0/C1 control characters, except tab and newline (and carriage return, which is
// normalized to \n below) for multi-line text.
const CONTROL_SINGLE = /[\u0000-\u001F\u007F-\u009F]/g
const CONTROL_MULTI = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g
// Bidi embedding/override/isolate controls (the "Trojan Source" class), zero-width
// characters, the word joiner, and the byte-order mark.
const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g
// Anything a browser would parse as a tag, comment, doctype, or processing
// instruction: "<" followed directly by a letter, "/", "!" or "?". So
// "Smith & Sons <trading>" loses the tag, but "a < b and c > d" is untouched.
const TAG = /<[a-zA-Z/!?][^<>]*>/g

function stripTags(value) {
  // Repeat until stable so nested fragments like "<scr<b>ipt>" cannot reassemble.
  let previous
  let current = value
  do {
    previous = current
    current = current.replace(TAG, '')
  } while (current !== previous)
  return current
}

export function sanitizeText(value, { multiline = false } = {}) {
  if (typeof value !== 'string') return value
  let text = value.normalize('NFC').replace(/\r\n?/g, '\n')
  text = text.replace(multiline ? CONTROL_MULTI : CONTROL_SINGLE, multiline ? '' : ' ')
  text = text.replace(INVISIBLE, '')
  text = stripTags(text)
  if (multiline) {
    // Trim trailing spaces per line and cap blank runs at one empty line.
    text = text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n')
  } else {
    text = text.replace(/\s+/g, ' ')
  }
  return text.trim()
}

// Mongoose setters take a single argument.
export const sanitizeLine = (value) => sanitizeText(value)
export const sanitizeMultiline = (value) => sanitizeText(value, { multiline: true })

// Removes characters that are never valid in an email or URL (controls, invisible
// characters, whitespace) so the model's own format validation sees the real value.
export const stripInvisible = (value) =>
  typeof value === 'string'
    ? value.normalize('NFC').replace(CONTROL_SINGLE, '').replace(INVISIBLE, '').trim()
    : value

const MAX_FILENAME = 120

// Builds a safe display/download name. The extension always comes from the
// detected file type, never from the name the user sent, so "invoice.pdf.exe" can
// only ever be stored with the extension of what the bytes really are.
export function sanitizeFilename(name, extension) {
  let base = sanitizeText(typeof name === 'string' ? name : '')
  // Drop any directory part, then characters that are unsafe in filenames or headers.
  base = base.split(/[/\\]/).pop()
  base = base.replace(/["*:<>?|;%]/g, '').replace(/\.{2,}/g, '.')
  // Remove the user's own extension; ours goes back on below.
  base = base.replace(/\.[A-Za-z0-9]{1,8}$/, '').replace(/^[.\s]+|[.\s]+$/g, '')
  if (!base) base = 'file'
  const suffix = `.${extension}`
  return base.slice(0, MAX_FILENAME - suffix.length) + suffix
}
