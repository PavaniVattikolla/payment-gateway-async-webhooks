const { Pool } = require('pg');
const Queue = require('bull');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const paymentQueue = new Queue('payment-processing', process.env.REDIS_URL);
const webhookQueue = new Queue('webhook-delivery', process.env.REDIS_URL);

// Payment worker processor
paymentQueue.process(async (job) => {
  const { paymentId } = job.data;
  console.log(`Processing payment: ${paymentId}`);

  try {
    // Fetch payment from database
    const paymentResult = await pool.query(
      'SELECT * FROM payments WHERE id = $1',
      [paymentId]
    );

    if (paymentResult.rows.length === 0) {
      throw new Error(`Payment ${paymentId} not found`);
    }

    const payment = paymentResult.rows[0];

    // Get test mode settings
    const testMode = process.env.TEST_MODE === 'true';
    const testProcessingDelay = parseInt(process.env.TEST_PROCESSING_DELAY || '1000');
    const testPaymentSuccess = process.env.TEST_PAYMENT_SUCCESS !== 'false';

    // Simulate processing delay
    let delay;
    if (testMode) {
      delay = testProcessingDelay;
    } else {
      delay = Math.floor(Math.random() * 5000) + 5000;
    }
    await new Promise(resolve => setTimeout(resolve, delay));

    // Determine payment outcome
    let isSuccess;
    if (testMode) {
      isSuccess = testPaymentSuccess;
    } else {
      const successRate = payment.method === 'upi' ? 0.9 : 0.95;
      isSuccess = Math.random() < successRate;
    }

    let newStatus = isSuccess ? 'success' : 'failed';
    let errorCode = null;
    let errorDescription = null;

    if (!isSuccess) {
      errorCode = 'PAYMENT_FAILED';
      errorDescription = 'Payment processing failed';
    }

    // Update payment in database
    await pool.query(
      'UPDATE payments SET status = $1, error_code = $2, error_description = $3 WHERE id = $4',
      [newStatus, errorCode, errorDescription, paymentId]
    );

    // Enqueue webhook event
    const event = isSuccess ? 'payment.success' : 'payment.failed';
    const webhookPayload = {
      event: event,
      timestamp: Math.floor(Date.now() / 1000),
      data: {
        payment: {
          id: payment.id,
          order_id: payment.order_id,
          amount: payment.amount,
          currency: payment.currency,
          method: payment.method,
          vpa: payment.vpa,
          status: newStatus,
          created_at: payment.created_at.toISOString(),
        }
      }
    };

    await webhookQueue.add({
      merchantId: payment.merchant_id,
      event: event,
      payload: webhookPayload,
    }, { attempts: 5, backoff: 'exponential', delay: 1000 });

    console.log(`Payment ${paymentId} processed with status: ${newStatus}`);
    return { paymentId, status: newStatus };
  } catch (error) {
    console.error(`Error processing payment ${paymentId}:`, error);
    throw error;
  }
});

paymentQueue.on('completed', (job, result) => {
  console.log(`Job ${job.id} completed:`, result);
});

paymentQueue.on('failed', (job, err) => {
  console.error(`Job ${job.id} failed:`, err.message);
});

console.log('Payment worker started...');
