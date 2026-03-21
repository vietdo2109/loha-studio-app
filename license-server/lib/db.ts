import { sql } from '@vercel/postgres'

let schemaReady = false

export async function ensureSchema(): Promise<void> {
  if (schemaReady) return
  await sql`
    CREATE TABLE IF NOT EXISTS licenses (
      id TEXT PRIMARY KEY,
      key_hash TEXT UNIQUE NOT NULL,
      key_preview TEXT NOT NULL,
      key_phone_tag TEXT,
      role TEXT NOT NULL DEFAULT 'user',
      expires_at BIGINT NOT NULL,
      revoked BOOLEAN NOT NULL DEFAULT FALSE,
      created_at BIGINT NOT NULL,
      created_by TEXT,
      note TEXT,
      bound_device_id TEXT,
      activated_at BIGINT,
      activation_token TEXT UNIQUE,
      last_seen_at BIGINT
    );
  `
  await sql`ALTER TABLE licenses ADD COLUMN IF NOT EXISTS key_phone_tag TEXT;`
  // Per-key AI product access (admin-controlled). Existing rows get defaults on ADD COLUMN.
  await sql`ALTER TABLE licenses ADD COLUMN IF NOT EXISTS grok_active BOOLEAN NOT NULL DEFAULT TRUE;`
  await sql`ALTER TABLE licenses ADD COLUMN IF NOT EXISTS veo_active BOOLEAN NOT NULL DEFAULT TRUE;`
  await sql`ALTER TABLE licenses ADD COLUMN IF NOT EXISTS sora_active BOOLEAN NOT NULL DEFAULT FALSE;`
  await sql`CREATE INDEX IF NOT EXISTS idx_licenses_created_at ON licenses (created_at DESC);`
  await sql`CREATE INDEX IF NOT EXISTS idx_licenses_key_phone_tag ON licenses (key_phone_tag);`
  schemaReady = true
}
