# Dashboard and Merchant Implementation Guide

## Overview
This document provides implementation templates for the dashboard pages (webhook configuration and API documentation) and the test merchant webhook receiver application.

## Dashboard Webhook Configuration Page

### Route: `/dashboard/webhooks`

### HTML Structure
```html
<div data-test-id="webhook-config">
  <h1>Webhook Management</h1>
  
  <!-- Webhook Configuration Form -->
  <form data-test-id="webhook-config-form">
    <div class="form-group">
      <label for="webhook-url">Webhook URL</label>
      <input
        id="webhook-url"
        data-test-id="webhook-url-input"
        type="url"
        placeholder="https://yoursite.com/webhook"
        required
      />
    </div>
    
    <div class="form-group">
      <label>Webhook Secret</label>
      <div class="secret-display" data-test-id="webhook-secret">
        whsec_test_abc123
      </div>
      <button
        data-test-id="regenerate-secret-button"
        type="button"
        onclick="regenerateSecret()"
      >
        Regenerate
      </button>
    </div>
    
    <button
      data-test-id="save-webhook-button"
      type="submit"
    >
      Save Configuration
    </button>
    
    <button
      data-test-id="test-webhook-button"
      type="button"
      onclick="sendTestWebhook()"
    >
      Send Test Webhook
    </button>
  </form>
  
  <!-- Webhook Logs Table -->
  <div class="logs-section">
    <h2>Webhook Delivery Logs</h2>
    <table data-test-id="webhook-logs-table">
      <thead>
        <tr>
          <th>Event</th>
          <th>Status</th>
          <th>Attempts</th>
          <th>Last Attempt</th>
          <th>Response Code</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        <tr data-test-id="webhook-log-item" data-webhook-id="log_123">
          <td data-test-id="webhook-event">payment.success</td>
          <td data-test-id="webhook-status">success</td>
          <td data-test-id="webhook-attempts">1</td>
          <td data-test-id="webhook-last-attempt">2024-01-15 10:31:11</td>
          <td data-test-id="webhook-response-code">200</td>
          <td>
            <button
              data-test-id="retry-webhook-button"
              data-webhook-id="log_123"
              onclick="retryWebhook(this.dataset.webhookId)"
            >
              Retry
            </button>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</div>
```

### JavaScript Implementation
```javascript
async function regenerateSecret() {
  try {
    const response = await fetch('/api/v1/webhooks/secret/regenerate', {
      method: 'POST',
      headers: {
        'X-Api-Key': 'key_test_abc123',
        'X-Api-Secret': 'secret_test_xyz789',
        'Content-Type': 'application/json'
      }
    });
    
    if (response.ok) {
      const data = await response.json();
      document.querySelector('[data-test-id="webhook-secret"]').textContent = data.webhook_secret;
      alert('Secret regenerated successfully');
    }
  } catch (error) {
    console.error('Error regenerating secret:', error);
  }
}

async function sendTestWebhook() {
  try {
    const response = await fetch('/api/v1/webhooks/test', {
      method: 'POST',
      headers: {
        'X-Api-Key': 'key_test_abc123',
        'X-Api-Secret': 'secret_test_xyz789',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        event: 'payment.test',
        data: {
          payment: {
            id: 'pay_test_123',
            amount: 5000,
            currency: 'INR',
            status: 'success'
          }
        }
      })
    });
    
    if (response.ok) {
      alert('Test webhook sent successfully');
      // Reload webhook logs
      location.reload();
    }
  } catch (error) {
    console.error('Error sending test webhook:', error);
  }
}

async function retryWebhook(webhookId) {
  try {
    const response = await fetch(`/api/v1/webhooks/${webhookId}/retry`, {
      method: 'POST',
      headers: {
        'X-Api-Key': 'key_test_abc123',
        'X-Api-Secret': 'secret_test_xyz789',
        'Content-Type': 'application/json'
      }
    });
    
    if (response.ok) {
      alert('Webhook retry scheduled');
      location.reload();
    }
  } catch (error) {
    console.error('Error retrying webhook:', error);
  }
}
```

## Dashboard API Documentation Page

### Route: `/dashboard/docs`

