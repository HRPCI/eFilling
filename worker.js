import {
  createCashfreeOrder,
  getCashfreeOrder,
  verifyWebhookSignature,
  jsonResponse,
} from './functions/utils/cashfree.js';

// Server-side price list — never trust an amount sent from the browser.
const PRICES = {
  'PAN:New PAN Card': 507,
  'PAN:PAN Correction / Update': 507,
  // Add GST / Passport / Business Registration prices here as those forms migrate to this flow:
  // 'GST:Proprietorship': 990,
  // 'PASSPORT:Fresh Passport (Normal)': 3000,
};

function generateOrderId(prefix) {
  const rand = crypto.randomUUID().split('-')[0];
  return `${prefix}-${Date.now()}-${rand}`;
}

async function handleCreateOrder(request, env) {
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

    if (env.LEADS_KV) {
      await env.LEADS_KV.put(
        `lead:${orderId}`,
        JSON.stringify({
          formType, name, phone, email, service, category, city, message,
          amount, createdAt: new Date().toISOString(),
        }),
        { expirationTtl: 60 * 60 * 24 * 30 }
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

async function handleVerifyOrder(request, env) {
  const url = new URL(request.url);
  const orderId = url.searchParams.get('order_id');

  if (!orderId) {
    return jsonResponse({ success: false, error: 'Missing order_id' }, 400);
  }

  try {
    const order = await getCashfreeOrder(env, orderId);
    return jsonResponse({
      success: true,
      order_id: order.order_id,
      order_status: order.order_status,
      order_amount: order.order_amount,
    });
  } catch (err) {
    return jsonResponse({ success: false, error: err.message }, 500);
  }
}

async function handleWebhook(request, env) {
  const rawBody = await request.text();
  const signature = request.headers.get('x-webhook-signature') || '';
  const timestamp = request.headers.get('x-webhook-timestamp') || '';

  const isValid = await verifyWebhookSignature(env, { timestamp, rawBody, signature });
  if (!isValid) {
    return new Response('Invalid signature', { status: 401 });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const eventType = payload.type;
  const orderId = payload.data?.order?.order_id;

  if (eventType === 'PAYMENT_SUCCESS_WEBHOOK' && orderId) {
    let lead = null;
    if (env.LEADS_KV) {
      const stored = await env.LEADS_KV.get(`lead:${orderId}`);
      if (stored) lead = JSON.parse(stored);
    }

    if (env.RESEND_API_KEY) {
      await sendLeadEmail(env, orderId, payload.data, lead);
    }

    if (env.LEADS_KV && lead) {
      lead.paid = true;
      lead.paidAt = new Date().toISOString();
      await env.LEADS_KV.put(`lead:${orderId}`, JSON.stringify(lead), {
        expirationTtl: 60 * 60 * 24 * 30,
      });
    }
  }

  return new Response('OK', { status: 200 });
}

async function sendLeadEmail(env, orderId, paymentData, lead) {
  const paidAmount = paymentData?.payment?.payment_amount ?? lead?.amount ?? 'N/A';

  const rows = lead
    ? Object.entries(lead)
        .filter(([k]) => k !== 'paid' && k !== 'paidAt')
        .map(([k, v]) => `<tr><td style="padding:5px 12px;font-weight:600;border-bottom:1px solid #eee;">${escapeHtml(k)}</td><td style="padding:5px 12px;border-bottom:1px solid #eee;">${escapeHtml(String(v ?? ''))}</td></tr>`)
        .join('')
    : '<tr><td>No lead data found in KV</td></tr>';

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;">
      <h2 style="color:#0a2342;">✅ Payment Received — Order ${escapeHtml(orderId)}</h2>
      <p><strong>Amount Paid:</strong> ₹${escapeHtml(String(paidAmount))}</p>
      <table style="border-collapse:collapse;width:100%;">${rows}</table>
    </div>
  `;

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'e-filling.in <notifications@e-filling.in>',
      to: ['contact@e-filling.in'],
      subject: `✅ Payment Received - ${lead?.formType || 'Order'} ${orderId}`,
      html,
    }),
  });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/create-order' && request.method === 'POST') {
      return handleCreateOrder(request, env);
    }
    if (url.pathname === '/api/verify-order' && request.method === 'GET') {
      return handleVerifyOrder(request, env);
    }
    if (url.pathname === '/api/cashfree-webhook' && request.method === 'POST') {
      return handleWebhook(request, env);
    }

    // Everything else — serve the static site (your existing HTML/CSS/JS files).
    return env.ASSETS.fetch(request);
  },
};
