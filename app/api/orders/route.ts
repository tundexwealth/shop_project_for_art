import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const env = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SECRET_KEY"].filter((key) => !process.env[key]);
  if (env.length) return NextResponse.json({ error: "Checkout is not connected yet. Add the Supabase project settings to the environment." }, { status: 503 });
  try {
    const body = await request.json(); const { customer, items } = body;
    if (!customer?.name?.trim() || !/^\S+@\S+\.\S+$/.test(customer?.email || "") || !customer?.phone?.trim() || !customer?.address?.trim()) return NextResponse.json({ error: "Please complete all your contact and delivery details." }, { status: 400 });
    if (!Array.isArray(items) || items.length === 0 || items.length > 30) return NextResponse.json({ error: "Your bag is empty or has too many items." }, { status: 400 });
    const normalized = items.map((item: { id?: string; quantity?: number }) => ({ id: String(item.id || ""), quantity: Number(item.quantity) }));
    if (normalized.some(item => !item.id || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 20)) return NextResponse.json({ error: "One or more quantities are invalid." }, { status: 400 });
    const supabase = createAdminClient();
    let userId: string | null = null;
    const auth = request.headers.get("authorization");
    if (auth?.startsWith("Bearer ")) { const { data } = await supabase.auth.getUser(auth.slice(7)); userId = data.user?.id || null; }
    const ids = [...new Set(normalized.map(item => item.id))];
    const { data: products, error: productsError } = await supabase.from("products").select("id,name,price,active").in("id", ids);
    if (productsError) throw productsError;
    if (!products || products.length !== ids.length || products.some(p => !p.active)) return NextResponse.json({ error: "A piece in your bag is no longer available. Refresh the collection and try again." }, { status: 400 });
    const lookup = new Map(products.map(p => [p.id, p]));
    const total = normalized.reduce((sum, item) => sum + Number(lookup.get(item.id)!.price) * item.quantity, 0);
    if (!Number.isSafeInteger(total) || total <= 0) return NextResponse.json({ error: "We couldn't calculate this order." }, { status: 400 });
    const { data: order, error: orderError } = await supabase.from("orders").insert({ customer_id: userId, customer_name: customer.name.trim(), customer_email: customer.email.trim().toLowerCase(), customer_phone: customer.phone.trim(), delivery_address: customer.address.trim(), status: "pending", total, currency: "NGN" }).select("id").single();
    if (orderError) throw orderError;
    const lines = normalized.map(item => { const p = lookup.get(item.id)!; return { order_id: order.id, product_id: p.id, product_name: p.name, unit_price: Number(p.price), quantity: item.quantity }; });
    const { error: linesError } = await supabase.from("order_items").insert(lines);
    if (linesError) { await supabase.from("orders").delete().eq("id", order.id); throw linesError; }
    let emailSent = false;
    if (process.env.MAILGUN_API_KEY && process.env.MAILGUN_DOMAIN && process.env.MAILGUN_FROM) {
      const messageLines = lines.map(line => `• ${line.product_name} × ${line.quantity} — ${new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 }).format(line.unit_price * line.quantity)}`).join("\n");
      const form = new FormData(); form.set("from", process.env.MAILGUN_FROM); form.set("to", customer.email.trim()); form.set("subject", `Artini order — ${order.id.slice(0, 8)}`); form.set("text", `Hello ${customer.name.trim()},\n\nThank you for choosing Artini. Your order is in our hands.\n\n${messageLines}\n\nOrder total: ${new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 }).format(total)}\n\nWe’ll be in touch about payment and delivery.\n\nWith care,\nArtini`);
      if (process.env.STUDIO_INBOX) form.set("bcc", process.env.STUDIO_INBOX);
      const mailgunBaseUrl = (process.env.MAILGUN_BASE_URL || "https://api.mailgun.net").replace(/\/+$/, "");
      try {
        const result = await fetch(`${mailgunBaseUrl}/v3/${process.env.MAILGUN_DOMAIN}/messages`, { method: "POST", headers: { Authorization: `Basic ${Buffer.from(`api:${process.env.MAILGUN_API_KEY}`).toString("base64")}` }, body: form });
        emailSent = result.ok;
        const responseText = await result.text();
        let providerResponse: { id?: string; message?: string } = {};
        try { providerResponse = JSON.parse(responseText); } catch {}
        if (result.ok) console.info("Mailgun accepted the order confirmation", { status: result.status, messageId: providerResponse.id || "not provided" });
        else console.error("Mailgun rejected the order confirmation", { status: result.status, message: providerResponse.message || responseText.slice(0, 400) });
      } catch (mailgunError) {
        console.error("Mailgun request failed for order confirmation", mailgunError instanceof Error ? mailgunError.message : "Unknown error");
      }
    } else console.warn("Skipping order confirmation email: Mailgun settings are incomplete", { apiKeyConfigured: Boolean(process.env.MAILGUN_API_KEY), domainConfigured: Boolean(process.env.MAILGUN_DOMAIN), fromConfigured: Boolean(process.env.MAILGUN_FROM) });
    return NextResponse.json({ orderId: order.id, emailSent }, { status: 201 });
  } catch (error) { console.error("Order creation failed", error); return NextResponse.json({ error: "We couldn't save your order right now. Please try again or email the studio." }, { status: 500 }); }
}
