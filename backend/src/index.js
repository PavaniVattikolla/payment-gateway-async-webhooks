const express = require('express');
const { Pool } = require('pg');
const Queue = require('bull');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 8000;

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Redis Bull queue for background jobs
const paymentQueue = new Queue('payment-processing', process.env.REDIS_URL);
const webhookQueue = new Queue('webhook-delivery', process.env.REDIS_URL);
const refundQueue = new Queue('refund-processing', process.env.REDIS_URL);

// Middleware
app.use(express.json());

// Authentication middleware
const authenticate = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  const apiSecret = req.headers['x-api-secret'];

  if (!apiKey || !apiSecret) {
    return res.status(401).json({ error: { code: 'UNAUTHORIZED', description: 'Missing credentials' } });
  }

  // Validate credentials (in real app, check against database)
  if (apiKey === 'key_test_abc123' && apiSecret === 'secret_test_xyz789') {
    req.merchantId = 'merchant_test_123'; // Test merchant ID
    next();
  } else {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', description: 'Invalid credentials' } });
  }
};

// Helper function to generate unique IDs
const generateId = (prefix, length = 16) => {
  return prefix + '_' + crypto.randomBytes(length / 2).toString('hex').substring(0, length);
};

// Helper function to verify idempotency
const checkIdempotency = async (merchantId, idempotencyKey) => {
  if (!idempotencyKey) return null;

  const result = await pool.query(
    'SELECT response, expires_at FROM idempotency_keys WHERE key = $1 AND merchant_id = $2',
    [idempotencyKey, merchantId]
  );

  if (result.rows.length > 0) {
    const { response, expires_at } = result.rows[0];
    if (new Date(expires_at) > new Date()) {
      return JSON.parse(response);
    } else {
      // Expired, delete it
      await pool.query('DELETE FROM idempotency_keys WHERE key = $1', [idempotencyKey]);
    }
  }
  return null;
};

// POST /api/v1/payments - Create payment
app.post('/api/v1/payments', authenticate, async (req, res) => {
  try {
    const idempotencyKey = req.headers['idempotency-key'];
    const { order_id, method, vpa, card } = req.body;

    // Check idempotency
    const cachedResponse = await checkIdempotency(req.merchantId, idempotencyKey);
    if (cachedResponse) {
      return res.status(201).json(cachedResponse);
    }

    // Validate input
    if (!order_id || !method) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', description: 'Missing required fields' } });
    }

    // Create payment record
    const paymentId = generateId('pay');
    const amount = 50000; // For now, fixed amount
    const currency = 'INR';
    const status = 'pending';
    const now = new Date();

    const result = await pool.query(
      'INSERT INTO payments (id, order_id, merchant_id, amount, currency, method, vpa, status, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *',
      [paymentId, order_id, req.merchantId, amount, currency, method, vpa || null, status, now]
    );

    const payment = result.rows[0];

    // Enqueue payment processing job
    await paymentQueue.add({ paymentId }, { attempts: 3, backoff: 'fixed', delay: 1000 });

    const response = {
      id: payment.id,
      order_id: payment.order_id,
      amount: payment.amount,
      currency: payment.currency,
      method: payment.method,
      vpa: payment.vpa,
      status: payment.status,
      created_at: payment.created_at.toISOString(),
    };

    // Store in idempotency cache if key provided
    if (idempotencyKey) {
      const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      await pool.query(
        'INSERT INTO idempotency_keys (key, merchant_id, response, expires_at) VALUES ($1, $2, $3, $4)',
        [idempotencyKey, req.merchantId, JSON.stringify(response), expiresAt]
      );
    }

    res.status(201).json(response);
  } catch (error) {
    console.error('Payment creation error:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', description: error.message } });
  }
});

