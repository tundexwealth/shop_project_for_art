import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) return NextResponse.json({ error: "Custom project enquiries are not connected yet. Add the Supabase settings to the environment." }, { status: 503 });
  try {
    const data = await request.json(); const email = String(data.customer_email || "").trim().toLowerCase();
    if (!String(data.customer_name || "").trim() || !/^\S+@\S+\.\S+$/.test(email) || !String(data.customer_phone || "").trim() || !String(data.details || "").trim() || !["personal", "brand", "space"].includes(data.project_type)) return NextResponse.json({ error: "Please check the required details and try again." }, { status: 400 });
    const { data: inquiry, error } = await createAdminClient().from("custom_inquiries").insert({ customer_name: String(data.customer_name).trim(), customer_email: email, customer_phone: String(data.customer_phone).trim(), project_type: data.project_type, organization: String(data.organization || "").trim() || null, needed_by: data.needed_by || null, details: String(data.details).trim() }).select("id").single();
    if (error) throw error;
    let emailSent = false;
    if (process.env.MAILGUN_API_KEY && process.env.MAILGUN_DOMAIN && process.env.MAILGUN_FROM) {
      const form = new FormData(); form.set("from", process.env.MAILGUN_FROM); form.set("to", email); form.set("subject", "Your Artini idea is here"); form.set("text", `Hello ${String(data.customer_name).trim()},\n\nThank you for sharing your idea with Artini. We've got your note and will be in touch soon to dream up a piece that feels like you.\n\nWith care,\nArtini`);
      if (process.env.STUDIO_INBOX) form.set("bcc", process.env.STUDIO_INBOX);
      const response = await fetch(`https://api.mailgun.net/v3/${process.env.MAILGUN_DOMAIN}/messages`, { method: "POST", headers: { Authorization: `Basic ${Buffer.from(`api:${process.env.MAILGUN_API_KEY}`).toString("base64")}` }, body: form }); emailSent = response.ok;
    }
    return NextResponse.json({ inquiryId: inquiry.id, emailSent }, { status: 201 });
  } catch (error) { console.error("Custom inquiry creation failed", error); return NextResponse.json({ error: "We couldn't save your note. Please try again or email the studio." }, { status: 500 }); }
}
