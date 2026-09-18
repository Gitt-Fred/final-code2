import dbConnect from "../../lib/mong-connect";
import writeMessageToQueue from "../../lib/rabbitmq"
import Client from '../../model/client.js'
import {
  escapeRegex,
  methodNotAllowed,
  parsePagination,
  persistenceDisabled,
  persistenceEnabled,
  pickClientFields,
  sampleClients,
  sendError,
} from '../../lib/api-helpers'

export default async function handler(req, res) {
  const persistent = persistenceEnabled()

  try {
    if (persistent) {
      await dbConnect()
    }

    switch (req.method) {
      case 'GET': {
        const q = typeof req.query.q === 'string' ? req.query.q.trim() : ''
        const { page, limit } = parsePagination(req.query)
        let data
        let total

        if (persistent) {
          const filter = q
            ? {
                $or: ['name', 'company', 'email'].map((field) => ({
                  [field]: { $regex: escapeRegex(q), $options: 'i' },
                })),
              }
            : {}
          ;[data, total] = await Promise.all([
            Client.find(filter)
              .sort({ createdAt: -1, _id: -1 })
              .skip((page - 1) * limit)
              .limit(limit)
              .lean(),
            Client.countDocuments(filter),
          ])
        } else {
          const needle = q.toLowerCase()
          const matches = sampleClients.filter(
            (client) =>
              !needle ||
              [client.name, client.company, client.email].some((value) =>
                value.toLowerCase().includes(needle)
              )
          )
          total = matches.length
          data = matches.slice((page - 1) * limit, page * limit)
        }

        return res.status(200).json({
          success: true,
          data,
          total,
          page,
          pages: Math.max(Math.ceil(total / limit), 1),
        })
      }
      case 'POST': {
        if (!persistent) {
          return persistenceDisabled(res)
        }
        const client = await Client.create(pickClientFields(req.body))
        // Best effort: writeMessageToQueue never throws, so a broker outage
        // can't fail a client that is already saved.
        if (client.company) {
          await writeMessageToQueue(client.company)
        }
        return res.status(201).json({ success: true, data: client })
      }
      default:
        return methodNotAllowed(req, res, ['GET', 'POST'])
    }
  } catch (error) {
    return sendError(res, error)
  }
}
