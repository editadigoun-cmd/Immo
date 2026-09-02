-- Migration v2: monthly payment periods + user accounts (login)
-- Run this once in the Cloudflare dashboard's D1 console for immo-loyers.
-- Safe to run even with existing tenants/payments rows.

ALTER TABLE payments ADD COLUMN period TEXT;
UPDATE payments SET period = substr(date, 1, 7) WHERE period IS NULL;
CREATE INDEX IF NOT EXISTS idx_payments_period ON payments(period);

CREATE TABLE IF NOT EXISTS users (
  email TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_email TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Compte initial : editadigoun@gmail.com / fanati09
-- (mot de passe stocké hashé, jamais en clair)
INSERT INTO users (email, password_hash) VALUES (
  'editadigoun@gmail.com',
  'pbkdf2$100000$HNj40yuXXWa8099cglHNmA==$MpIfRZVAwFDesAzR6Pclbqbji7TXgW2LaVmR8ZaQHWo='
);
