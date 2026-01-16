-- Create Idempotency Keys Table
CREATE TABLE IF NOT EXISTS idempotency_keys (
    key VARCHAR(255) NOT NULL,
    merchant_id UUID NOT NULL,
    response JSONB NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    PRIMARY KEY (key, merchant_id),
    FOREIGN KEY (merchant_id) REFERENCES merchants(id)
);

-- Create index on expires_at for cleanup queries
CREATE INDEX IF NOT EXISTS idx_idempotency_keys_expires_at ON idempotency_keys(expires_at);

-- Add webhook_secret column to merchants table
ALTER TABLE IF EXISTS merchants ADD COLUMN IF NOT EXISTS webhook_secret VARCHAR(64);
ALTER TABLE IF EXISTS merchants ADD COLUMN IF NOT EXISTS webhook_url VARCHAR(255);
