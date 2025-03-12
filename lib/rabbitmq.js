// Remove amqplib import
// var amqp = require('amqplib/callback_api');

// Remove the RabbitMQ URI
// const RABBITMQ_URI = process.env.RABBITMQ_URI

async function writeMessageToQueue(message) {
  console.log("Writing message, but no queue (RabbitMQ) configured.");
  // You can either log the message or handle it differently without RabbitMQ
  // For example, you can log the message or save it somewhere else (e.g., database)
  // Here we just log it as a placeholder for whatever action you want to take.
  console.log("Message: ", message);
  return true; // Or any other value to indicate success
}

export default writeMessageToQueue;
