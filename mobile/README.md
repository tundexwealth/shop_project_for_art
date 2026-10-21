# Artini mobile

An Expo app for the Artini string art shop. It uses the same Supabase project and Next.js API as the website. Signed-in customers get one cart across both clients; guest carts stay on that device until sign-in.

## Configure local development

1. In the repository root, start the web/API server with `npm run dev`. Keep the computer and phone on the same Wi-Fi network. Next.js prints the computer's LAN address, for example `http://192.168.1.20:3000`.
2. Copy `mobile/.env.example` to `mobile/.env.local`. Set:
   - `EXPO_PUBLIC_SUPABASE_URL` to the same project URL used by the website.
   - `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` to the Supabase publishable/anon key. Never put the Supabase secret key in the mobile app.
   - `EXPO_PUBLIC_API_URL` to the computer's LAN URL from step 1, without a trailing slash.
3. In Supabase SQL Editor, run [`../supabase/cart-sync.sql`](../supabase/cart-sync.sql). This migration adds the shared cart table and enables Realtime updates. The website's existing checkout and API server need their current server environment variables as usual.
4. In Supabase Authentication → URL Configuration, add `artini://auth/callback` to the allowed redirect URLs. Keep the existing website URLs.
5. In Supabase Authentication → Providers → Google, keep the Google client credentials configured. In Google Cloud Console, the authorized redirect URI remains Supabase's callback URL (`https://<project-ref>.supabase.co/auth/v1/callback`); the native `artini://auth/callback` is a Supabase allowed redirect URL, not a Google redirect URI.
6. In a second terminal, run `cd mobile`, `npm install`, then `npx expo start`. Scan the QR code with Expo Go if available for this SDK, or build/install the native app using the steps below. Use the LAN address in `EXPO_PUBLIC_API_URL`; `localhost` on a phone points to the phone itself.

If the computer's LAN address changes, update `EXPO_PUBLIC_API_URL` and restart Expo. For a deployed website, set it to the HTTPS Vercel deployment URL instead.

## Installable Android app with launcher icon

The app config already defines the Artini icon and Android package identifier. EAS needs an Expo account and a one-time project association to sign a standalone APK:

1. From `mobile/`, run `npx eas-cli@latest login` and then `npx eas-cli@latest build:configure`. Commit the generated EAS project ID in `app.json`.
2. In Expo's project environment settings, add `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and `EXPO_PUBLIC_API_URL`. For a store-ready build, point the API URL at the deployed HTTPS Vercel site.
3. Run `npx eas-cli@latest build --platform android --profile preview`. When it completes, download the APK from the build link on the Android phone and install it. The Artini icon will appear in the phone's app launcher.

The `preview` profile is configured to produce an installable APK. iOS device installation requires Apple signing credentials; Android preview builds do not require Play Store publication.

## Shared cart behavior

The local cart is retained for guests. On Google sign-in, the app merges the guest cart into the signed-in account's cart and saves it through the same `/api/cart` endpoint used by the website. Supabase Realtime notifies the other client when that user's cart changes. If the SQL migration has not been applied or the API cannot be reached, the app reports that cart sync is unavailable and keeps the device cart locally.

Orders, workshop requests, and custom commission requests use the website's existing `/api/orders`, `/api/workshops`, and `/api/custom` endpoints. Order pricing is calculated by the server from Supabase products, as it is on the website.
