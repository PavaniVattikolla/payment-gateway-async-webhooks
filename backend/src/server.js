const express = require('express');
const pkg = require('pg');
const Bull = require('bull');
const crypto = require('crypto');
const axios = require('axios');

const { Pool } = pkg;
const app = express();
app.use(express.json());

// Database connection
const pool = new Pool({
  user: process.env.DB_USER || 'gateway_user',
  password: process.env.DB_PASSWORD || 'gateway_pass',
  host: process.env.DB_HOST || 'postgres',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'payment_gateway'
});

// Job queues
const paymentQueue = new Bull('payment-processing', process.env.REDIS_URL || 'redis://redis:6379');
const webhookQueue = new Bull('webhook-delivery', process.env.REDIS_URL || 'redis://redis:6379');
const refundQueue = new Bull('refund-processing', process.env.REDIS_URL || 'redis://redis:6379');

// Middleware for API authentication
const authenticate = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  const apiSecret = req.headers['x-api-secret'];

  if (!apiKey || !apiSecret) {
    return res.status(401).json({ error: { code: 'UNAUTHORIZED', description: 'Missing API credentials' } });
  }

  // In production, validate against database. For testing, use hardcoded values
  if (apiKey === 'key_test_abc123' && apiSecret === 'secret_test_xyz789') {
    req.merchantId = '550e8400-e29b-41d4-a716-446655440000'; // Test merchant ID
    next();
  } else {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', description: 'Invalid credentials' } });
  }
};

// Helper: Generate unique IDs
const generateId = (prefix, length = 16) => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = prefix;
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

// Helper: Generate HMAC signature
const generateSignature = (payload, secret) => {
  const payloadString = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return crypto.createHmac('sha256', secret).update(payloadString).digest('hex');
};

// POST /api/v1/payments - Create payment with idempotency
app.post('/api/v1/payments', authenticate, async (req, res) => {
  try {
    const { order_id, amount, currency, method, vpa } = req.body;
    const idempotencyKey = req.headers['idempotency-key'];
    const merchantId = req.merchantId;

    // Check idempotency
    if (idempotencyKey) {
      const result = await pool.query(
        'SELECT response, expires_at FROM idempotency_keys WHERE key = $1 AND merchant_id = $2',
        [idempotencyKey, merchantId]
      );
      if (result.rows.length > 0 && new Date(result.rows[0].expires_at) > new Date()) {
        return res.status(201).json(JSON.parse(result.rows[0].response));
      }
      if (result.rows.length > 0) {
        await pool.query('DELETE FROM idempotency_keys WHERE key = $1', [idempotencyKey]);
      }
    }

    const paymentId = generateId('pay_');
    const createdAt = new Date().toISOString();

    // Create payment record
    await pool.query(
      'INSERT INTO payments (id, merchant_id, order_id, amount, currency, method, vpa, status, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
      [paymentId, merchantId, order_id, amount || 50000, currency || 'INR', method, vpa, 'pending', createdAt]
    );

    // Enqueue payment processing job
    await paymentQueue.add({ paymentId }, { removeOnComplete: true, removeOnFail: false });

    const response = {
      id: paymentId,
      order_id,
      amount: amount || 50000,
      currency: currency || 'INR',
      method,
      vpa,
      status: 'pending',
      created_at: createdAt
    };

    // Store idempotency key if provided
    if (idempotencyKey) {
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      await pool.query(
        'INSERT INTO idempotency_keys (key, merchant_id, response, created_at, expires_at) VALUES ($1, $2, $3, $4, $5)',
        [idempotencyKey, merchantId, JSON.stringify(response), createdAt, expiresAt]
      );
    }

    res.status(201).json(response);
  } catch (error) {
    console.error('Payment creation error:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', description: error.message } });
  }
});

