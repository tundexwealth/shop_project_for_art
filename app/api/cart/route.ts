import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

type CartEntry = { id: string; quantity: number };

function readToken(request: NextRequest) {
  const authorization = request.headers.get("authorization");
  return authorization?.startsWith("Bearer ") ? authorization.slice(7) : null;
}

async function getUserId(request: NextRequest) {
  const token = readToken(request);
  if (!token) return null;
  const { data, error } = await createAdminClient().auth.getUser(token);
  return error ? null : data.user?.id || null;
}

async function hydrateCart(items: CartEntry[]) {
  if (!items.length) return [];
  const { data, error } = await createAdminClient()
    .from("products")
    .select("id,name,category,description,price,image_url,kind,featured")
    .in("id", items.map(item => item.id))
    .eq("active", true);
  if (error) throw error;
  const products = new Map((data || []).map(product => [product.id, product]));
  return items.flatMap(item => {
    const product = products.get(item.id);
    return product ? [{ ...product, quantity: item.quantity }] : [];
  });
}

export async function GET(request: NextRequest) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) return NextResponse.json({ error: "Cart sync is not configured." }, { status: 503 });
  try {
    const userId = await getUserId(request);
    if (!userId) return NextResponse.json({ error: "Sign in to sync your cart." }, { status: 401 });
    const { data, error } = await createAdminClient().from("user_carts").select("items").eq("user_id", userId).maybeSingle();
    if (error) throw error;
    const entries = Array.isArray(data?.items) ? data.items as CartEntry[] : [];
    return NextResponse.json({ items: await hydrateCart(entries) });
  } catch (error) {
    console.error("Shared cart load failed", error);
    return NextResponse.json({ error: "We couldn't load your shared cart." }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) return NextResponse.json({ error: "Cart sync is not configured." }, { status: 503 });
  try {
    const userId = await getUserId(request);
    if (!userId) return NextResponse.json({ error: "Sign in to sync your cart." }, { status: 401 });
    const body = await request.json();
    if (!Array.isArray(body.items) || body.items.length > 30) return NextResponse.json({ error: "The cart is invalid." }, { status: 400 });
    const quantities = new Map<string, number>();
    for (const entry of body.items) {
      const id = typeof entry?.id === "string" ? entry.id : "";
      const quantity = Number(entry?.quantity);
      if (!id || !Number.isInteger(quantity) || quantity < 1 || quantity > 20) return NextResponse.json({ error: "The cart contains an invalid item or quantity." }, { status: 400 });
      const total = (quantities.get(id) || 0) + quantity;
      if (total > 20) return NextResponse.json({ error: "An item quantity cannot exceed 20." }, { status: 400 });
      quantities.set(id, total);
    }
    const items = [...quantities].map(([id, quantity]) => ({ id, quantity }));
    const { error } = await createAdminClient().from("user_carts").upsert({ user_id: userId, items, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    if (error) throw error;
    return NextResponse.json({ items: await hydrateCart(items) });
  } catch (error) {
    console.error("Shared cart save failed", error);
    return NextResponse.json({ error: "We couldn't save your shared cart." }, { status: 500 });
  }
}
