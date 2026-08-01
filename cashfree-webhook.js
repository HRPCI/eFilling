import { verifyWebhookSignature } from '../utils/cashfree.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  const rawBody = await request.text();
  const signature = request.headers.get('x-webhook-signature') || '';
  const timestamp = request.headers.get('x-webhook-timestamp') || '';

  const isValid = await verifyWebhookSignature(env, { timestamp, rawBody, signature });
  if (!isValid) {
    // Do not process anything from an unverified request.
    return new Response('Invalid signature', { status: 401 });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const eventType = payload.type; // e.g. 'PAYMENT_SUCCESS_WEBHOOK'
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

    // Optional: mark the lead as paid in KV so you can distinguish
    // paid vs abandoned applications later if you build a dashboard.
    if (env.LEADS_KV && lead) {
      lead.paid = true;
      lead.paidAt = new Date().toISOString();
      await env.LEADS_KV.put(`lead:${orderId}`, JSON.stringify(lead), {
        expirationTtl: 60 * 60 * 24 * 30,
      });
    }
  }

  // Always return 200 quickly so Cashfree doesn't retry unnecessarily.
  return new Response('OK', { status: 200 });
}

async function sendLeadEmail(env, orderId, paymentData, lead) {
  const paidAmount = paymentData?.payment?.payment_amount ?? lead?.amount ?? 'N/A';

  const rows = lead
    ? Object.entries(lead)
        .filter(([k]) => k !== 'paid' && k !== 'paidAt')
        .map(([k, v]) => `<tr><td style="padding:5px 12px;font-weight:600;border-bottom:1px solid #eee;">${escapeHtml(k)}</td><td style="padding:5px 12px;border-bottom:1px solid #eee;">${escapeHtml(String(v ?? ''))}</td></tr>`)
        .join('')
    : '<tr><td>No lead data found in KV (may have expired or KV not configured)</td></tr>';

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
