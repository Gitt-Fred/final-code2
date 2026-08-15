
import mongoose from 'mongoose'

const ClientSchema = new mongoose.Schema({
  name: String,
  email: String,
  company: String,
  website: String,
  articles: {
    title: String,
    description: String,
    url: String
  }
})

export default mongoose.models.Client || mongoose.model('Client', ClientSchema)