// Shopify install provisioning — the find-or-create flow that turns an
// OAuth callback into a fully-usable Atlas org.
//
// Creating the shadow auth.users row (step below) automatically triggers
// handle_new_user() (20260702_001_fix_profiles_organization_id.sql), which
// creates the organisations + profiles + organisation_members rows for us.
// This function only needs to: create the shadow user, then adjust the
// auto-created org/profile to fit a Shopify-provisioned account (plan,
// org_type, name) and create the client + platform_connections row.

import { supabaseAdmin } from '@/services/database/supabase';
import { encryptTokens } from '@/services/connections/tokenManager';
import { createClient } from '@/services/database/clientQueries';
import { getShopInfo, registerAllWebhooks } from './shopifyClient';
import { sendShopifyWelcomeEmail } from '@/services/email/emailService';
import { env } from '@/config/env';
import logger from '@/utils/logger';
import type { OAuthTokens } from '@/types/connections';

// Shopify offline access tokens don't expire on a fixed schedule (valid
// until the merchant uninstalls the app) — unlike Google/Meta there's no
// refresh flow. OAuthTokens.expires_at is required by the shared type, so
// this is a far-future sentinel meaning "does not expire on a schedule";
// tokenManager's resolveTokens()/refresh helpers are never called for a
// shopify connection_type='standalone' row (nothing refreshes it).
const NON_EXPIRING_SENTINEL_MS = Date.now() + 100 * 365 * 24 * 60 * 60 * 1000;

export interface ShopifyProvisioningResult {
  organisationId: string;
  clientId: string;
  connectionId: string;
  shadowUserId: string;
  isNewInstall: boolean;
}

async function findExistingConnection(shop: string): Promise<{ id: string; organization_id: string; client_id: string } | null> {
  const { data } = await supabaseAdmin
    .from('platform_connections')
    .select('id, organization_id, client_id')
    .eq('platform', 'shopify')
    .eq('account_id', shop)
    .maybeSingle();
  return data as { id: string; organization_id: string; client_id: string } | null;
}

async function createShadowUser(email: string): Promise<string> {
  // generateLink({type:'invite'}) creates the (unconfirmed) user as a side
  // effect and returns a signed link the merchant can use to set their own
  // password — same admin-API pattern already used for signup/recovery in
  // api/routes/auth.ts. This IS the "claim your account" step: no separate
  // "enter your email" flow needed since the merchant's real email comes
  // straight from the Shopify shop resource.
  const { data, error } = await supabaseAdmin.auth.admin.generateLink({
    type: 'invite',
    email,
    options: {
      redirectTo: `${env.FRONTEND_URL}/login`,
    },
  });

  if (error || !data?.user?.id) {
    throw new Error(`Shopify provisioning: failed to create shadow user: ${error?.message ?? 'no user returned'}`);
  }

  const actionLink = data.properties?.action_link;
  if (actionLink) {
    const result = await sendShopifyWelcomeEmail({ to: email, claimUrl: actionLink });
    if (!result.ok) {
      logger.error({ email, error: result.error }, 'Shopify provisioning: welcome email failed to send');
    }
  } else {
    logger.error({ email }, 'Shopify provisioning: no action_link returned from generateLink');
  }

  return data.user.id;
}

async function provisionNewOrgForShadowUser(shadowUserId: string, shopName: string, storefrontDomain: string): Promise<{ organisationId: string; clientId: string }> {
  // handle_new_user() already created organisations/profiles/organisation_members
  // synchronously as part of the auth.users insert above. Read back the org id.
  const { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('organization_id')
    .eq('id', shadowUserId)
    .single();

  if (profileError || !(profile as { organization_id: string | null })?.organization_id) {
    throw new Error(`Shopify provisioning: shadow user's profile has no organization_id after creation: ${profileError?.message ?? 'null'}`);
  }
  const organisationId = (profile as { organization_id: string }).organization_id;

  // Mark this as a channel-attributed grant (pro-level access, no Stripe
  // subscription) and adjust the auto-created org to fit a single-shop brand.
  await Promise.all([
    supabaseAdmin
      .from('profiles')
      .update({ plan: 'pro', provisioning_source: 'shopify_app' })
      .eq('id', shadowUserId),
    supabaseAdmin
      .from('organisations')
      .update({ name: shopName, org_type: 'brand' })
      .eq('id', organisationId),
  ]);

  const client = await createClient(organisationId, {
    name: shopName,
    website_url: `https://${storefrontDomain}`,
    business_type: 'ecommerce',
    detected_platform: 'shopify',
  });

  await supabaseAdmin
    .from('organisations')
    .update({ primary_client_id: client.id })
    .eq('id', organisationId);

  return { organisationId, clientId: client.id };
}

export async function provisionShopifyInstall(shop: string, accessToken: string, scope: string): Promise<ShopifyProvisioningResult> {
  const existing = await findExistingConnection(shop);

  const shopInfo = await getShopInfo(shop, accessToken);

  const tokens: OAuthTokens = {
    access_token: accessToken,
    expires_at: NON_EXPIRING_SENTINEL_MS,
    token_type: 'shopify_offline',
    scope,
  };

  if (existing) {
    // Reinstall: Shopify clears webhook subscriptions on uninstall, so
    // these always need re-registering regardless of what the previous
    // metadata held.
    const webhookIds = await registerAllWebhooks(shop, accessToken, env.BACKEND_URL);

    await supabaseAdmin
      .from('platform_connections')
      .update({
        oauth_tokens: encryptTokens(tokens),
        status: 'active',
        last_error: null,
        account_label: shopInfo.name,
        metadata: { shop_domain: shop, scopes: scope, webhook_ids: webhookIds, storefront_domain: shopInfo.domain },
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id);

    logger.info({ shop, connectionId: existing.id }, 'Shopify: reinstall — connection reactivated');

    return {
      organisationId: existing.organization_id,
      clientId: existing.client_id,
      connectionId: existing.id,
      shadowUserId: existing.organization_id,
      isNewInstall: false,
    };
  }

  const shadowUserId = await createShadowUser(shopInfo.email);
  const { organisationId, clientId } = await provisionNewOrgForShadowUser(shadowUserId, shopInfo.name, shopInfo.domain);

  const webhookIds = await registerAllWebhooks(shop, accessToken, env.BACKEND_URL);

  const { data: connection, error: connectionError } = await supabaseAdmin
    .from('platform_connections')
    .insert({
      organization_id: shadowUserId,
      client_id: clientId,
      platform: 'shopify',
      connection_type: 'standalone',
      account_id: shop,
      account_label: shopInfo.name,
      oauth_tokens: encryptTokens(tokens),
      status: 'active',
      metadata: { shop_domain: shop, scopes: scope, webhook_ids: webhookIds, storefront_domain: shopInfo.domain },
    })
    .select('id')
    .single();

  if (connectionError || !connection) {
    throw new Error(`Shopify provisioning: failed to create platform_connections row: ${connectionError?.message ?? 'unknown'}`);
  }

  logger.info({ shop, organisationId, clientId, shadowUserId }, 'Shopify: new install provisioned');

  return {
    organisationId,
    clientId,
    connectionId: (connection as { id: string }).id,
    shadowUserId,
    isNewInstall: true,
  };
}
