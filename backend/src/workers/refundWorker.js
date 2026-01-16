const { Pool } = require('pg');
const Queue = require('bull');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const refundQueue = new Queue('refund-processing', process.env.REDIS_URL);
const webhookQueue = new Queue('webhook-delivery', process.env.REDIS_URL);

// Refund worker processor
refundQueue.process(async (job) => {
  const { refundId } = job.data;
  console.log(`Processing refund: ${refundId}`);

  try {
    // Fetch refund details
    const refundResult = await pool.query(
      'SELECT * FROM refunds WHERE id = $1',
      [refundId]
    );

    if (refundResult.rows.length === 0) {
      throw new Error(`Refund ${refundId} not found`);
    }

    const refund = refundResult.rows[0];

    // Verify payment exists and is refundable
    const paymentResult = await pool.query(
      'SELECT * FROM payments WHERE id = $1',
      [refund.payment_id]
    );

    if (paymentResult.rows.length === 0) {
      throw new Error(`Payment ${refund.payment_id} not found`);
    }

    const payment = paymentResult.rows[0];

    if (payment.status !== 'success') {
      throw new Error(`Payment not in refundable state: ${payment.status}`);
    }

    // Simulate refund processing delay (3-5 seconds)
    const delay = Math.floor(Math.random() * 2000) + 3000;
    await new Promise(resolve => setTimeout(resolve, delay));

    // Update refund status to processed
    const now = new Date();
    const updateResult = await pool.query(
      'UPDATE refunds SET status = $1, processed_at = $2 WHERE id = $3 RETURNING *',
      ['processed', now, refundId]
    );

    const processedRefund = updateResult.rows[0];

    // Create webhook event for refund.processed
    const webhookPayload = {
      event: 'refund.processed',
      timestamp: Math.floor(Date.now() / 1000),
      data: {
        refund: {
          id: processedRefund.id,
          payment_id: processedRefund.payment_id,
          amount: processedRefund.amount,
          reason: processedRefund.reason,
          status: processedRefund.status,
          created_at: processedRefund.created_at.toISOString(),
          processed_at: processedRefund.processed_at.toISOString(),
        }
      }
    };

    // Enqueue webhook event
    await webhookQueue.add({
      merchantId: payment.merchant_id,
      event: 'refund.processed',
      payload: webhookPayload,
    }, { attempts: 5, backoff: 'exponential', delay: 1000 });

    console.log(`Refund ${refundId} processed successfully`);
    return { refundId, status: 'processed', processedAt: now };
  } catch (error) {
    console.error(`Error processing refund ${refundId}:`, error);
    throw error;
  }
});

refundQueue.on('completed', (job, result) => {
  console.log(`Refund job ${job.id} completed:`, result);
});

refundQueue.on('failed', (job, err) => {
  console.error(`Refund job ${job.id} failed:`, err.message);
});

console.log('Refund worker started...');

module.exports = { refundQueue };
