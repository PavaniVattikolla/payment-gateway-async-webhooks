-- Add captured field to payments table
ALTER TABLE IF EXISTS payments ADD COLUMN IF NOT EXISTS captured BOOLEAN NOT NULL DEFAULT false;

-- Add webhook_secret to merchants table
ALTER TABLE IF EXISTS merchants ADD COLUMN IF NOT EXISTS webhook_secret VARCHAR(64);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_refunds_payment_id ON refunds(payment_id);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_merchant_id ON webhook_logs(merchant_id);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_status ON webhook_logs(status);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_next_retry ON webhook_logs(next_retry_at) WHERE status = 'pending';

-- Update test merchant with webhook_secret
UPDATE merchants SET webhook_secret = 'whsec_test_abc123' WHERE email = 'test@example.com';
