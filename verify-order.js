import { getCashfreeOrder, jsonResponse } from '../utils/cashfree.js';

export async function onRequestGet(context) {
  const { request, env } = context;
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
      order_status: order.order_status, // 'ACTIVE' | 'PAID' | 'EXPIRED' | 'TERMINATED'
      order_amount: order.order_amount,
    });
  } catch (err) {
    return jsonResponse({ success: false, error: err.message }, 500);
  }
}
