# Production-Ready Payment Gateway with Async Processing and Webhooks

A comprehensive payment gateway implementation featuring asynchronous job processing, webhook delivery with retry mechanisms, embeddable JavaScript SDK, and refund management.

## Features

- **Asynchronous Payment Processing**: Redis-based job queues with worker services
- **Webhook Delivery System**: HMAC-SHA256 signature verification with automatic retry logic
- **Embeddable JavaScript SDK**: Cross-origin payment collection via modal/iframe
- **Refund Management**: Full and partial refund support with asynchronous processing
- **Idempotency Keys**: Prevent duplicate charges on network retries
- **Enhanced Dashboard**: Webhook configuration, delivery logs, and manual retry functionality
- **Job Queue Status Monitoring**: Real-time visibility into background job processing

## Quick Start

### Prerequisites

- Docker and Docker Compose
- Node.js 18+ (for local development)
- PostgreSQL 13+
- Redis 7+

### Installation

1. Clone the repository
```bash
git clone https://github.com/PavaniVattikolla/payment-gateway-async-webhooks.git
cd payment-gateway-async-webhooks
```

2. Start all services
```bash
docker-compose up -d
```

This will start:
- PostgreSQL (port 5432)
- Redis (port 6379)
- API Server (port 8000)
- Worker Service (background job processing)
- Dashboard (port 3000)
- Checkout Page (port 3001)

## API Documentation

### Authentication

All API endpoints (except test endpoints) require authentication via headers:

```
X-Api-Key: key_test_abc123
X-Api-Secret: secret_test_xyz789
```

### Payment Endpoints

#### Create Payment

`POST /api/v1/payments`

Create a payment and queue for async processing.

**Headers:**
- `X-Api-Key`: API key (required)
- `X-Api-Secret`: API secret (required)
- `Idempotency-Key`: Optional, prevents duplicate processing
- `Content-Type`: application/json

**Request Body:**
```json
{
  "order_id": "order_NXhj67fGH2jk9mPq",
  "method": "upi",
  "vpa": "user@paytm"
}
```

**Response (201):**
```json
{
  "id": "pay_H8sK3jD9s2L1pQr",
  "order_id": "order_NXhj67fGH2jk9mPq",
  "amount": 50000,
  "currency": "INR",
  "method": "upi",
  "vpa": "user@paytm",
  "status": "pending",
  "created_at": "2024-01-15T10:31:00Z"
}
```

#### Capture Payment

`POST /api/v1/payments/{payment_id}/capture`

Capture a payment for settlement.

#### Create Refund

`POST /api/v1/payments/{payment_id}/refunds`

Initiate a full or partial refund.

**Request Body:**
```json
{
  "amount": 50000,
  "reason": "Customer requested refund"
}
```

#### Get Refund

`GET /api/v1/refunds/{refund_id}`

Retrieve refund details and status.

#### List Webhook Logs

`GET /api/v1/webhooks?limit=10&offset=0`

List webhook delivery logs with pagination.

#### Retry Webhook

`POST /api/v1/webhooks/{webhook_id}/retry`

Manually retry a failed webhook delivery.

#### Job Queue Status (Test Endpoint)

`GET /api/v1/test/jobs/status`

No authentication required. Returns current job queue statistics.

## Environment Variables

```bash
# Database
DATABASE_URL=postgresql://gateway_user:gateway_pass@postgres:5432/payment_gateway

# Redis
REDIS_URL=redis://redis:6379

# Application
NODE_ENV=development
PORT=8000

# Test Mode (for automated evaluation)
TEST_MODE=false
TEST_PROCESSING_DELAY=1000
TEST_PAYMENT_SUCCESS=true
WEBHOOK_RETRY_INTERVALS_TEST=false

# API Keys
API_KEY=key_test_abc123
API_SECRET=secret_test_xyz789
```

## Webhook Integration Guide

### Webhook Events

The system emits the following events:

- `payment.created` - When payment record is created
- `payment.pending` - When payment enters pending state
- `payment.success` - When payment succeeds
- `payment.failed` - When payment fails
- `refund.created` - When refund is initiated
- `refund.processed` - When refund completes

### Webhook Payload Format

```json
{
  "event": "payment.success",
  "timestamp": 1705315870,
  "data": {
    "payment": {
      "id": "pay_H8sK3jD9s2L1pQr",
      "order_id": "order_NXhj67fGH2jk9mPq",
      "amount": 50000,
      "currency": "INR",
      "method": "upi",
      "vpa": "user@paytm",
      "status": "success",
      "created_at": "2024-01-15T10:31:00Z"
    }
  }
}
```

### Signature Verification

All webhooks are signed with HMAC-SHA256. To verify:

```javascript
const crypto = require('crypto');

function verifyWebhook(payload, signature, secret) {
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(payload))
    .digest('hex');
  
  return signature === expectedSignature;
}
```

### Retry Logic

Webhooks are retried with exponential backoff:
- Attempt 1: Immediate
- Attempt 2: After 1 minute
- Attempt 3: After 5 minutes
- Attempt 4: After 30 minutes
- Attempt 5: After 2 hours

After 5 failed attempts, webhooks are marked as permanently failed.

## SDK Integration Guide

### Installation

Include the SDK in your merchant website:

```html
<script src="http://localhost:3001/checkout.js"></script>
```

