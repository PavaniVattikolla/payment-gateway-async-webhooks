// Load all workers
const { paymentQueue } = require('./paymentWorker');
const { webhookQueue } = require('./webhookWorker');
const { refundQueue } = require('./refundWorker');

console.log('All workers loaded and running...');
console.log('- Payment worker: active');
console.log('- Webhook worker: active');
console.log('- Refund worker: active');

// Keep the process alive
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, gracefully shutting down...');
  await Promise.all([
    paymentQueue.close(),
    webhookQueue.close(),
    refundQueue.close(),
  ]);
  process.exit(0);
});

module.exports = { paymentQueue, webhookQueue, refundQueue };
