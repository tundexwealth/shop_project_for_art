# Artini

A responsive storefront for a handmade string art studio, with product checkout, order storage, Google sign-in, and Mailgun confirmation emails.

## Run locally

1. Install Node.js 20+ and run `npm install`.
2. Copy `.env.example` to `.env.local` and fill in the Supabase values.
3. In the Supabase SQL editor, run [`supabase/schema.sql`](supabase/schema.sql).
4. In Supabase Authentication → Providers, enable Google. In Google Cloud Console, create a Web OAuth client and add the Supabase callback URL shown in provider settings as an authorized redirect URI. Add your local and production site URLs to Supabase's allowed redirect URLs.
5. Set up a verified Mailgun sending domain and provide its API key, domain, sender address, and studio inbox in `.env.local`.
6. Run `npm run dev` and open http://localhost:3000.

`SUPABASE_SECRET_KEY` and `MAILGUN_API_KEY` are server-only secrets. Never prefix them with `NEXT_PUBLIC_` or commit `.env.local`. If Mailgun is not configured, orders are still saved and the checkout tells the customer the studio will follow up.

## What's connected

- Products are read from Supabase; the SQL file seeds three sample pieces.
- Checkout recalculates prices from Supabase, saves the order and its line items, and optionally associates a signed-in Google customer.
- Google OAuth uses Supabase Auth. Google Cloud credentials belong in Supabase's Google provider settings.
- Order confirmation emails are sent through the Mailgun Messages API.
- Workshop and custom commission requests are stored in Supabase and acknowledged through Mailgun when configured.

## Before launch

This checkout records an order request and confirms payment instructions personally by email; it does not collect online card payments. Add a payment provider and verify your Mailgun domain before accepting live orders.