// POST /api/v1/payments/{paymentId}/refunds - Create refund
app.post('/api/v1/payments/:paymentId/refunds', authenticate, async (req, res) => {
  try {
    const { paymentId } = req.params;
    const { amount, reason } = req.body;

    // Validate amount
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', description: 'Invalid amount' } });
    }

    // Check payment exists and is refundable
    const paymentResult = await pool.query(
      'SELECT * FROM payments WHERE id = $1 AND merchant_id = $2',
      [paymentId, req.merchantId]
    );

    if (paymentResult.rows.length === 0) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', description: 'Payment not found' } });
    }

    const payment = paymentResult.rows[0];
    if (payment.status !== 'success') {
      return res.status(400).json({ error: { code: 'BAD_REQUEST_ERROR', description: 'Payment not in refundable state' } });
    }

    // Calculate total already refunded
    const refundResult = await pool.query(
      'SELECT SUM(amount) as total_refunded FROM refunds WHERE payment_id = $1 AND status IN (\'pending\', \'processed\')',
      [paymentId]
    );

    const totalRefunded = refundResult.rows[0].total_refunded || 0;
    if (amount + totalRefunded > payment.amount) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST_ERROR', description: 'Refund amount exceeds available amount' } });
    }

    // Create refund
    const refundId = generateId('rfnd');
    const now = new Date();

    const newRefund = await pool.query(
      'INSERT INTO refunds (id, payment_id, merchant_id, amount, reason, status, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
      [refundId, paymentId, req.merchantId, amount, reason || null, 'pending', now]
    );

    // Enqueue refund processing job
    await refundQueue.add({ refundId }, { attempts: 3, backoff: 'fixed', delay: 1000 });

    const refund = newRefund.rows[0];
    res.status(201).json({
      id: refund.id,
      payment_id: refund.payment_id,
      amount: refund.amount,
      reason: refund.reason,
      status: refund.status,
      created_at: refund.created_at.toISOString(),
    });
  } catch (error) {
    console.error('Refund creation error:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', description: error.message } });
  }
});

// GET /api/v1/refunds/{refundId} - Get refund details
app.get('/api/v1/refunds/:refundId', authenticate, async (req, res) => {
  try {
    const { refundId } = req.params;

    const result = await pool.query(
      'SELECT * FROM refunds WHERE id = $1 AND merchant_id = $2',
      [refundId, req.merchantId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', description: 'Refund not found' } });
    }

    const refund = result.rows[0];
    res.json({
      id: refund.id,
      payment_id: refund.payment_id,
      amount: refund.amount,
      reason: refund.reason,
      status: refund.status,
      created_at: refund.created_at.toISOString(),
      processed_at: refund.processed_at ? refund.processed_at.toISOString() : null,
    });
  } catch (error) {
    console.error('Get refund error:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', description: error.message } });
  }
});

// GET /api/v1/webhooks - List webhook logs
app.get('/api/v1/webhooks', authenticate, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 10, 100);
    const offset = parseInt(req.query.offset) || 0;

    const countResult = await pool.query(
      'SELECT COUNT(*) as total FROM webhook_logs WHERE merchant_id = $1',
      [req.merchantId]
    );

    const result = await pool.query(
      'SELECT * FROM webhook_logs WHERE merchant_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
      [req.merchantId, limit, offset]
    );

    const logs = result.rows.map(log => ({
      id: log.id,
      event: log.event,
      status: log.status,
      attempts: log.attempts,
      created_at: log.created_at.toISOString(),
      last_attempt_at: log.last_attempt_at ? log.last_attempt_at.toISOString() : null,
      response_code: log.response_code,
    }));

    res.json({
      data: logs,
      total: parseInt(countResult.rows[0].total),
      limit,
      offset,
    });
  } catch (error) {
    console.error('Get webhooks error:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', description: error.message } });
  }
});

// POST /api/v1/webhooks/{webhookId}/retry - Retry webhook
app.post('/api/v1/webhooks/:webhookId/retry', authenticate, async (req, res) => {
  try {
    const { webhookId } = req.params;

    const result = await pool.query(
      'UPDATE webhook_logs SET attempts = 0, status = \'pending\', next_retry_at = $1 WHERE id = $2 AND merchant_id = $3 RETURNING *',
      [new Date(), webhookId, req.merchantId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', description: 'Webhook log not found' } });
    }

    const log = result.rows[0];
    await webhookQueue.add({
      merchantId: log.merchant_id,
      event: log.event,
      payload: JSON.parse(log.payload),
    }, { attempts: 5, backoff: 'exponential', delay: 1000 });

    res.json({
      id: log.id,
      status: log.status,
      message: 'Webhook retry scheduled',
    });
  } catch (error) {
    console.error('Retry webhook error:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', description: error.message } });
  }
});

// GET /api/v1/test/jobs/status - Job queue status (test endpoint)
app.get('/api/v1/test/jobs/status', async (req, res) => {
  try {
    const paymentPending = await paymentQueue.count('waiting');
    const paymentProcessing = await paymentQueue.count('active');
    const webhookPending = await webhookQueue.count('waiting');
    const refundPending = await refundQueue.count('waiting');

    res.json({
      pending: paymentPending + webhookPending + refundPending,
      processing: paymentProcessing,
      completed: 0,
      failed: 0,
      worker_status: 'running',
    });
  } catch (error) {
    console.error('Job status error:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', description: error.message } });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Payment Gateway API running on port ${PORT}`);
});

module.exports = { app, pool, paymentQueue, webhookQueue, refundQueue };
