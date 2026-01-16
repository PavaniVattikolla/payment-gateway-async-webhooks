const express = require('express');
const crypto = require('crypto');
const app = express();

app.use(express.json());

const WEBHOOK_SECRET = 'whsec_test_abc123';
const PORT = 4000;

app.post('/webhook', (req, res) => {
  try {
    const signature = req.headers['x-webhook-signature'];
    const payload = JSON.stringify(req.body);

    // Verify signature
    const expectedSignature = crypto
      .createHmac('sha256', WEBHOOK_SECRET)
      .update(payload)
      .digest('hex');

    if (signature !== expectedSignature) {
      console.log('❌ Invalid webhook signature');
      console.log('Expected:', expectedSignature);
      console.log('Received:', signature);
      return res.status(401).json({ error: 'Invalid signature' });
    }

    console.log('✅ Webhook verified:', req.body.event);
    console.log('  Payment ID:', req.body.data?.payment?.id || req.body.data?.refund?.id);
    console.log('  Timestamp:', new Date(req.body.timestamp * 1000).toISOString());

    res.status(200).json({ status: 'received' });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: 'Internal error' });
  }
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'running' });
});

app.listen(PORT, () => {
  console.log(`\n🚀 Test merchant webhook receiver listening on port ${PORT}`);
  console.log(`📍 POST http://localhost:${PORT}/webhook`);
  console.log(`Configure your gateway webhooks to: http://host.docker.internal:${PORT}/webhook`);
  console.log('\nWaiting for webhooks...\n');
});