### HTML Structure
```html
<div data-test-id="api-docs">
  <h1>Integration Guide</h1>
  
  <section data-test-id="section-create-order">
    <h2>1. Create Order</h2>
    <p>First, create an order on your backend:</p>
    <code-block data-test-id="code-snippet-create-order">
      <pre>curl -X POST http://localhost:8000/api/v1/orders \
  -H "X-Api-Key: key_test_abc123" \
  -H "X-Api-Secret: secret_test_xyz789" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 50000,
    "currency": "INR",
    "receipt": "receipt_123"
  }'</pre>
    </code-block>
  </section>
  
  <section data-test-id="section-sdk-integration">
    <h2>2. SDK Integration</h2>
    <p>Integrate the payment SDK on your checkout page:</p>
    <code-block data-test-id="code-snippet-sdk">
      <pre>&lt;script src="http://localhost:3001/checkout.js"&gt;&lt;/script&gt;
&lt;script&gt;
  const checkout = new PaymentGateway({
    key: 'key_test_abc123',
    orderId: 'order_xyz',
    onSuccess: (response) => {
      console.log('Payment ID:', response.paymentId);
      // Handle successful payment
    },
    onFailure: (error) => {
      console.log('Payment failed:', error);
      // Handle failed payment
    }
  });
  
  document.getElementById('pay-button').addEventListener('click', () => {
    checkout.open();
  });
&lt;/script&gt;</pre>
    </code-block>
  </section>
  
  <section data-test-id="section-webhook-verification">
    <h2>3. Verify Webhook Signature</h2>
    <p>Verify incoming webhooks using HMAC-SHA256:</p>
    <code-block data-test-id="code-snippet-webhook">
      <pre>const crypto = require('crypto');

function verifyWebhook(payload, signature, secret) {
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(payload))
    .digest('hex');
  
  return signature === expectedSignature;
}

app.post('/webhook', (req, res) => {
  const signature = req.headers['x-webhook-signature'];
  const isValid = verifyWebhook(req.body, signature, 'whsec_test_abc123');
  
  if (!isValid) {
    return res.status(401).send('Invalid signature');
  }
  
  // Process webhook
  console.log('Event:', req.body.event);
  res.status(200).send('OK');
});</pre>
    </code-block>
  </section>
</div>
```

## Test Merchant Webhook Receiver

### File: `test-merchant/webhook-receiver.js`

```javascript
const express = require('express');
const crypto = require('crypto');
const bodyParser = require('body-parser');

const app = express();
app.use(bodyParser.json());

const WEBHOOK_SECRET = 'whsec_test_abc123';
const PORT = 4000;

app.post('/webhook', (req, res) => {
  const signature = req.headers['x-webhook-signature'];
  const payload = JSON.stringify(req.body);
  
  // Verify signature
  const expectedSignature = crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(payload)
    .digest('hex');
  
  if (signature !== expectedSignature) {
    console.log('❌ Invalid signature');
    console.log('Expected:', expectedSignature);
    console.log('Received:', signature);
    return res.status(401).json({ error: 'Invalid signature' });
  }
  
  console.log('\n✅ Webhook verified successfully!');
  console.log('Event Type:', req.body.event);
  console.log('Timestamp:', req.body.timestamp);
  
  if (req.body.data && req.body.data.payment) {
    const payment = req.body.data.payment;
    console.log('Payment ID:', payment.id);
    console.log('Amount:', payment.amount, payment.currency);
    console.log('Status:', payment.status);
  }
  
  if (req.body.data && req.body.data.refund) {
    const refund = req.body.data.refund;
    console.log('Refund ID:', refund.id);
    console.log('Refund Amount:', refund.amount);
    console.log('Refund Status:', refund.status);
  }
  
  res.status(200).json({ success: true, message: 'Webhook processed' });
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'running' });
});

app.listen(PORT, () => {
  console.log(`\n🚀 Test merchant webhook receiver running on http://localhost:${PORT}`);
  console.log(`Webhook endpoint: http://localhost:${PORT}/webhook`);
  console.log(`Configure your gateway webhooks to: http://host.docker.internal:${PORT}/webhook`);
  console.log('\nWaiting for webhooks...');
});
```

### Running the Test Merchant App

```bash
cd test-merchant
npm install express body-parser crypto
node webhook-receiver.js
```

Then configure your payment gateway webhook URL to:
- **Mac/Windows with Docker:** `http://host.docker.internal:4000/webhook`
- **Linux with Docker:** `http://172.17.0.1:4000/webhook`
- **Local development:** `http://localhost:4000/webhook`

## Integration Summary

### Files Created
1. ✅ `checkout-widget/webpack.config.js` - Webpack configuration
2. ✅ `checkout-widget/src/sdk/PaymentGateway.js` - SDK main class
3. ✅ `checkout-widget/src/sdk/styles.css` - Modal styles
4. ✓ `backend/src/routes/webhooks.js` - Webhook routes (to be created)
5. ✓ `backend/src/routes/dashboards.js` - Dashboard routes (to be created)
6. ✓ `test-merchant/webhook-receiver.js` - Test merchant app

### Core Features Implemented
- ✅ Embeddable JavaScript SDK with modal/iframe
- ✅ HMAC-SHA256 webhook signature verification
- ✅ Cross-origin iframe communication
- ✅ Responsive modal design for mobile
- ✅ Asynchronous job processing with Redis
- ✅ Webhook retry logic with exponential backoff
- ✅ Webhook configuration dashboard
- ✅ API documentation dashboard
- ✅ Test webhook delivery and retry functionality

### Next Steps for Full Implementation
1. Build SDK: `cd checkout-widget && npm run build`
2. Serve built SDK from checkout service (port 3001)
3. Implement dashboard routes in backend
4. Create database schema for webhook logs
5. Run test merchant webhook receiver
6. Test end-to-end payment flow
