import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url); const code = searchParams.get("code");
  const requestedNext = searchParams.get("next") || "/";
  const next = requestedNext.startsWith("/") && !requestedNext.startsWith("//") ? requestedNext : "/";
  const providerError = searchParams.get("error_description") || searchParams.get("error");
  if (providerError) {
    console.error("Google sign-in returned an OAuth error:", providerError);
    return NextResponse.redirect(new URL("/?auth=error&stage=provider", origin));
  }
  if (!code || !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
    return NextResponse.redirect(new URL("/?auth=error&stage=callback", origin));
  }

  const response = NextResponse.redirect(new URL(next, origin));
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: cookies => cookies.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
    }
  });
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.session) {
    console.error("Supabase could not establish the Google sign-in session:", error?.message || "No session returned");
    response.headers.set("Location", new URL("/?auth=error&stage=exchange", origin).toString());
  }
  return response;
}
