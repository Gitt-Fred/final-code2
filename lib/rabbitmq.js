import amqp from 'amqplib'

const RABBITMQ_URI = process.env.RABBITMQ_URI
const QUEUE_NAME = 'clients'

let cached = global.rabbitmq

if (!cached) {
  cached = global.rabbitmq = { channel: null, promise: null }
}

function resetConnection() {
  cached.channel = null
  cached.promise = null
}

async function getChannel() {
  if (cached.channel) {
    return cached.channel
  }

  if (!cached.promise) {
    cached.promise = amqp.connect(RABBITMQ_URI).then(async (connection) => {
      const channel = await connection.createChannel()
      await channel.assertQueue(QUEUE_NAME, { durable: true })
      connection.on('error', resetConnection)
      connection.on('close', resetConnection)
      cached.channel = channel
      return channel
    })
  }

  return cached.promise
}

async function writeMessageToQueue(message) {
  if (!RABBITMQ_URI) {
    console.log('RABBITMQ_URI not configured, skipping queue write. Message:', message)
    return false
  }

  try {
    const channel = await getChannel()
    channel.sendToQueue(QUEUE_NAME, Buffer.from(JSON.stringify(message)), { persistent: true })
    return true
  } catch (error) {
    console.error('Failed to write message to RabbitMQ queue:', error.message)
    resetConnection()
    return false
  }
}

export default writeMessageToQueue
