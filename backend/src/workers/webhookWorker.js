const { Pool } = require('pg');
const Queue = require('bull');
const crypto = require('crypto');
const axios = require('axios');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const webhookQueue = new Queue('webhook-delivery', process.env.REDIS_URL);

// Webhook retry intervals
const RETRY_INTERVALS = {
  production: [0, 60, 300, 1800, 7200], // 0s, 1min, 5min, 30min, 2hrs
  test: [0, 5, 10, 15, 20] // 0s, 5s, 10s, 15s, 20s
};

// Get retry intervals based on environment
function getRetryIntervals() {
  if (process.env.WEBHOOK_RETRY_INTERVALS_TEST === 'true') {
    return RETRY_INTERVALS.test;
  }
  return RETRY_INTERVALS.production;
}

// Generate HMAC signature
function generateSignature(payload, secret) {
  const payloadString = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return crypto.createHmac('sha256', secret).update(payloadString).digest('hex');
}

// Webhook worker processor
webhookQueue.process(async (job) => {
  const { merchantId, event, payload } = job.data;
  console.log(`Processing webhook: ${event} for merchant: ${merchantId}`);

  try {
    // Fetch merchant webhook config
    const merchantResult = await pool.query(
      'SELECT webhook_url, webhook_secret FROM merchants WHERE id = $1',
      [merchantId]
    );

    if (merchantResult.rows.length === 0) {
      throw new Error(`Merchant ${merchantId} not found`);
    }

    const { webhook_url, webhook_secret } = merchantResult.rows[0];

    // Skip if webhook URL not configured
    if (!webhook_url) {
      console.log(`No webhook URL configured for merchant ${merchantId}, skipping delivery`);
      return { status: 'skipped', reason: 'no_webhook_url' };
    }

    // Generate signature
    const payloadString = JSON.stringify(payload);
    const signature = generateSignature(payloadString, webhook_secret);

    // Create or update webhook log
    const logResult = await pool.query(
      `INSERT INTO webhook_logs (merchant_id, event, payload, status, attempts, last_attempt_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO UPDATE SET attempts = attempts + 1, last_attempt_at = $6
       RETURNING id`,
      [merchantId, event, payloadString, 'pending', 0, new Date(), new Date()]
    );

    const logId = logResult.rows[0].id;

    // Send webhook
    let isSuccess = false;
    let responseCode = null;
    let responseBody = null;

    try {
      const response = await axios.post(webhook_url, payload, {
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': signature,
        },
        timeout: 5000,
      });

      responseCode = response.status;
      responseBody = response.data ? JSON.stringify(response.data) : null;
      isSuccess = response.status >= 200 && response.status < 300;
    } catch (error) {
      responseCode = error.response?.status || null;
      responseBody = error.message;
    }

    // Get current attempt count
    const currentLog = await pool.query(
      'SELECT attempts FROM webhook_logs WHERE id = $1',
      [logId]
    );
    const attempts = currentLog.rows[0].attempts + 1;

    // Update webhook log
    if (isSuccess) {
      await pool.query(
        `UPDATE webhook_logs SET status = $1, attempts = $2, last_attempt_at = $3, response_code = $4, response_body = $5
         WHERE id = $6`,
        ['success', attempts, new Date(), responseCode, responseBody, logId]
      );
      console.log(`Webhook ${logId} delivered successfully`);
      return { logId, status: 'success', responseCode };
    } else {
      // Schedule retry if attempts < 5
      if (attempts < 5) {
        const retryIntervals = getRetryIntervals();
        const nextRetryDelay = retryIntervals[attempts] * 1000; // Convert to ms
        const nextRetryAt = new Date(Date.now() + nextRetryDelay);

        await pool.query(
          `UPDATE webhook_logs SET status = $1, attempts = $2, last_attempt_at = $3, next_retry_at = $4, response_code = $5, response_body = $6
           WHERE id = $7`,
          ['pending', attempts, new Date(), nextRetryAt, responseCode, responseBody, logId]
        );

        // Re-enqueue for retry
        await webhookQueue.add(
          { merchantId, event, payload },
          { delay: nextRetryDelay, attempts: 1 }
        );
      } else {
        // Mark as failed after 5 attempts
        await pool.query(
          `UPDATE webhook_logs SET status = $1, attempts = $2, last_attempt_at = $3, response_code = $4, response_body = $5
           WHERE id = $6`,
          ['failed', attempts, new Date(), responseCode, responseBody, logId]
        );
        console.log(`Webhook ${logId} failed after 5 attempts`);
      }
      return { logId, status: 'failed', attempts, responseCode };
    }
  } catch (error) {
    console.error(`Error processing webhook for merchant ${merchantId}:`, error);
    throw error;
  }
});

webhookQueue.on('completed', (job, result) => {
  console.log(`Webhook job ${job.id} completed:`, result);
});

webhookQueue.on('failed', (job, err) => {
  console.error(`Webhook job ${job.id} failed:`, err.message);
});

console.log('Webhook worker started...');

module.exports = { webhookQueue };
