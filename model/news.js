import mongoose from 'mongoose'
import { sanitizeLine, sanitizeMultiline, stripInvisible } from '../lib/sanitize'

// News documents are written by something outside this app, so their text is
// sanitized on the way in like everything else.
const NewsSchema = new mongoose.Schema({
  company: { type: String, set: sanitizeLine },
  articles: {
    title: { type: String, set: sanitizeLine },
    description: { type: String, set: sanitizeMultiline },
    url: { type: String, set: stripInvisible },
  },
})

export default mongoose.models.News || mongoose.model('News', NewsSchema)