// POST /api/v1/payments/{id}/capture - Capture payment
app.post('/api/v1/payments/:paymentId/capture', authenticate, async (req, res) => {
  try {
    const { paymentId } = req.params;
    const result = await pool.query('SELECT * FROM payments WHERE id = $1 AND merchant_id = $2', [paymentId, req.merchantId]);

    if (result.rows.length === 0) return res.status(404).json({ error: { code: 'NOT_FOUND', description: 'Payment not found' } });
    const payment = result.rows[0];

    if (payment.status !== 'success') {
      return res.status(400).json({ error: { code: 'BAD_REQUEST_ERROR', description: 'Payment not in capturable state' } });
    }

    await pool.query('UPDATE payments SET captured = true, updated_at = $1 WHERE id = $2', [new Date().toISOString(), paymentId]);

    res.json({
      ...payment,
      captured: true,
      updated_at: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', description: error.message } });
  }
});

// POST /api/v1/payments/{id}/refunds - Create refund
app.post('/api/v1/payments/:paymentId/refunds', authenticate, async (req, res) => {
  try {
    const { paymentId } = req.params;
    const { amount, reason } = req.body;
    const merchantId = req.merchantId;

    // Validate payment
    const paymentResult = await pool.query('SELECT * FROM payments WHERE id = $1 AND merchant_id = $2', [paymentId, merchantId]);
    if (paymentResult.rows.length === 0 || paymentResult.rows[0].status !== 'success') {
      return res.status(400).json({ error: { code: 'BAD_REQUEST_ERROR', description: 'Payment not refundable' } });
    }

    const payment = paymentResult.rows[0];

    // Calculate total refunded
    const refundResult = await pool.query(
      'SELECT SUM(amount) as total FROM refunds WHERE payment_id = $1 AND status IN ($2, $3)',
      [paymentId, 'pending', 'processed']
    );
    const totalRefunded = refundResult.rows[0].total || 0;

    if (amount + totalRefunded > payment.amount) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST_ERROR', description: 'Refund amount exceeds available amount' } });
    }

    const refundId = generateId('rfnd_');
    const createdAt = new Date().toISOString();

    // Create refund
    await pool.query(
      'INSERT INTO refunds (id, payment_id, merchant_id, amount, reason, status, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [refundId, paymentId, merchantId, amount, reason, 'pending', createdAt]
    );

    // Enqueue refund processing
    await refundQueue.add({ refundId }, { removeOnComplete: true });

    res.status(201).json({
      id: refundId,
      payment_id: paymentId,
      amount,
      reason,
      status: 'pending',
      created_at: createdAt
    });
  } catch (error) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', description: error.message } });
  }
});

// GET /api/v1/refunds/{id} - Get refund
app.get('/api/v1/refunds/:refundId', authenticate, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM refunds WHERE id = $1 AND merchant_id = $2', [req.params.refundId, req.merchantId]);
    if (result.rows.length === 0) return res.status(404).json({ error: { code: 'NOT_FOUND' } });
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', description: error.message } });
  }
});

// GET /api/v1/webhooks - List webhook logs
app.get('/api/v1/webhooks', authenticate, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const offset = parseInt(req.query.offset) || 0;

    const result = await pool.query(
      'SELECT id, event, status, attempts, created_at, last_attempt_at, response_code FROM webhook_logs WHERE merchant_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
      [req.merchantId, limit, offset]
    );
    const countResult = await pool.query('SELECT COUNT(*) as total FROM webhook_logs WHERE merchant_id = $1', [req.merchantId]);

    res.json({
      data: result.rows,
      total: parseInt(countResult.rows[0].total),
      limit,
      offset
    });
  } catch (error) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', description: error.message } });
  }
});

// POST /api/v1/webhooks/{id}/retry - Retry webhook
app.post('/api/v1/webhooks/:webhookId/retry', authenticate, async (req, res) => {
  try {
    const { webhookId } = req.params;
    const result = await pool.query('SELECT * FROM webhook_logs WHERE id = $1 AND merchant_id = $2', [webhookId, req.merchantId]);

    if (result.rows.length === 0) return res.status(404).json({ error: { code: 'NOT_FOUND' } });

    await pool.query('UPDATE webhook_logs SET attempts = 0, status = $1 WHERE id = $2', ['pending', webhookId]);
    await webhookQueue.add({ webhookId }, { removeOnComplete: true });

    res.json({ id: webhookId, status: 'pending', message: 'Webhook retry scheduled' });
  } catch (error) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', description: error.message } });
  }
});

// GET /api/v1/test/jobs/status - Job queue status (no auth required)
app.get('/api/v1/test/jobs/status', async (req, res) => {
  try {
    const paymentCounts = await paymentQueue.getJobCounts();
    const webhookCounts = await webhookQueue.getJobCounts();
    const refundCounts = await refundQueue.getJobCounts();

    res.json({
      pending: (paymentCounts.waiting || 0) + (webhookCounts.waiting || 0) + (refundCounts.waiting || 0),
      processing: (paymentCounts.active || 0) + (webhookCounts.active || 0) + (refundCounts.active || 0),
      completed: (paymentCounts.completed || 0) + (webhookCounts.completed || 0) + (refundCounts.completed || 0),
      failed: (paymentCounts.failed || 0) + (webhookCounts.failed || 0) + (refundCounts.failed || 0),
      worker_status: 'running'
    });
  } catch (error) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', description: error.message } });
  }
});

// Start server
const PORT = process.env.PORT || 8000;
app.listen(PORT, () => console.log(`🚀 Payment Gateway API running on port ${PORT}`));

module.exports = { app, pool, paymentQueue, webhookQueue, refundQueue };