### Usage

```javascript
document.getElementById('pay-button').addEventListener('click', function() {
  const checkout = new PaymentGateway({
    key: 'key_test_abc123',
    orderId: 'order_xyz',
    onSuccess: function(response) {
      console.log('Payment successful:', response.paymentId);
    },
    onFailure: function(error) {
      console.log('Payment failed:', error);
    }
  });
  
  checkout.open();
});
```

## Testing Instructions

### Test Merchant Webhook Receiver

Create a test webhook receiver to verify webhook delivery:

```javascript
// test-merchant/webhook-receiver.js
const express = require('express');
const crypto = require('crypto');

const app = express();
app.use(express.json());

app.post('/webhook', (req, res) => {
  const signature = req.headers['x-webhook-signature'];
  const payload = JSON.stringify(req.body);
  
  const expectedSignature = crypto
    .createHmac('sha256', 'whsec_test_abc123')
    .update(payload)
    .digest('hex');
  
  if (signature !== expectedSignature) {
    console.log('❌ Invalid signature');
    return res.status(401).send('Invalid signature');
  }
  
  console.log('✅ Webhook verified:', req.body.event);
  console.log('Payment ID:', req.body.data.payment.id);
  res.status(200).send('OK');
});

app.listen(4000, () => {
  console.log('Test merchant webhook running on port 4000');
});
```

Configure webhook URL in dashboard: `http://host.docker.internal:4000/webhook`

## Database Schema

The application uses the following main tables:

### Payments
- id (primary key)
- order_id
- amount
- currency
- method (upi, card)
- status (pending, processing, success, failed)
- merchant_id (foreign key)
- created_at, updated_at

### Refunds
- id (primary key, format: rfnd_XXXXXXXXXXXXX)
- payment_id (foreign key)
- merchant_id (foreign key)
- amount
- reason
- status (pending, processed)
- created_at, processed_at

### Webhook Logs
- id (UUID, primary key)
- merchant_id (foreign key)
- event
- payload (JSON)
- status (pending, success, failed)
- attempts
- last_attempt_at
- next_retry_at
- response_code
- response_body
- created_at

### Idempotency Keys
- key (primary key, string up to 255 chars)
- merchant_id (foreign key)
- response (JSON)
- created_at, expires_at

## Docker Services

The `docker-compose.yml` includes:

- **postgres**: PostgreSQL database
- **redis**: Redis cache and job queue
- **api**: Main API server (Node.js/Express)
- **worker**: Background job processor
- **dashboard**: Frontend dashboard (React)
- **checkout**: Payment checkout page

## Project Structure

```
payment-gateway-async-webhooks/
├── backend/
│   ├── src/
│   │   ├── api/
│   │   │   └── routes/
│   │   │       └── payments.js
│   │   ├── workers/
│   │   │   ├── PaymentWorker.js
│   │   │   ├── WebhookWorker.js
│   │   │   └── RefundWorker.js
│   │   ├── jobs/
│   │   │   ├── ProcessPaymentJob.js
│   │   │   ├── DeliverWebhookJob.js
│   │   │   └── ProcessRefundJob.js
│   │   └── migrations/
│   ├── Dockerfile.worker
│   └── package.json
├── dashboard/
│   ├── src/
│   │   └── pages/
│   │       └── WebhookConfig.jsx
│   └── package.json
├── checkout-widget/
│   ├── src/
│   │   ├── sdk/
│   │   │   ├── PaymentGateway.js
│   │   │   └── modal.js
│   │   └── iframe-content/
│   ├── webpack.config.js
│   └── package.json
├── docker-compose.yml
├── README.md
├── submission.yml
└── .env.example
```

## Troubleshooting

### Job Queue Issues
- Ensure worker service is running: `docker-compose ps`
- Check Redis connectivity: `docker exec -it redis_gateway redis-cli ping`
- Check job queue status: `GET /api/v1/test/jobs/status`

### Webhook Not Delivering
- Verify webhook URL is configured in dashboard
- Check webhook logs for error details
- Ensure webhook secret is correct
- Test webhook signature verification locally

### Idempotency Not Working
- Verify `Idempotency-Key` header is being sent
- Check that idempotency_keys table exists and has records
- Ensure expiration logic is checking `expires_at > current_time`

## Common Mistakes to Avoid

1. **Job queue not processing**: Ensure worker service is running and connected to Redis
2. **Webhook signatures don't match**: Use exact JSON string sent in request body, no pretty-printing
3. **Idempotency keys not working**: Check before any database operations, store complete response
4. **Exponential backoff incorrect**: Follow exact schedule: immediate, 1min, 5min, 30min, 2hrs
5. **SDK not loading**: Ensure webpack config outputs UMD bundle and exposes `PaymentGateway` globally
6. **PostMessage origin restrictions**: For production, validate event.origin instead of using '*'
7. **Refund amount validation**: Check total refunded amount across all refunds, not just individual amounts
8. **Webhook retry scheduling**: Use database `next_retry_at`, not in-memory timers
9. **Payment status**: In Deliverable 2, use 'pending' instead of 'processing'
10. **Captured field**: Add `captured BOOLEAN DEFAULT false` to payments table

## Support

For issues or questions, please check the documentation or open an issue on GitHub.

## License

MIT
