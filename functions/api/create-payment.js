// /functions/api/create-payment.js
// Cloudflare Pages Function — runs automatically at:  https://e-filling.in/api/create-payment
//
// What it does:
//  1. Receives the PAN application form data from the browser (fetch POST, JSON)
//  2. Emails you the lead via FormSubmit's AJAX endpoint (same notification you have today)
//  3. Creates a Cashfree Payment Link with the customer's name/phone/email/amount
//     already attached, so the payment page is pre-filled — no retyping
//  4. Returns { link_url } to the browser, which then redirects the customer there
//
// SETUP REQUIRED (Cloudflare Pages dashboard → your project → Settings → Environment variables):
//   CASHFREE_CLIENT_ID      = your Cashfree App ID
//   CASHFREE_CLIENT_SECRET  = your Cashfree Secret Key
//   CASHFREE_ENV            = "production"  (use "sandbox" only while testing)
//   FORMSUBMIT_EMAIL        = contact@e-filling.in
//
// Never put CASHFREE_CLIENT_SECRET in any frontend/HTML/JS file — it must only
// ever live in these server-side environment variables.

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const data = await request.json();

    // ---- 1. Basic validation ----
    const { name, phone, email, service_type, applying_as, dob, city, notes } = data;
    if (!name || !phone) {
      return json({ error: "Name and phone number are required." }, 400);
    }

    // ---- 2. Determine price from service type (matches your site copy) ----
    const isCorrection = (service_type || "").toLowerCase().includes("correction");
    const amount = 507; // both New PAN and Correction are ₹507 all-inclusive per your pricing

    // ---- 3. Email the lead via FormSubmit AJAX (non-blocking best effort) ----
    const formsubmitEmail = env.FORMSUBMIT_EMAIL || "contact@e-filling.in";
    try {
      await fetch(`https://formsubmit.co/ajax/${formsubmitEmail}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          _subject: `New PAN Application – ${name}`,
          Name: name,
          Phone: phone,
          Email: email || "-",
          "Service Type": service_type || "-",
          "Applying As": applying_as || "-",
          DOB: dob || "-",
          "City/State": city || "-",
          Notes: notes || "-",
        }),
      });
    } catch (e) {
      // Don't block payment link creation if the email step hiccups —
      // you still get the Cashfree order in your dashboard either way.
      console.error("FormSubmit notify failed:", e);
    }

    // ---- 4. Create a pre-filled Cashfree Payment Link ----
    const isSandbox = (env.CASHFREE_ENV || "production") === "sandbox";
    const cashfreeBase = isSandbox
      ? "https://sandbox.cashfree.com/pg/links"
      : "https://api.cashfree.com/pg/links";

    const linkId = `pan-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const cleanPhone = String(phone).replace(/\D/g, "").slice(-10); // last 10 digits

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
        link_purpose: isCorrection ? "PAN Correction/Update" : "New PAN Application",
        customer_details: {
          customer_name: name,
          customer_phone: cleanPhone,
          customer_email: email || undefined,
        },
        link_notify: { send_sms: true, send_email: !!email },
        link_auto_reminders: true,
        link_notes: {
          service_type: service_type || "",
          applying_as: applying_as || "",
          city: city || "",
        },
        // Send them back to a thank-you page on your site after payment
        link_meta: {
          return_url: "https://e-filling.in/thank-you.html?order={order_id}",
        },
      }),
    });

    const cfData = await cfResponse.json();

    if (!cfResponse.ok || !cfData.link_url) {
      console.error("Cashfree error:", cfData);
      return json({ error: "Could not create payment link.", details: cfData }, 502);
    }

    return json({ link_url: cfData.link_url });
  } catch (err) {
    console.error("create-payment error:", err);
    return json({ error: "Server error, please try again." }, 500);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
