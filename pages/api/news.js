import dbConnect from "../../lib/mong-connect";
import News from '../../model/news.js'
import { methodNotAllowed, persistenceEnabled, sendError } from '../../lib/api-helpers'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return methodNotAllowed(req, res, ['GET'])
  }
  if (!persistenceEnabled()) {
    return res.status(200).json({ success: true, data: [] })
  }

  // Only accept a plain string so query operators can't be injected via ?company[$ne]=...
  const company = typeof req.query.company === 'string' ? req.query.company : ''

  try {
    await dbConnect()
    const news = await News.find({ company }).lean()
    return res.status(200).json({ success: true, data: news })
  } catch (error) {
    return sendError(res, error)
  }
}
