import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { env } from '@/config/env';
import { supabaseAdmin } from '@/services/database/supabase';
import logger from '@/utils/logger';
import type { OAuthTokens } from '@/types/connections';

interface EncryptedEnvelope {
  iv: string;
  tag: string;
  ciphertext: string;
}

function getKey(): Buffer {
  const hex = env.PLATFORM_CONNECTIONS_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('PLATFORM_CONNECTIONS_ENCRYPTION_KEY must be set to a 64-char hex string in production');
    }
    logger.warn('PLATFORM_CONNECTIONS_ENCRYPTION_KEY not set — using dev zero-key (unsafe for production)');
    return Buffer.alloc(32, 0);
  }
  return Buffer.from(hex, 'hex');
}

export function encryptTokens(tokens: OAuthTokens): string {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);

  const plaintext = JSON.stringify(tokens);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  const envelope: EncryptedEnvelope = {
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
    ciphertext: ciphertext.toString('hex'),
  };
  return JSON.stringify(envelope);
}

export function decryptTokens(encrypted: string): OAuthTokens {
  const key = getKey();
  const envelope = JSON.parse(encrypted) as EncryptedEnvelope;

  const iv = Buffer.from(envelope.iv, 'hex');
  const tag = Buffer.from(envelope.tag, 'hex');
  const ciphertext = Buffer.from(envelope.ciphertext, 'hex');

  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);

  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString('utf8');

  return JSON.parse(plaintext) as OAuthTokens;
}

// Resolves live tokens for any connection type.
// For child rows: fetches and decrypts the parent manager row's tokens.
// For manager/standalone: decrypts own tokens.
// Never returns the raw encrypted blob.
export async function resolveTokens(connectionId: string): Promise<OAuthTokens> {
  const { data: conn, error } = await supabaseAdmin
    .from('platform_connections')
    .select('id, connection_type, parent_connection_id, oauth_tokens')
    .eq('id', connectionId)
    .maybeSingle();

  if (error) throw new Error(`resolveTokens: DB error: ${error.message}`);
  if (!conn) throw new Error(`resolveTokens: connection ${connectionId} not found`);

  if (conn.connection_type === 'child') {
    if (!conn.parent_connection_id) {
      throw new Error(`resolveTokens: child connection ${connectionId} has no parent`);
    }
    const { data: parent, error: parentError } = await supabaseAdmin
      .from('platform_connections')
      .select('oauth_tokens, status')
      .eq('id', conn.parent_connection_id)
      .maybeSingle();

    if (parentError) throw new Error(`resolveTokens: parent DB error: ${parentError.message}`);
    if (!parent) throw new Error(`resolveTokens: parent connection ${conn.parent_connection_id} not found`);
    if (!parent.oauth_tokens) throw new Error(`resolveTokens: parent connection has no tokens`);
    if (parent.status === 'expired') throw new Error(`resolveTokens: parent connection token is expired`);

    return decryptTokens(parent.oauth_tokens as string);
  }

  if (!conn.oauth_tokens) throw new Error(`resolveTokens: connection ${connectionId} has no tokens`);
  return decryptTokens(conn.oauth_tokens as string);
}

// Refreshes a Google OAuth access token using the stored refresh token.
// Persists the new encrypted tokens and updated expiry to the DB.
export async function refreshGoogleToken(connectionId: string): Promise<OAuthTokens> {
  const current = await resolveTokens(connectionId);

  if (!current.refresh_token) {
    throw new Error(`refreshGoogleToken: no refresh token on connection ${connectionId}`);
  }

  const params = new URLSearchParams({
    client_id: env.GOOGLE_OAUTH_CLIENT_ID,
    client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
    grant_type: 'refresh_token',
    refresh_token: current.refresh_token,
  });

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  if (!response.ok) {
    const body = await response.text();
    await markExpired(connectionId, 'Token refresh failed');
    throw new Error(`refreshGoogleToken: refresh failed (${response.status}): ${body}`);
  }

  const json = await response.json() as {
    access_token: string;
    expires_in: number;
    token_type: string;
    scope?: string;
  };

  const refreshed: OAuthTokens = {
    access_token: json.access_token,
    refresh_token: current.refresh_token,
    expires_at: Date.now() + json.expires_in * 1000,
    token_type: json.token_type,
    scope: json.scope ?? current.scope,
  };

  await persistTokens(connectionId, refreshed);
  return refreshed;
}

// Proactively refreshes a Meta long-lived token at day 50.
// Meta tokens expire at 60 days; call this on connections where
// expires_at is within 10 days.
export async function refreshMetaToken(connectionId: string): Promise<OAuthTokens> {
  const current = await resolveTokens(connectionId);

  const response = await fetch(
    `https://graph.facebook.com/oauth/access_token?` +
    `grant_type=fb_exchange_token&` +
    `client_id=${encodeURIComponent(env.META_APP_ID)}&` +
    `client_secret=${encodeURIComponent(env.META_APP_SECRET)}&` +
    `fb_exchange_token=${encodeURIComponent(current.access_token)}`,
  );

  if (!response.ok) {
    const body = await response.text();
    await markExpired(connectionId, 'Meta token refresh failed');
    throw new Error(`refreshMetaToken: refresh failed (${response.status}): ${body}`);
  }

  const json = await response.json() as {
    access_token: string;
    token_type: string;
    expires_in?: number;
  };

  const refreshed: OAuthTokens = {
    access_token: json.access_token,
    expires_at: Date.now() + (json.expires_in ?? 60 * 24 * 60 * 60) * 1000,
    token_type: json.token_type,
  };

  await persistTokens(connectionId, refreshed);
  return refreshed;
}

async function persistTokens(connectionId: string, tokens: OAuthTokens): Promise<void> {
  const { error } = await supabaseAdmin
    .from('platform_connections')
    .update({
      oauth_tokens: encryptTokens(tokens),
      status: 'active',
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', connectionId);

  if (error) throw new Error(`persistTokens: DB error: ${error.message}`);
}

export async function markExpired(connectionId: string, reason: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('platform_connections')
    .update({
      status: 'expired',
      last_error: reason,
      updated_at: new Date().toISOString(),
    })
    .eq('id', connectionId);

  if (error) logger.error({ connectionId, reason }, 'markExpired: DB update failed');
}
