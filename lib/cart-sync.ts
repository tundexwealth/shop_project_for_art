"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

export type CartItem = { id: string; quantity: number; name?: string; price?: number; image_url?: string; category?: string; description?: string };
const STORAGE_KEY = "artini-cart";

function readLocalCart(): CartItem[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter(item => typeof item?.id === "string" && Number.isInteger(item.quantity) && item.quantity > 0) : [];
  } catch { return []; }
}

function persistCart(items: CartItem[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

function mergeCart(local: CartItem[], remote: CartItem[]) {
  const merged = new Map<string, CartItem>();
  for (const item of [...remote, ...local]) {
    const existing = merged.get(item.id);
    merged.set(item.id, { ...existing, ...item, quantity: Math.min(20, (existing?.quantity || 0) + item.quantity) });
  }
  return [...merged.values()];
}

function entries(items: CartItem[]) { return items.map(({ id, quantity }) => ({ id, quantity })); }

async function readRemoteCart(session: Session) {
  const response = await fetch(`${window.location.origin}/api/cart`, { headers: { Authorization: `Bearer ${session.access_token}` }, cache: "no-store" });
  if (!response.ok) throw new Error(`Cart sync returned ${response.status}`);
  const result = await response.json();
  return (Array.isArray(result.items) ? result.items : []) as CartItem[];
}

async function writeRemoteCart(session: Session, items: CartItem[]) {
  const response = await fetch(`${window.location.origin}/api/cart`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ items: entries(items) }),
  });
  if (!response.ok) throw new Error(`Cart sync returned ${response.status}`);
  const result = await response.json();
  return (Array.isArray(result.items) ? result.items : []) as CartItem[];
}

export function useCartSync() {
  const [cart, setCartState] = useState<CartItem[]>([]);
  const sessionRef = useRef<Session | null>(null);
  const cartRef = useRef<CartItem[]>([]);
  const syncedUserRef = useRef<string | null>(null);

  const applyCart = useCallback((items: CartItem[]) => {
    cartRef.current = items;
    setCartState(items);
    persistCart(items);
  }, []);

  const setCart = useCallback((items: CartItem[]) => {
    applyCart(items);
    const session = sessionRef.current;
    if (session) void writeRemoteCart(session, items).catch(error => console.warn("Could not sync Artini cart", error));
  }, [applyCart]);

  useEffect(() => {
    applyCart(readLocalCart());
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) return;
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let disposed = false;

    const syncSession = async (session: Session | null) => {
      sessionRef.current = session;
      if (!session) {
        syncedUserRef.current = null;
        if (channel) { void supabase.removeChannel(channel); channel = null; }
        return;
      }
      if (syncedUserRef.current === session.user.id) return;
      syncedUserRef.current = session.user.id;
      try {
        const remote = await readRemoteCart(session);
        if (disposed) return;
        const local = readLocalCart();
        const merged = mergeCart(local, remote);
        applyCart(merged);
        if (JSON.stringify(entries(merged)) !== JSON.stringify(entries(remote))) {
          const saved = await writeRemoteCart(session, merged);
          if (!disposed) applyCart(saved);
        }
      } catch (error) {
        console.warn("Artini shared cart is unavailable. Apply supabase/cart-sync.sql and try again.", error);
      }
      if (disposed) return;
      if (channel) void supabase.removeChannel(channel);
      channel = supabase.channel(`artini-cart-${session.user.id}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "user_carts", filter: `user_id=eq.${session.user.id}` }, () => {
          void readRemoteCart(session).then(items => { if (!disposed) applyCart(items); }).catch(error => console.warn("Could not refresh the shared Artini cart", error));
        })
        .subscribe();
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => { void syncSession(session); });
    void supabase.auth.getSession().then(({ data }) => syncSession(data.session));
    return () => {
      disposed = true;
      subscription.unsubscribe();
      if (channel) void supabase.removeChannel(channel);
    };
  }, [applyCart]);

  return { cart, setCart };
}
