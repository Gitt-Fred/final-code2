import News from '../../model/news.js'
import { withAuth } from '../../lib/auth'

async function listNews(req, res) {
  // Only accept a plain string so query operators can't be injected via ?company[$ne]=...
  const company = typeof req.query.company === 'string' ? req.query.company : ''
  const news = await News.find({ company }).lean()
  return res.status(200).json({ success: true, data: news })
}

export default withAuth({ GET: { handler: listNews } })
