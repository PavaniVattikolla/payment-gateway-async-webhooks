# Implementation Guide - Payment Gateway Async Webhooks (Deliverable 2)

This guide provides the structure and code templates for implementing the remaining features of the payment gateway system.

## Project Structure

```
backend/
├── src/
│   ├── index.js                 # Main Express app
│   ├── db.js                    # PostgreSQL connection
│   ├── redis.js                 # Redis client
│   ├── api/
│   │   ├── auth.js              # Authentication middleware
│   │   ├── payments.js          # Payment endpoints
│   │   ├── refunds.js           # Refund endpoints
│   │   ├── webhooks.js          # Webhook endpoints
│   │   └── health.js            # Health check
│   ├── workers/
│   │   ├── index.js             # Worker process
│   │   ├── paymentWorker.js     # Payment processing
│   │   ├── webhookWorker.js     # Webhook delivery
│   │   └── refundWorker.js      # Refund processing
│   ├── jobs/
│   │   ├── processPayment.js    # Payment job
│   │   ├── deliverWebhook.js    # Webhook delivery job
│   │   └── processRefund.js     # Refund job
│   ├── services/
│   │   ├── idempotency.js       # Idempotency key handling
│   │   ├── webhookService.js    # Webhook logic
│   │   └── paymentService.js    # Payment logic
│   └── utils/
│       ├── crypto.js            # HMAC signature generation
│       └── validators.js        # Request validation
├── migrations/
│   ├── 002_create_refunds_table.sql
│   ├── 003_create_webhook_logs_table.sql
│   └── 004_create_idempotency_keys_table.sql
└── package.json
```

## Key Implementation Steps

### 1. Database Setup
- Run migrations to create refunds, webhook_logs, and idempotency_keys tables
- Add webhook_secret and webhook_url columns to merchants table
- Create necessary indexes for performance

### 2. Job Queue Implementation
Use Bull (Redis-based queue) for job processing:
- PaymentWorker: Process payments asynchronously with configurable success rates and delays
- WebhookWorker: Deliver webhooks with retry logic and exponential backoff
- RefundWorker: Process refunds asynchronously

### 3. API Endpoints

#### Payment Endpoints
- `POST /api/v1/payments` - Create payment with idempotency support
  - Check idempotency cache before processing
  - Enqueue ProcessPaymentJob
  - Store response in idempotency_keys table
  
- `POST /api/v1/payments/{payment_id}/capture` - Capture payment
- `POST /api/v1/payments/{payment_id}/refunds` - Create refund
- `GET /api/v1/refunds/{refund_id}` - Get refund status
- `GET /api/v1/webhooks` - List webhook logs
- `POST /api/v1/webhooks/{webhook_id}/retry` - Manual webhook retry
- `GET /api/v1/test/jobs/status` - Job queue status (test endpoint)

#### Key Features
- Idempotency key validation (24-hour expiry)
- HMAC-SHA256 webhook signature generation
- Automatic retry with exponential backoff (1min, 5min, 30min, 2hr)
- Test mode support for deterministic behavior

### 4. Webhook Delivery
- Generate HMAC-SHA256 signature using merchant's webhook_secret
- Send POST request with X-Webhook-Signature header
- Log attempt with response code and body
- Schedule retries based on failure
- Support 5 retry attempts before permanent failure

### 5. SDK Implementation
- Create PaymentGateway class that opens modal/iframe
- Implement postMessage communication between iframe and parent
- Support callbacks: onSuccess, onFailure, onClose
- Handle cross-origin communication

### 6. Dashboard Enhancements
- Webhook configuration page (/dashboard/webhooks)
- Webhook delivery logs with pagination
- Manual retry button for failed webhooks
- API documentation page (/dashboard/docs)

## Environment Variables

```bash
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/payment_gateway

# Redis
REDIS_URL=redis://localhost:6379

# API Settings
NODE_ENV=production
PORT=8000
API_KEY=key_test_abc123
API_SECRET=secret_test_xyz789

# Test Mode (for automated evaluation)
TEST_MODE=false
TEST_PROCESSING_DELAY=1000      # milliseconds
TEST_PAYMENT_SUCCESS=true       # true or false
WEBHOOK_RETRY_INTERVALS_TEST=false  # Use test retry intervals
```

## Testing Checklist

- [ ] Database migrations execute successfully
- [ ] Worker processes jobs from Redis queue
- [ ] Idempotency keys prevent duplicate payments
- [ ] Webhook signatures are generated correctly
- [ ] Webhooks retry with correct intervals
- [ ] SDK loads and opens payment modal
- [ ] Dashboard displays webhook logs and allows manual retry
- [ ] Job queue status endpoint returns correct statistics

## Critical Implementation Notes

1. **Idempotency**: Check and return cached response BEFORE creating job
2. **Webhook Signature**: Use exact JSON string as sent in HTTP body
3. **Retry Schedule**: Follow exact timing (immediate, 1min, 5min, 30min, 2hr)
4. **Test Mode**: Support environment variables for deterministic testing
5. **Payment Status**: Use 'pending' instead of 'processing' for async payments
6. **Captured Field**: Add `captured BOOLEAN DEFAULT false` to payments table
7. **Worker Dependencies**: Ensure Redis, PostgreSQL, and API are healthy before worker starts

## Common Issues & Solutions

- **Worker not processing jobs**: Verify Redis connection and worker container is running
- **Webhook signatures don't match**: Ensure using exact JSON string, no whitespace changes
- **Idempotency not working**: Check expiration logic compares with current time
- **SDK not loading**: Verify checkout service is accessible and webpack bundle is UMD format

## Next Steps

1. Implement backend/src/index.js - Main Express application
2. Implement database connection and query functions
3. Implement job queue initialization with Bull
4. Implement worker process
5. Implement API endpoint handlers
6. Implement webhook delivery logic
7. Implement SDK and embed on checkout page
8. Add dashboard webhook configuration UI

Refer to task specifications in Partnr dashboard for detailed requirements for each component.
