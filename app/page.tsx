"use client";

import { useEffect, useState } from "react";
import { ArrowDown, ArrowRight, ArrowUpRight, Menu, ShoppingBag, Sparkles, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";

type Product = { id: string; name: string; category: string; description: string; price: number; image_url?: string; kind: string; featured?: boolean };
const demoProducts: Product[] = [
  { id: "sunrise", name: "First Light", category: "THE SUN SERIES", description: "Warmth, caught in a thousand threads.", price: 68000, kind: "artwork", image_url: "/art-sun.svg", featured: true },
  { id: "flower", name: "Wildflower No. 02", category: "BOTANICAL STUDIES", description: "A little reminder to keep growing.", price: 54000, kind: "artwork", image_url: "/art-flower.svg" },
  { id: "shore", name: "Somewhere by the Sea", category: "LANDSCAPE STUDIES", description: "Blue skies and room to breathe.", price: 76000, kind: "artwork", image_url: "/art-sea.svg" },
];
const money = (amount: number) => new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 }).format(amount);

export default function Home() {
  const [products, setProducts] = useState<Product[]>(demoProducts);
  const [cartCount, setCartCount] = useState(0);
  const [user, setUser] = useState<User | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState("");
  useEffect(() => {
    try { setCartCount(JSON.parse(localStorage.getItem("artini-cart") || "[]").reduce((sum: number, x: { quantity: number }) => sum + x.quantity, 0)); } catch {}
    const currentUrl = new URL(window.location.href);
    if (currentUrl.searchParams.get("auth") === "error") {
      const stage = currentUrl.searchParams.get("stage");
      const detail = stage === "exchange" ? "Supabase could not create a session (callback exchange). Check the dev server output." : stage === "provider" ? "Google or Supabase returned an OAuth error. Check the dev server output." : "The sign-in callback was incomplete. Please try again.";
      setToast(`Google sign-in didn’t finish. ${detail}`);
      window.history.replaceState({}, "", `${currentUrl.pathname}${currentUrl.hash}`);
      window.setTimeout(() => setToast(""), 8000);
    }
    let unsubscribe: (() => void) | undefined;
    if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
      const supabase = createClient();
      const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => setUser(session?.user ?? null));
      unsubscribe = () => subscription.unsubscribe();
      void supabase.auth.getSession().then(({ data }) => setUser(data.session?.user ?? null));
      void supabase.from("products").select("id,name,category,description,price,image_url,kind,featured").eq("active", true).eq("kind", "artwork").order("featured", { ascending: false }).then(({ data }) => { if (data?.length) setProducts(data as Product[]); });
    }
    return () => unsubscribe?.();
  }, []);
  const addToCart = (product: Product) => {
    const cart = JSON.parse(localStorage.getItem("artini-cart") || "[]") as { id: string; quantity: number; name?: string; price?: number; image_url?: string }[];
    const current = cart.find((x) => x.id === product.id);
    if (current) current.quantity += 1; else cart.push({ id: product.id, quantity: 1, name: product.name, price: product.price, image_url: product.image_url });
    localStorage.setItem("artini-cart", JSON.stringify(cart)); setCartCount(cart.reduce((n, x) => n + x.quantity, 0));
    setToast(`${product.name} added to your bag`); window.setTimeout(() => setToast(""), 2400);
  };
  const signIn = async () => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) { setToast("Add your Supabase settings to enable Google sign-in"); window.setTimeout(() => setToast(""), 3000); return; }
    const { error } = await createClient().auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${window.location.origin}/auth/callback` } });
    if (error) { setToast(error.message); window.setTimeout(() => setToast(""), 4000); }
  };
  const signOut = async () => {
    const { error } = await createClient().auth.signOut();
    if (error) { setToast(error.message); window.setTimeout(() => setToast(""), 4000); return; }
    setUser(null); setToast("You’re signed out"); window.setTimeout(() => setToast(""), 2400);
  };
  const displayName = user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email?.split("@")[0] || "Account";
  const initials = String(displayName).split(/\s+/).map(part => part[0]).slice(0, 2).join("").toUpperCase();
  return <>
    <div className="announcement">HANDMADE WITH HEART IN LAGOS <span>✳</span> SHIPPING NATIONWIDE</div>
    <header className="header"><button className="icon-button mobile-menu" aria-label="Open menu" onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X /> : <Menu />}</button><a className="brandmark" href="#top"><img src="/artini-logo.png" alt="Artini"/></a><nav className={menuOpen ? "nav open" : "nav"}><a href="#collection" onClick={() => setMenuOpen(false)}>The collection</a><a href="#workshops" onClick={() => setMenuOpen(false)}>Workshops</a><a href="#custom" onClick={() => setMenuOpen(false)}>Custom work</a><a href="#story" onClick={() => setMenuOpen(false)}>Our story</a></nav><div className="header-actions">{user ? <><div className="account-state" title={user.email || displayName}><span className="account-avatar">{initials}</span><span className="account-name">Hi, {displayName}</span></div><button className="signin" onClick={signOut}>Sign out</button></> : <button className="signin" onClick={signIn}>Sign in</button>}<a className="bag-link" href="/checkout"><ShoppingBag size={17} strokeWidth={1.6} /><span>Bag</span><b>{cartCount}</b></a></div></header>
    <main id="top">
      <section className="hero"><div className="hero-copy"><div className="eyebrow"><span className="eyebrow-line"/> ART, MADE ONE THREAD AT A TIME</div><h1>Make space<br/>for <em>wonder.</em></h1><p>One nail. One thread. A little bit of magic. We make thoughtful string art for the moments, people and places that matter.</p><div className="hero-cta"><a className="button button-dark" href="#collection">Explore the collection <ArrowRight size={16}/></a><a className="text-link" href="#workshops">Come make with us <ArrowUpRight size={15}/></a></div><div className="hero-note"><span className="note-stars">✳ ✳ ✳</span><span>Made slowly, made to last<br/><b>Each piece is one of a kind</b></span></div></div><div className="hero-art"><div className="art-label">OBJECTS WITH A STORY <span>01—03</span></div><div className="hero-artwork"><img src="/art-sun.svg" alt="Handmade string art interpretation of a setting sun"/><div className="art-roundel">MADE<br/>BY HAND<br/><span>✳</span></div></div><div className="hero-caption"><span>THE SUN SERIES — No. 01</span><span>01 / 03</span></div><div className="vertical-note">LAGOS, NIGERIA · EST. 2021</div></div><a href="#collection" className="scroll-cue"><ArrowDown size={15}/> SCROLL A LITTLE</a></section>
      <section className="marquee"><div>GOOD THINGS TAKE THREAD <span>✳</span> GOOD THINGS TAKE THREAD <span>✳</span> GOOD THINGS TAKE THREAD <span>✳</span></div></section>
      <section className="collection section-wrap" id="collection"><div className="section-heading"><div><div className="eyebrow"><span className="eyebrow-line"/> A FEW FAVOURITES</div><h2>Little pieces of <em>joy.</em></h2></div><a className="text-link" href="#collection">View all pieces <ArrowRight size={15}/></a></div><div className="product-grid">{products.map((p, index) => <article className="product-card" key={p.id}><div className={`product-image product-image-${index % 3}`}><img src={p.image_url || "/art-sun.svg"} alt={p.name}/><button className="quick-add" onClick={() => addToCart(p)}>ADD TO BAG <span>+</span></button><span className="product-index">0{index + 1}</span></div><div className="product-meta"><div><span className="product-category">{p.category || "THE STUDIO COLLECTION"}</span><h3>{p.name}</h3><p>{p.description}</p></div><strong>{money(p.price)}</strong></div></article>)}</div><div className="collection-foot"><span>EVERY PIECE IS MADE TO ORDER · ALLOW 7–10 DAYS</span><a href="#custom">Looking for something made just for you? <ArrowUpRight size={14}/></a></div></section>
      <section className="workshop" id="workshops"><div className="workshop-image"><div className="workshop-stamp">A GOOD<br/>TIME, BY<br/>HAND <span>✳</span></div><div className="workshop-photo"><div className="photo-sun"/><div className="photo-rays">✳</div><span className="photo-label">THE JOY OF MAKING, TOGETHER</span></div><div className="workshop-side">GOOD HANDS. GOOD COMPANY.</div></div><div className="workshop-copy"><div className="eyebrow"><span className="eyebrow-line"/> LESS SCREEN TIME. MORE STRING TIME.</div><h2>Make a little<br/><em>mess. Make art.</em></h2><p>Our workshops are an invitation to slow down, get your hands busy and leave with something you made yourself. No experience required. Good company guaranteed.</p><div className="workshop-details"><div><span>01 / FOR TEAMS</span><b>Bring your people together.</b><small>Private team-building sessions, made memorable.</small></div><div><span>02 / FOR EVERYONE</span><b>Try something with your hands.</b><small>Open studio days for curious humans of all ages.</small></div></div><a className="button button-dark" href="/workshops">Find your workshop <ArrowRight size={16}/></a></div></section>
      <section className="custom section-wrap" id="custom"><div className="custom-left"><div className="eyebrow"><span className="eyebrow-line"/> YOUR IDEA, OUR THREAD</div><h2>A little more<br/><em>personal.</em></h2><p>A portrait of your home. A gift for your favourite person. A piece that feels like your brand. Tell us the story — we’ll help you turn it into string art.</p><a className="button button-outline" href="/custom">Let's make something <ArrowUpRight size={16}/></a></div><div className="custom-right"><div className="quote-mark">“</div><blockquote>There is something lovely about watching a simple thread become a story.</blockquote><span>THE STUDIO NOTEBOOK, VOL. 01</span><div className="quote-stitch">✳ · · · · · · · ✳</div></div></section>
      <section className="story" id="story"><div className="story-big">MADE WITH<br/><em>INTENTION.</em></div><div className="story-small"><Sparkles size={19}/><p>We believe the things around us should mean something. That making by hand makes a difference. And that art should feel a little bit like you.</p><a href="/custom">A little more about us <ArrowRight size={15}/></a></div><span className="story-ornament">A<br/>✳</span></section>
      <footer className="footer"><a className="brandmark footer-logo" href="#top"><img src="/artini-logo.png" alt="Artini"/></a><span>GOOD THINGS TAKE THREAD. © 2026 ARTINI</span><div><a href="/custom">SAY HELLO</a><a href="#collection">INSTAGRAM ↗</a><a href="/checkout">YOUR BAG ({cartCount})</a></div></footer>
    </main>{toast && <div className="toast">✳ &nbsp; {toast}</div>}
  </>;
}
