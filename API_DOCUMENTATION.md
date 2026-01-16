# Payment Gateway API Documentation

## Overview

This document provides comprehensive API reference for the Payment Gateway system. The API follows REST principles and uses JSON for request/response payloads.

## Base URL

```
http://localhost:8000/api/v1
```

## Authentication

All endpoints (except test endpoints) require authentication using API credentials:

### Headers
```
X-Api-Key: your_api_key
X-Api-Secret: your_api_secret
Content-Type: application/json
```

### Example Credentials (for testing)
```
X-Api-Key: key_test_abc123
X-Api-Secret: secret_test_xyz789
```

## Error Handling

All errors follow a consistent format:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "description": "Human readable error message"
  }
}
```

### Common Error Codes
- `UNAUTHORIZED` - Missing or invalid credentials
- `NOT_FOUND` - Resource not found
- `BAD_REQUEST` - Invalid request format
- `INTERNAL_ERROR` - Server error

## Payment Endpoints

### 1. Create Payment

Initiates a payment processing request.

**Endpoint:** `POST /payments`

**Headers:**
```
X-Api-Key: key_test_abc123
X-Api-Secret: secret_test_xyz789
Idempotency-Key: optional-unique-key (recommended)
Content-Type: application/json
```

**Request Body:**
```json
{
  "order_id": "order_12345",
  "amount": 50000,
  "currency": "INR",
  "method": "upi",
  "vpa": "user@paytm"
}
```

**Parameters:**
- `order_id` (string, required) - Unique order identifier
- `amount` (integer, optional) - Amount in paise. Default: 50000
- `currency` (string, optional) - Currency code. Default: INR
- `method` (string, required) - Payment method: 'upi' or 'card'
- `vpa` (string, optional) - UPI Virtual Payment Address

**Response (201 Created):**
```json
{
  "id": "pay_H8sK3jD9s2L1pQr",
  "order_id": "order_12345",
  "amount": 50000,
  "currency": "INR",
  "method": "upi",
  "vpa": "user@paytm",
  "status": "pending",
  "created_at": "2024-01-15T10:31:00Z"
}
```

**Idempotency:**
Include `Idempotency-Key` header to make requests idempotent. The same key will return the cached response for 24 hours.

---

### 2. Capture Payment

Capture a payment for settlement (after successful authorization).

**Endpoint:** `POST /payments/{payment_id}/capture`

**Headers:**
```
X-Api-Key: key_test_abc123
X-Api-Secret: secret_test_xyz789
Content-Type: application/json
```

**Response (200 OK):**
```json
{
  "id": "pay_H8sK3jD9s2L1pQr",
  "order_id": "order_12345",
  "amount": 50000,
  "currency": "INR",
  "method": "upi",
  "status": "success",
  "captured": true,
  "updated_at": "2024-01-15T10:35:00Z"
}
```

---

## Refund Endpoints

### 3. Create Refund

Initiate a full or partial refund for a successful payment.

**Endpoint:** `POST /payments/{payment_id}/refunds`

**Headers:**
```
X-Api-Key: key_test_abc123
X-Api-Secret: secret_test_xyz789
Content-Type: application/json
```

**Request Body:**
```json
{
  "amount": 50000,
  "reason": "Customer requested refund"
}
```

**Parameters:**
- `amount` (integer, required) - Refund amount in paise
- `reason` (string, optional) - Reason for refund

**Response (201 Created):**
```json
{
  "id": "rfnd_X9jK2pL8m3nQ5rS",
  "payment_id": "pay_H8sK3jD9s2L1pQr",
  "amount": 50000,
  "reason": "Customer requested refund",
  "status": "pending",
  "created_at": "2024-01-15T10:40:00Z"
}
```

**Status Values:**
- `pending` - Refund processing in progress
- `processed` - Refund successfully processed

---

### 4. Get Refund

Retrieve details of a specific refund.

**Endpoint:** `GET /refunds/{refund_id}`

**Headers:**
```
X-Api-Key: key_test_abc123
X-Api-Secret: secret_test_xyz789
```

**Response (200 OK):**
```json
{
  "id": "rfnd_X9jK2pL8m3nQ5rS",
  "payment_id": "pay_H8sK3jD9s2L1pQr",
  "amount": 50000,
  "reason": "Customer requested refund",
  "status": "processed",
  "created_at": "2024-01-15T10:40:00Z",
  "processed_at": "2024-01-15T10:42:00Z"
}
```

---

## Webhook Endpoints

### 5. List Webhook Logs

Retrieve webhook delivery logs with pagination.

**Endpoint:** `GET /webhooks?limit=10&offset=0`

**Headers:**
```
X-Api-Key: key_test_abc123
X-Api-Secret: secret_test_xyz789
```

**Query Parameters:**
- `limit` (integer, optional) - Number of records per page. Default: 10, Max: 100
- `offset` (integer, optional) - Number of records to skip. Default: 0

**Response (200 OK):**
```json
{
  "data": [
    {
      "id": "webhook_log_uuid",
      "event": "payment.success",
      "status": "success",
      "attempts": 1,
      "created_at": "2024-01-15T10:31:00Z",
      "last_attempt_at": "2024-01-15T10:31:05Z",
      "response_code": 200
    }
  ],
  "total": 42,
  "limit": 10,
  "offset": 0
}
```

**Webhook Status Values:**
- `pending` - Awaiting delivery attempt
- `success` - Successfully delivered
- `failed` - Failed after all retry attempts

---

### 6. Retry Webhook

Manually retry a failed webhook delivery.

**Endpoint:** `POST /webhooks/{webhook_id}/retry`

**Headers:**
```
X-Api-Key: key_test_abc123
X-Api-Secret: secret_test_xyz789
Content-Type: application/json
```

**Response (200 OK):**
```json
{
  "id": "webhook_log_uuid",
  "status": "pending",
  "message": "Webhook retry scheduled"
}
```

---

## Test Endpoints

### 7. Job Queue Status

Check the status of background job processing (for testing/monitoring).

**Endpoint:** `GET /test/jobs/status`

**Headers:** (No authentication required)

**Response (200 OK):**
```json
{
  "pending": 5,
  "processing": 2,
  "completed": 150,
  "failed": 1,
  "worker_status": "running"
}
```

---

## Webhook Events

The system sends webhooks for the following events:

### Event Types

1. **payment.success** - Payment successfully processed
2. **payment.failed** - Payment processing failed
3. **refund.processed** - Refund successfully completed

### Webhook Payload Structure

```json
{
  "event": "payment.success",
  "timestamp": 1705315870,
  "data": {
    "payment": {
      "id": "pay_H8sK3jD9s2L1pQr",
      "order_id": "order_12345",
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

### Webhook Signature Verification

All webhooks include an `X-Webhook-Signature` header with HMAC-SHA256 signature.

**Verification Example (Node.js):**

```javascript
const crypto = require('crypto');

function verifyWebhook(payload, signature, secret) {
  const payloadString = JSON.stringify(payload);
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(payloadString)
    .digest('hex');
  
  return signature === expectedSignature;
}
```

### Retry Logic

Failed webhooks are automatically retried with exponential backoff:

- **Attempt 1**: Immediate
- **Attempt 2**: After 1 minute
- **Attempt 3**: After 5 minutes
- **Attempt 4**: After 30 minutes
- **Attempt 5**: After 2 hours

After 5 failed attempts, the webhook is marked as permanently failed.

---

## Rate Limiting

Currently no rate limiting is implemented. In production, implement per-merchant rate limits.

---

## Pagination

List endpoints support cursor-based pagination:

```
?limit=10&offset=0
```

- `limit`: Number of items per page (default: 10, max: 100)
- `offset`: Number of items to skip (default: 0)

---

## Status Codes

| Code | Meaning |
|------|----------|
| 200 | Success |
| 201 | Resource created |
| 400 | Bad request |
| 401 | Unauthorized |
| 404 | Not found |
| 500 | Server error |

---

## Example Requests

### Create Payment with cURL

```bash
curl -X POST http://localhost:8000/api/v1/payments \
  -H "X-Api-Key: key_test_abc123" \
  -H "X-Api-Secret: secret_test_xyz789" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: unique-key-12345" \
  -d '{
    "order_id": "order_12345",
    "method": "upi",
    "vpa": "user@paytm"
  }'
```

### Create Refund with cURL

```bash
curl -X POST http://localhost:8000/api/v1/payments/pay_H8sK3jD9s2L1pQr/refunds \
  -H "X-Api-Key: key_test_abc123" \
  -H "X-Api-Secret: secret_test_xyz789" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 50000,
    "reason": "Customer requested"
  }'
```

### List Webhooks with cURL

```bash
curl -X GET "http://localhost:8000/api/v1/webhooks?limit=10&offset=0" \
  -H "X-Api-Key: key_test_abc123" \
  -H "X-Api-Secret: secret_test_xyz789"
```

---

## Best Practices

1. **Always use Idempotency-Key** for payment creation to prevent duplicate charges
2. **Verify webhook signatures** before processing webhook data
3. **Implement webhook retry logic** on merchant side as well
4. **Handle all webhook events** even if not immediately useful
5. **Store webhook delivery logs** for audit and debugging
6. **Use appropriate HTTP methods** (GET for retrieval, POST for creation)
7. **Validate input data** before sending to API
8. **Implement exponential backoff** for API retries

---

## Support

For issues or questions, refer to the main README.md or open an issue on GitHub.
