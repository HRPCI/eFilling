// ═══════════════════════════════════════════════════════
// Shared Cashfree Payment Gateway helpers for Cloudflare Pages Functions
// Docs: https://docs.cashfree.com/reference/pg-new-apis-endpoint
//
// IMPORTANT: Check docs.cashfree.com for the current x-api-version string
// before going live — Cashfree periodically releases new dated API versions.
// ═══════════════════════════════════════════════════════

const API_VERSION = '2023-08-01';

function getBaseUrl(env) {
  const mode = (env.CASHFREE_ENV || 'sandbox').toLowerCase();
  return mode === 'production'
    ? 'https://api.cashfree.com/pg'
    : 'https://sandbox.cashfree.com/pg';
}

function cashfreeHeaders(env) {
  return {
    'Content-Type': 'application/json',
    'x-api-version': API_VERSION,
    'x-client-id': env.CASHFREE_CLIENT_ID,
    'x-client-secret': env.CASHFREE_CLIENT_SECRET,
  };
}

/**
 * Creates an order in Cashfree and returns the payment_session_id
 * needed to open the JS SDK checkout on the frontend.
 */
export async function createCashfreeOrder(env, { orderId, amount, customerName, customerPhone, customerEmail, returnUrl, notifyUrl }) {
  const baseUrl = getBaseUrl(env);

  const body = {
    order_id: orderId,
    order_amount: amount,
    order_currency: 'INR',
    customer_details: {
      customer_id: orderId,
      customer_name: customerName || 'Applicant',
      customer_email: customerEmail && customerEmail.trim() ? customerEmail : 'noemail@e-filling.in',
      customer_phone: customerPhone,
    },
    order_meta: {
      return_url: returnUrl,
      notify_url: notifyUrl,
    },
  };

  const res = await fetch(`${baseUrl}/orders`, {
    method: 'POST',
    headers: cashfreeHeaders(env),
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || `Cashfree order creation failed (${res.status})`);
  }
  return data; // { order_id, payment_session_id, order_status, ... }
}

/**
 * Fetches the current status of an order directly from Cashfree.
 * Used by verify-order.js so the thank-you page never has to "just trust" a redirect.
 */
export async function getCashfreeOrder(env, orderId) {
  const baseUrl = getBaseUrl(env);

  const res = await fetch(`${baseUrl}/orders/${encodeURIComponent(orderId)}`, {
    method: 'GET',
    headers: cashfreeHeaders(env),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || `Failed to fetch order status (${res.status})`);
  }
  return data; // { order_id, order_status: 'ACTIVE'|'PAID'|'EXPIRED', order_amount, ... }
}

/**
 * Verifies the x-webhook-signature header Cashfree sends with every webhook call.
 * Scheme: signature = base64( HMAC_SHA256( client_secret, timestamp + rawBody ) )
 * Never trust a webhook payload without checking this first.
 */
export async function verifyWebhookSignature(env, { timestamp, rawBody, signature }) {
  if (!timestamp || !rawBody || !signature) return false;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(env.CASHFREE_CLIENT_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signedPayload = timestamp + rawBody;
  const sigBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(signedPayload));
  const computedSignature = btoa(String.fromCharCode(...new Uint8Array(sigBuffer)));

  return computedSignature === signature;
}

export function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
