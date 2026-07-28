// ---- 4. Create a pre-filled Cashfree Payment Link ----
const isSandbox = (env.CASHFREE_ENV || "production").toLowerCase() === "sandbox";

const cashfreeBase = isSandbox
  ? "https://sandbox.cashfree.com/pg/links"
  : "https://api.cashfree.com/pg/links";

const linkId = `pan-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
const cleanPhone = String(phone).replace(/\D/g, "").slice(-10);

console.log("Cashfree Environment:", env.CASHFREE_ENV);
console.log("Client ID:", env.CASHFREE_CLIENT_ID);

const cfResponse = await fetch(cashfreeBase, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-api-version": "2023-08-01",
    "x-client-id": env.CASHFREE_CLIENT_ID,
    "x-client-secret": env.CASHFREE_CLIENT_SECRET,
  },
  body: JSON.stringify({
    link_id: linkId,
    link_amount: amount,
    link_currency: "INR",
    link_purpose: isCorrection
      ? "PAN Correction/Update"
      : "New PAN Application",
    customer_details: {
      customer_name: name,
      customer_phone: cleanPhone,
      customer_email: email || undefined,
    },
    link_notify: {
      send_sms: true,
      send_email: !!email,
    },
    link_auto_reminders: true,
    link_meta: {
      return_url: "https://e-filling.in/thank-you.html?order={order_id}",
    },
  }),
});

const cfData = await cfResponse.json();

console.log("Cashfree Response:", cfData);

if (!cfResponse.ok) {
  return new Response(
    JSON.stringify({
      success: false,
      status: cfResponse.status,
      cashfree_error: cfData,
    }),
    {
      status: 500,
      headers: {
        "Content-Type": "application/json",
      },
    }
  );
}

return new Response(
  JSON.stringify({
    success: true,
    payment_url: cfData.link_url,
  }),
  {
    headers: {
      "Content-Type": "application/json",
    },
  }
);
