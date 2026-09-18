import writeMessageToQueue from "../../lib/rabbitmq"
import Client from '../../model/client.js'
import { withAuth } from '../../lib/auth'
import { escapeRegex, parsePagination, pickClientFields } from '../../lib/api-helpers'

export const config = { api: { bodyParser: { sizeLimit: '50kb' } } }

async function listClients(req, res) {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : ''
  const { page, limit } = parsePagination(req.query)

  const filter = q
    ? {
        $or: ['name', 'company', 'email'].map((field) => ({
          [field]: { $regex: escapeRegex(q), $options: 'i' },
        })),
      }
    : {}

  const [data, total] = await Promise.all([
    Client.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Client.countDocuments(filter),
  ])

  return res.status(200).json({
    success: true,
    data,
    total,
    page,
    pages: Math.max(Math.ceil(total / limit), 1),
  })
}

async function createClient(req, res, { user }) {
  const client = await Client.create({ ...pickClientFields(req.body), createdBy: user._id })
  // Best effort: writeMessageToQueue never throws, so a broker outage
  // can't fail a client that is already saved.
  if (client.company) {
    await writeMessageToQueue(client.company)
  }
  return res.status(201).json({ success: true, data: client })
}

export default withAuth({
  GET: { handler: listClients },
  POST: { handler: createClient },
})
