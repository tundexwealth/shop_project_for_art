import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) return NextResponse.json({ error: "Workshop enquiries are not connected yet. Add the Supabase settings to the environment." }, { status: 503 });
  try {
    const data = await request.json(); const guestCount = Number(data.guest_count);
    const email = String(data.customer_email || "").trim().toLowerCase();
    if (!String(data.customer_name || "").trim() || !/^\S+@\S+\.\S+$/.test(email) || !String(data.customer_phone || "").trim() || !Number.isInteger(guestCount) || guestCount < 1 || guestCount > 500 || !["company", "open-studio", "private-group"].includes(data.workshop_type)) return NextResponse.json({ error: "Please check the required details and try again." }, { status: 400 });
    const { data: inquiry, error } = await createAdminClient().from("workshop_inquiries").insert({ customer_name: String(data.customer_name).trim(), customer_email: email, customer_phone: String(data.customer_phone).trim(), organization: String(data.organization || "").trim() || null, guest_count: guestCount, preferred_date: data.preferred_date || null, workshop_type: data.workshop_type, notes: String(data.notes || "").trim() }).select("id").single();
    if (error) throw error;
    let emailSent = false;
    if (process.env.MAILGUN_API_KEY && process.env.MAILGUN_DOMAIN && process.env.MAILGUN_FROM) {
      const form = new FormData(); form.set("from", process.env.MAILGUN_FROM); form.set("to", email); form.set("subject", "Your Artini workshop note is here"); form.set("text", `Hello ${String(data.customer_name).trim()},\n\nThanks for thinking of Artini for your gathering. We've got your note and will be in touch to talk through a lovely workshop for your group.\n\nWith care,\nArtini`);
      if (process.env.STUDIO_INBOX) form.set("bcc", process.env.STUDIO_INBOX);
      const mailgunBaseUrl = (process.env.MAILGUN_BASE_URL || "https://api.mailgun.net").replace(/\/+$/, "");
      try {
        const response = await fetch(`${mailgunBaseUrl}/v3/${process.env.MAILGUN_DOMAIN}/messages`, { method: "POST", headers: { Authorization: `Basic ${Buffer.from(`api:${process.env.MAILGUN_API_KEY}`).toString("base64")}` }, body: form });
        emailSent = response.ok;
        const responseText = await response.text();
        let providerResponse: { id?: string; message?: string } = {};
        try { providerResponse = JSON.parse(responseText); } catch {}
        if (response.ok) console.info("Mailgun accepted the workshop confirmation", { status: response.status, messageId: providerResponse.id || "not provided" });
        else console.error("Mailgun rejected the workshop confirmation", { status: response.status, message: providerResponse.message || responseText.slice(0, 400) });
      } catch (mailgunError) {
        console.error("Mailgun request failed for workshop confirmation", mailgunError instanceof Error ? mailgunError.message : "Unknown error");
      }
    } else console.warn("Skipping workshop confirmation email: Mailgun settings are incomplete", { apiKeyConfigured: Boolean(process.env.MAILGUN_API_KEY), domainConfigured: Boolean(process.env.MAILGUN_DOMAIN), fromConfigured: Boolean(process.env.MAILGUN_FROM) });
    return NextResponse.json({ inquiryId: inquiry.id, emailSent }, { status: 201 });
  } catch (error) { console.error("Workshop inquiry creation failed", error); return NextResponse.json({ error: "We couldn't save your note. Please try again or email the studio." }, { status: 500 }); }
}
