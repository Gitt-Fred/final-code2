
import mongoose from 'mongoose'

const NewsSchema = new mongoose.Schema({
  company: String,
  articles: {
    title: String,
    description: String,
    url: String
  }
})

export default mongoose.models.News || mongoose.model('News', NewsSchema)
