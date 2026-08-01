import { createCashfreeOrder, jsonResponse } from '../utils/cashfree.js';

// Server-side price list, keyed by "SERVICE:type" — NEVER trust an amount
// sent from the browser, or anyone could submit a fake low price.
const PRICES = {
  'PAN:New PAN Card': 507,
  'PAN:PAN Correction / Update': 507,
  // Add GST / Passport / Business Registration prices here as those forms are migrated:
  // 'GST:Proprietorship': 990,
  // 'PASSPORT:Fresh Passport (Normal)': 3000,
};

function generateOrderId(prefix) {
  const rand = crypto.randomUUID().split('-')[0];
  return `${prefix}-${Date.now()}-${rand}`;
}

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const body = await request.json();
    const { formType, name, phone, email, service, category, city, message } = body;

    if (!formType || !name || !phone || !service) {
      return jsonResponse({ success: false, error: 'Missing required fields' }, 400);
    }

    const priceKey = `${formType}:${service}`;
    const amount = PRICES[priceKey];
    if (!amount) {
      return jsonResponse({ success: false, error: 'Invalid service selected' }, 400);
    }

    const orderId = generateOrderId(formType);
    const origin = new URL(request.url).origin;

    const order = await createCashfreeOrder(env, {
      orderId,
      amount,
      customerName: name,
      customerPhone: phone,
      customerEmail: email,
      returnUrl: `${origin}/thank-you.html?service=${encodeURIComponent(formType)}&order_id=${orderId}`,
      notifyUrl: `${origin}/api/cashfree-webhook`,
    });

    // Stash the full lead details in KV, keyed by order_id, so the webhook
    // can email you the complete application once payment is confirmed.
    if (env.LEADS_KV) {
      await env.LEADS_KV.put(
        `lead:${orderId}`,
        JSON.stringify({
          formType, name, phone, email, service, category, city, message,
          amount, createdAt: new Date().toISOString(),
        }),
        { expirationTtl: 60 * 60 * 24 * 30 } // auto-expire after 30 days
      );
    }

    return jsonResponse({
      success: true,
      order_id: order.order_id,
      payment_session_id: order.payment_session_id,
    });
  } catch (err) {
    return jsonResponse({ success: false, error: err.message || 'Something went wrong' }, 500);
  }
}
