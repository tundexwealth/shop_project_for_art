import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, AppState, KeyboardAvoidingView, Platform, Pressable, SafeAreaView, ScrollView, StatusBar, StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";
import { Image } from "expo-image";
import * as AuthSession from "expo-auth-session";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import type { Session, User } from "@supabase/supabase-js";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase, supabaseConfigured } from "./lib/supabase";

WebBrowser.maybeCompleteAuthSession();

type Product = { id: string; name: string; category: string; description: string; price: number; image_url?: string; kind: string; featured?: boolean };
type CartItem = Product & { quantity: number };
type Tab = "shop" | "bag" | "workshops" | "custom";
type WorkshopForm = { workshop_type: string; customer_name: string; customer_email: string; customer_phone: string; organization: string; guest_count: string; preferred_date: string; notes: string };
type CustomForm = { project_type: string; customer_name: string; customer_email: string; customer_phone: string; organization: string; needed_by: string; details: string };

const API_URL = (process.env.EXPO_PUBLIC_API_URL || "").replace(/\/+$/, "");
const CART_KEY = "artini-cart";
const money = (amount: number) => new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 }).format(amount);
const productFields = "id,name,category,description,price,image_url,kind,featured";
const emptyWorkshop: WorkshopForm = { workshop_type: "company", customer_name: "", customer_email: "", customer_phone: "", organization: "", guest_count: "8", preferred_date: "", notes: "" };
const emptyCustom: CustomForm = { project_type: "personal", customer_name: "", customer_email: "", customer_phone: "", organization: "", needed_by: "", details: "" };

function getImageUrl(path?: string) {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  return API_URL ? `${API_URL}${path.startsWith("/") ? "" : "/"}${path}` : null;
}

function cartEntries(items: CartItem[]) { return items.map(item => ({ id: item.id, quantity: item.quantity })); }
function mergeCarts(local: CartItem[], remote: CartItem[]) {
  const combined = new Map<string, CartItem>();
  for (const item of [...remote, ...local]) {
    const existing = combined.get(item.id);
    combined.set(item.id, { ...existing, ...item, quantity: Math.min(20, (existing?.quantity || 0) + item.quantity) });
  }
  return [...combined.values()];
}

async function localCart(): Promise<CartItem[]> {
  try {
    const saved = await AsyncStorage.getItem(CART_KEY);
    const parsed = saved ? JSON.parse(saved) : [];
    return Array.isArray(parsed) ? parsed.filter(item => typeof item?.id === "string" && Number.isInteger(item.quantity) && item.quantity > 0) : [];
  } catch { return []; }
}

async function readCloudCart(session: Session): Promise<CartItem[]> {
  if (!API_URL) throw new Error("Set EXPO_PUBLIC_API_URL to your Vercel URL or computer's local network address.");
  const response = await fetch(`${API_URL}/api/cart`, { headers: { Authorization: `Bearer ${session.access_token}` }, cache: "no-store" });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `Cart sync returned ${response.status}`);
  return (Array.isArray(result.items) ? result.items : []) as CartItem[];
}

async function writeCloudCart(session: Session, items: CartItem[]): Promise<CartItem[]> {
  if (!API_URL) throw new Error("Set EXPO_PUBLIC_API_URL to your Vercel URL or computer's local network address.");
  const response = await fetch(`${API_URL}/api/cart`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ items: cartEntries(items) }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `Cart sync returned ${response.status}`);
  return (Array.isArray(result.items) ? result.items : []) as CartItem[];
}

function Field({ label, value, onChangeText, placeholder, multiline, keyboardType, autoCapitalize = "sentences" }: { label: string; value: string; onChangeText: (value: string) => void; placeholder?: string; multiline?: boolean; keyboardType?: TextInputProps["keyboardType"]; autoCapitalize?: TextInputProps["autoCapitalize"] }) {
  return <View style={styles.field}><Text style={styles.fieldLabel}>{label}</Text><TextInput style={[styles.input, multiline && styles.inputMulti]} value={value} onChangeText={onChangeText} placeholder={placeholder || label} placeholderTextColor="#968f84" multiline={multiline} keyboardType={keyboardType} autoCapitalize={autoCapitalize} /></View>;
}

function Choice({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return <Pressable onPress={onPress} style={[styles.choice, selected && styles.choiceSelected]}><Text style={[styles.choiceText, selected && styles.choiceTextSelected]}>{label}</Text></Pressable>;
}

export default function App() {
  const [products, setProducts] = useState<Product[]>([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [cart, setCartState] = useState<CartItem[]>([]);
  const cartRef = useRef<CartItem[]>([]);
  const sessionRef = useRef<Session | null>(null);
  const syncedUserRef = useRef<string | null>(null);
  const saveVersionRef = useRef(0);
  const [user, setUser] = useState<User | null>(null);
  const [tab, setTab] = useState<Tab>("shop");
  const [syncStatus, setSyncStatus] = useState("local");
  const [authBusy, setAuthBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [shopError, setShopError] = useState("");
  const [checkout, setCheckout] = useState({ name: "", email: "", phone: "", address: "" });
  const [workshopForm, setWorkshopForm] = useState<WorkshopForm>(emptyWorkshop);
  const [customForm, setCustomForm] = useState<CustomForm>(emptyCustom);
  const [formMessage, setFormMessage] = useState("");
  const [orderComplete, setOrderComplete] = useState(false);
  const [inquirySent, setInquirySent] = useState(false);

  const applyCart = useCallback((items: CartItem[]) => {
    cartRef.current = items;
    setCartState(items);
    void AsyncStorage.setItem(CART_KEY, JSON.stringify(items));
  }, []);

  const syncCart = useCallback(async (session: Session, mergeLocal: boolean) => {
    setSyncStatus("syncing");
    try {
      const remote = await readCloudCart(session);
      const next = mergeLocal ? mergeCarts(await localCart(), remote) : remote;
      applyCart(next);
      if (mergeLocal && JSON.stringify(cartEntries(next)) !== JSON.stringify(cartEntries(remote))) {
        const saved = await writeCloudCart(session, next);
        applyCart(saved);
      }
      setSyncStatus("synced");
    } catch (error) {
      setSyncStatus("error");
      setToast(error instanceof Error ? error.message : "Cart sync failed. Run the cart SQL setup and try again.");
    }
  }, [applyCart]);

  const changeCart = useCallback((transform: (items: CartItem[]) => CartItem[]) => {
    const next = transform(cartRef.current);
    applyCart(next);
    const session = sessionRef.current;
    if (!session) return;
    setSyncStatus("syncing");
    const version = ++saveVersionRef.current;
    void writeCloudCart(session, next).then(saved => {
      if (saveVersionRef.current === version) { applyCart(saved); setSyncStatus("synced"); }
    }).catch(error => {
      if (saveVersionRef.current === version) {
        setSyncStatus("error");
        setToast(error instanceof Error ? error.message : "Could not sync the cart.");
      }
    });
  }, [applyCart]);

  useEffect(() => { void localCart().then(saved => { if (!sessionRef.current) applyCart(saved); }); }, [applyCart]);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      sessionRef.current = session;
      setUser(session?.user || null);
      if (session?.user.email) setCheckout(current => ({ ...current, email: session.user.email || current.email, name: String(session.user.user_metadata?.full_name || session.user.user_metadata?.name || current.name) }));
      if (session) {
        if (syncedUserRef.current !== session.user.id) {
          syncedUserRef.current = session.user.id;
          void syncCart(session, true);
        }
      } else {
        syncedUserRef.current = null;
        setSyncStatus("local");
      }
    });
    void supabase.auth.getSession().then(({ data }) => {
      const session = data.session;
      sessionRef.current = session;
      setUser(session?.user || null);
      if (session && syncedUserRef.current !== session.user.id) {
        syncedUserRef.current = session.user.id;
        void syncCart(session, true);
      }
    });
    return () => subscription.unsubscribe();
  }, [syncCart]);

  useEffect(() => {
    if (!user) return;
    const channel = supabase.channel(`artini-mobile-cart-${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "user_carts", filter: `user_id=eq.${user.id}` }, () => {
        const session = sessionRef.current;
        if (session) void syncCart(session, false);
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [user?.id, syncCart]);

  useEffect(() => {
    let active = true;
    async function loadProducts() {
      if (!supabaseConfigured) { setShopError("Set the Expo Supabase URL and publishable key in mobile/.env.local."); setProductsLoading(false); return; }
      const { data, error } = await supabase.from("products").select(productFields).eq("active", true).eq("kind", "artwork").order("featured", { ascending: false });
      if (!active) return;
      if (error) setShopError(error.message);
      else setProducts((data || []) as Product[]);
      setProductsLoading(false);
    }
    void loadProducts();
    return () => { active = false; };
  }, []);

  const subtotal = useMemo(() => cart.reduce((sum, item) => sum + item.price * item.quantity, 0), [cart]);
  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const displayName = user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email?.split("@")[0] || "there";

  const signIn = async () => {
    if (!supabaseConfigured) { setToast("Set the Expo Supabase keys in mobile/.env.local first."); return; }
    setAuthBusy(true);
    try {
      const redirectTo = AuthSession.makeRedirectUri({ scheme: "artini", path: "auth/callback" });
      const { data, error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo, skipBrowserRedirect: true } });
      if (error) throw error;
      if (!data.url) throw new Error("Supabase did not return a Google sign-in URL.");
      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
      if (result.type === "success") {
        const params = Linking.parse(result.url).queryParams || {};
        if (typeof params.error_description === "string") throw new Error(params.error_description);
        if (typeof params.code !== "string") throw new Error("Google returned without an authorization code. Check the Supabase deep-link allow list.");
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(params.code);
        if (exchangeError) throw exchangeError;
      }
    } catch (error) { setToast(error instanceof Error ? error.message : "Google sign-in failed."); }
    finally { setAuthBusy(false); }
  };

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) setToast(error.message);
    else setToast("You’re signed out.");
  };

  const addItem = (product: Product) => {
    changeCart(items => {
      const found = items.find(item => item.id === product.id);
      if (found) return items.map(item => item.id === product.id ? { ...item, quantity: Math.min(20, item.quantity + 1) } : item);
      return [...items, { ...product, quantity: 1 }];
    });
    setToast(`${product.name} added to your bag.`);
  };

  const updateItem = (id: string, amount: number) => changeCart(items => items.map(item => item.id === id ? { ...item, quantity: item.quantity + amount } : item).filter(item => item.quantity > 0));

  const placeOrder = async () => {
    if (!cart.length) return;
    if (!API_URL) { setToast("Set EXPO_PUBLIC_API_URL in mobile/.env.local before checkout."); return; }
    setBusy(true); setFormMessage("");
    try {
      const session = sessionRef.current;
      const response = await fetch(`${API_URL}/api/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}) },
        body: JSON.stringify({ customer: checkout, items: cartEntries(cart) }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "We couldn't place your order.");
      setOrderComplete(true);
      setFormMessage(result.emailSent ? "Mailgun accepted your order confirmation." : "Your order is saved. The studio will follow up by email.");
      changeCart(() => []);
    } catch (error) { setFormMessage(error instanceof Error ? error.message : "Something went wrong."); }
    finally { setBusy(false); }
  };

  const sendInquiry = async (kind: "workshops" | "custom") => {
    if (!API_URL) { setFormMessage("Set EXPO_PUBLIC_API_URL in mobile/.env.local first."); return; }
    setBusy(true); setFormMessage("");
    try {
      const session = sessionRef.current;
      const payload = kind === "workshops" ? { ...workshopForm, guest_count: Number(workshopForm.guest_count) } : customForm;
      const response = await fetch(`${API_URL}/api/${kind}`, { method: "POST", headers: { "Content-Type": "application/json", ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}) }, body: JSON.stringify(payload) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "We couldn't send your note.");
      setInquirySent(true);
      setFormMessage("Your note is with the studio. We’ll be in touch soon.");
    } catch (error) { setFormMessage(error instanceof Error ? error.message : "Something went wrong."); }
    finally { setBusy(false); }
  };

  const setWorkshop = (key: keyof WorkshopForm, value: string) => setWorkshopForm(current => ({ ...current, [key]: value }));
  const setCustom = (key: keyof CustomForm, value: string) => setCustomForm(current => ({ ...current, [key]: value }));

  return <SafeAreaView style={styles.safe}>
    <StatusBar barStyle="dark-content" backgroundColor={COLORS.paper} />
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={styles.topbar}>
        <View style={styles.brandRow}><Image source={require("./assets/icon.png")} style={styles.brandIcon} contentFit="contain"/><View><Text style={styles.brandName}>Artini</Text><Text style={styles.brandSub}>STRING ART STUDIO</Text></View></View>
        {user ? <Pressable onPress={signOut} style={styles.accountButton}><Text style={styles.accountGreeting}>HI, {displayName.toUpperCase()}</Text><Text style={styles.accountAction}>SIGN OUT</Text></Pressable> : <Pressable onPress={signIn} disabled={authBusy} style={styles.accountButton}><Text style={styles.accountAction}>{authBusy ? "OPENING GOOGLE…" : "SIGN IN ↗"}</Text></Pressable>}
      </View>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {tab === "shop" && <>
          <View style={styles.hero}><Text style={styles.eyebrow}>ART, MADE ONE THREAD AT A TIME</Text><Text style={styles.heroTitle}>Make space{"\n"}for <Text style={styles.italic}>wonder.</Text></Text><Text style={styles.heroBody}>Thoughtful string art for the moments, people and places that matter. Made slowly, by hand, in Lagos.</Text><View style={styles.heroMark}><Text style={styles.heroMarkText}>MADE WITH HEART IN LAGOS  ·  SHIPPING NATIONWIDE</Text></View></View>
          <View style={styles.sectionHeader}><View><Text style={styles.eyebrow}>A FEW FAVOURITES</Text><Text style={styles.sectionTitle}>Little pieces of joy.</Text></View><Text style={styles.sectionCount}>0{products.length} PIECES</Text></View>
          {productsLoading && <ActivityIndicator color={COLORS.terracotta} style={{ marginVertical: 24 }} />}
          {!!shopError && <Text style={styles.errorText}>{shopError}</Text>}
          <View style={styles.productList}>{products.map((product, index) => {
            const imageUrl = getImageUrl(product.image_url);
            return <View key={product.id} style={styles.productCard}>
              <View style={[styles.productImage, index % 3 === 1 && styles.productImageRose, index % 3 === 2 && styles.productImageSage]}>
                <Image source={imageUrl ? { uri: imageUrl } : require("./assets/icon.png")} style={styles.artImage} contentFit="contain" transition={180}/>
                <Text style={styles.productIndex}>0{index + 1}</Text>
              </View>
              <View style={styles.productDetails}><View style={styles.productCopy}><Text style={styles.productCategory}>{product.category}</Text><Text style={styles.productName}>{product.name}</Text><Text style={styles.productDescription}>{product.description}</Text><Text style={styles.productPrice}>{money(product.price)}</Text></View><Pressable onPress={() => addItem(product)} style={styles.addButton}><Text style={styles.addButtonText}>ADD TO BAG  +</Text></Pressable></View>
            </View>;
          })}</View>
          <View style={styles.studioCard}><Text style={styles.eyebrow}>LESS SCREEN TIME. MORE STRING TIME.</Text><Text style={styles.studioTitle}>Make a little mess.{"\n"}<Text style={styles.italic}>Make art.</Text></Text><Text style={styles.heroBody}>Creative workshops for teams, friends and curious humans of all ages.</Text><Pressable onPress={() => { setTab("workshops"); setFormMessage(""); setInquirySent(false); }} style={styles.outlineButton}><Text style={styles.outlineButtonText}>EXPLORE WORKSHOPS  ↗</Text></Pressable></View>
        </>}

        {tab === "bag" && <>
          <View style={styles.pageIntro}><Text style={styles.eyebrow}>YOUR NEXT FAVOURITE THING</Text><Text style={styles.pageTitle}>Almost <Text style={styles.italic}>yours.</Text></Text><Text style={styles.heroBody}>We’ll make sure it gets to the right place.</Text></View>
          {user ? <View style={[styles.syncBanner, syncStatus === "error" && styles.syncBannerError]}><Text style={styles.syncDot}>✳</Text><Text style={styles.syncText}>{syncStatus === "synced" ? "Your bag is synced with the Artini website." : syncStatus === "syncing" ? "Syncing your bag across devices…" : syncStatus === "error" ? "Cart sync needs setup. Check the project instructions." : "Sign in to sync your bag with the website."}</Text></View> : <View style={styles.syncBanner}><Text style={styles.syncDot}>✳</Text><Text style={styles.syncText}>Sign in with Google on web and mobile to share one bag between devices.</Text></View>}
          {cart.map(item => <View key={item.id} style={styles.cartRow}><View style={styles.cartThumb}><Image source={getImageUrl(item.image_url) ? { uri: getImageUrl(item.image_url)! } : require("./assets/icon.png")} style={styles.cartImage} contentFit="contain"/></View><View style={styles.cartInfo}><Text style={styles.productName}>{item.name}</Text><Text style={styles.productPrice}>{money(item.price)}</Text><View style={styles.quantityRow}><Pressable style={styles.quantityButton} onPress={() => updateItem(item.id, -1)}><Text style={styles.quantityText}>−</Text></Pressable><Text style={styles.quantityText}>{item.quantity}</Text><Pressable style={styles.quantityButton} onPress={() => updateItem(item.id, 1)}><Text style={styles.quantityText}>+</Text></Pressable></View></View><Text style={styles.lineTotal}>{money(item.price * item.quantity)}</Text></View>)}
          {!cart.length && <View style={styles.emptyState}><Text style={styles.emptyMark}>✳</Text><Text style={styles.emptyTitle}>Your bag is waiting.</Text><Text style={styles.heroBody}>Find a piece that feels like you.</Text><Pressable onPress={() => setTab("shop")} style={styles.darkButton}><Text style={styles.darkButtonText}>EXPLORE THE COLLECTION</Text></Pressable></View>}
          {!!cart.length && <>
            <View style={styles.totalRow}><Text style={styles.totalLabel}>ORDER TOTAL</Text><Text style={styles.totalAmount}>{money(subtotal)}</Text></View>
            {!orderComplete ? <View style={styles.formCard}><Text style={styles.formTitle}>Your details</Text><Field label="Full name" value={checkout.name} onChangeText={name => setCheckout(current => ({ ...current, name }))} autoCapitalize="words"/><Field label="Email address" value={checkout.email} onChangeText={email => setCheckout(current => ({ ...current, email }))} keyboardType="email-address" autoCapitalize="none"/><Field label="Phone number" value={checkout.phone} onChangeText={phone => setCheckout(current => ({ ...current, phone }))} keyboardType="phone-pad"/><Field label="Delivery address" value={checkout.address} onChangeText={address => setCheckout(current => ({ ...current, address }))} multiline/><Text style={styles.paymentNote}>Payment is personally handled by the studio. We’ll email you to confirm payment and delivery details.</Text><Pressable onPress={() => void placeOrder()} disabled={busy} style={[styles.darkButton, busy && styles.disabledButton]}><Text style={styles.darkButtonText}>{busy ? "SAVING ORDER…" : "PLACE MY ORDER  →"}</Text></Pressable></View> : <View style={styles.successCard}><Text style={styles.successMark}>✓</Text><Text style={styles.emptyTitle}>Order received.</Text><Text style={styles.heroBody}>{formMessage}</Text><Pressable onPress={() => { setOrderComplete(false); setTab("shop"); }} style={styles.outlineButton}><Text style={styles.outlineButtonText}>BACK TO THE STUDIO</Text></Pressable></View>}
          </>}
        </>}

        {tab === "workshops" && <>
          <View style={styles.pageIntro}><Text style={styles.eyebrow}>A GOOD TIME, BY HAND</Text><Text style={styles.pageTitle}>Room to <Text style={styles.italic}>create.</Text></Text><Text style={styles.heroBody}>Tell us about your group and we’ll plan a workshop together.</Text></View>
          {!inquirySent ? <View style={styles.formCard}><Text style={styles.formTitle}>I’m interested in</Text><View style={styles.choiceRow}><Choice label="Company team" selected={workshopForm.workshop_type === "company"} onPress={() => setWorkshop("workshop_type", "company")}/><Choice label="Open studio" selected={workshopForm.workshop_type === "open-studio"} onPress={() => setWorkshop("workshop_type", "open-studio")}/><Choice label="Private group" selected={workshopForm.workshop_type === "private-group"} onPress={() => setWorkshop("workshop_type", "private-group")}/></View><Field label="Your name" value={workshopForm.customer_name} onChangeText={v => setWorkshop("customer_name", v)} autoCapitalize="words"/><Field label="Email address" value={workshopForm.customer_email} onChangeText={v => setWorkshop("customer_email", v)} keyboardType="email-address" autoCapitalize="none"/><Field label="Phone number" value={workshopForm.customer_phone} onChangeText={v => setWorkshop("customer_phone", v)} keyboardType="phone-pad"/><Field label="Company or group" value={workshopForm.organization} onChangeText={v => setWorkshop("organization", v)} /><Field label="Number of guests" value={workshopForm.guest_count} onChangeText={v => setWorkshop("guest_count", v)} keyboardType="number-pad"/><Field label="Preferred date (YYYY-MM-DD)" value={workshopForm.preferred_date} onChangeText={v => setWorkshop("preferred_date", v)} placeholder="Optional"/><Field label="Anything else?" value={workshopForm.notes} onChangeText={v => setWorkshop("notes", v)} multiline/><Pressable onPress={() => void sendInquiry("workshops")} disabled={busy} style={[styles.darkButton, busy && styles.disabledButton]}><Text style={styles.darkButtonText}>{busy ? "SENDING…" : "SEND WORKSHOP NOTE  →"}</Text></Pressable></View> : <View style={styles.successCard}><Text style={styles.successMark}>✓</Text><Text style={styles.emptyTitle}>We’ve got your note.</Text><Text style={styles.heroBody}>{formMessage}</Text></View>}
        </>}

        {tab === "custom" && <>
          <View style={styles.pageIntro}><Text style={styles.eyebrow}>YOUR IDEA, OUR THREAD</Text><Text style={styles.pageTitle}>A little more <Text style={styles.italic}>personal.</Text></Text><Text style={styles.heroBody}>Tell us the story you’d like to turn into string art.</Text></View>
          {!inquirySent ? <View style={styles.formCard}><Text style={styles.formTitle}>This project is for</Text><View style={styles.choiceRow}><Choice label="Personal" selected={customForm.project_type === "personal"} onPress={() => setCustom("project_type", "personal")}/><Choice label="A brand" selected={customForm.project_type === "brand"} onPress={() => setCustom("project_type", "brand")}/><Choice label="A space" selected={customForm.project_type === "space"} onPress={() => setCustom("project_type", "space")}/></View><Field label="Your name" value={customForm.customer_name} onChangeText={v => setCustom("customer_name", v)} autoCapitalize="words"/><Field label="Email address" value={customForm.customer_email} onChangeText={v => setCustom("customer_email", v)} keyboardType="email-address" autoCapitalize="none"/><Field label="Phone number" value={customForm.customer_phone} onChangeText={v => setCustom("customer_phone", v)} keyboardType="phone-pad"/><Field label="Company or organization" value={customForm.organization} onChangeText={v => setCustom("organization", v)} placeholder="Optional"/><Field label="When do you need it? (YYYY-MM-DD)" value={customForm.needed_by} onChangeText={v => setCustom("needed_by", v)} placeholder="Optional"/><Field label="Tell us about your idea" value={customForm.details} onChangeText={v => setCustom("details", v)} multiline/><Pressable onPress={() => void sendInquiry("custom")} disabled={busy} style={[styles.darkButton, busy && styles.disabledButton]}><Text style={styles.darkButtonText}>{busy ? "SENDING…" : "SEND YOUR IDEA  →"}</Text></Pressable></View> : <View style={styles.successCard}><Text style={styles.successMark}>✓</Text><Text style={styles.emptyTitle}>Your idea is with us.</Text><Text style={styles.heroBody}>{formMessage}</Text></View>}
        </>}
        {!!formMessage && !orderComplete && !inquirySent && tab !== "bag" && <Text style={styles.errorText}>{formMessage}</Text>}
        {!!toast && <Pressable onPress={() => setToast("")} style={styles.toast}><Text style={styles.toastText}>✳  {toast}</Text></Pressable>}
        <View style={styles.footer}><Text style={styles.footerText}>GOOD THINGS TAKE THREAD</Text><Text style={styles.footerText}>ARTINI · LAGOS, NIGERIA</Text></View>
      </ScrollView>
      <View style={styles.tabBar}>{(["shop", "bag", "workshops", "custom"] as Tab[]).map(item => <Pressable key={item} onPress={() => { setTab(item); setFormMessage(""); if (item === "workshops" || item === "custom") setInquirySent(false); if (item === "bag") setOrderComplete(false); }} style={styles.tabButton}><Text style={[styles.tabLabel, tab === item && styles.tabLabelActive]}>{item === "bag" ? `BAG${cartCount ? ` · ${cartCount}` : ""}` : item.toUpperCase()}</Text><View style={[styles.tabUnderline, tab === item && styles.tabUnderlineActive]}/></Pressable>)}</View>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

const COLORS = { paper: "#F7F3EC", card: "#F0EBE2", ink: "#26231F", muted: "#746E64", line: "#DED7CB", terracotta: "#B86645", sage: "#78816B", white: "#FFFEFB", error: "#9D493A" };
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.paper }, flex: { flex: 1 }, scroll: { paddingBottom: 30 },
  topbar: { minHeight: 68, paddingHorizontal: 20, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: COLORS.line },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 9 }, brandIcon: { width: 44, height: 44, borderRadius: 22 }, brandName: { color: COLORS.ink, fontSize: 24, fontFamily: Platform.OS === "ios" ? "Georgia" : "serif", fontStyle: "italic", lineHeight: 26 }, brandSub: { color: COLORS.muted, fontSize: 8, letterSpacing: 1.6 },
  accountButton: { alignItems: "flex-end", paddingVertical: 8 }, accountGreeting: { color: COLORS.sage, fontSize: 9, letterSpacing: 1 }, accountAction: { color: COLORS.ink, fontSize: 10, fontWeight: "700", letterSpacing: 1.1 },
  hero: { paddingHorizontal: 23, paddingTop: 31, paddingBottom: 25 }, eyebrow: { color: COLORS.terracotta, fontSize: 9, fontWeight: "700", letterSpacing: 1.7 }, heroTitle: { color: COLORS.ink, fontSize: 48, lineHeight: 50, marginTop: 16, fontFamily: Platform.OS === "ios" ? "Georgia" : "serif", letterSpacing: -1 }, italic: { fontStyle: "italic", color: COLORS.terracotta }, heroBody: { color: COLORS.muted, fontSize: 14, lineHeight: 22, marginTop: 12 }, heroMark: { marginTop: 24, borderTopWidth: 1, borderBottomWidth: 1, borderColor: COLORS.line, paddingVertical: 12 }, heroMarkText: { color: COLORS.sage, fontSize: 9, letterSpacing: 1.2, fontWeight: "700" },
  sectionHeader: { paddingHorizontal: 23, marginTop: 16, marginBottom: 16, flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" }, sectionTitle: { color: COLORS.ink, fontSize: 25, fontFamily: Platform.OS === "ios" ? "Georgia" : "serif", marginTop: 7 }, sectionCount: { color: COLORS.muted, fontSize: 9, letterSpacing: 1 },
  productList: { paddingHorizontal: 18, gap: 14 }, productCard: { backgroundColor: COLORS.white, borderWidth: 1, borderColor: COLORS.line }, productImage: { height: 245, margin: 8, backgroundColor: "#F3EEE6", alignItems: "center", justifyContent: "center" }, productImageRose: { backgroundColor: "#F3E8E4" }, productImageSage: { backgroundColor: "#EAEEE7" }, artImage: { width: "82%", height: "82%" }, productIndex: { position: "absolute", right: 10, bottom: 8, color: COLORS.muted, fontSize: 10 }, productDetails: { padding: 12, paddingTop: 4, flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", gap: 8 }, productCopy: { flex: 1 }, productCategory: { color: COLORS.terracotta, fontSize: 8, fontWeight: "700", letterSpacing: 1.1 }, productName: { color: COLORS.ink, fontSize: 17, fontFamily: Platform.OS === "ios" ? "Georgia" : "serif", marginTop: 5 }, productDescription: { color: COLORS.muted, fontSize: 11, marginTop: 4 }, productPrice: { color: COLORS.ink, fontSize: 14, fontWeight: "700", marginTop: 8 }, addButton: { backgroundColor: COLORS.ink, paddingHorizontal: 12, paddingVertical: 11, marginBottom: 2 }, addButtonText: { color: COLORS.white, fontSize: 9, letterSpacing: 0.7, fontWeight: "700" },
  studioCard: { margin: 20, marginTop: 29, backgroundColor: COLORS.card, padding: 20 }, studioTitle: { color: COLORS.ink, fontSize: 31, lineHeight: 35, marginTop: 12, fontFamily: Platform.OS === "ios" ? "Georgia" : "serif" }, outlineButton: { alignSelf: "flex-start", borderWidth: 1, borderColor: COLORS.ink, paddingHorizontal: 14, paddingVertical: 13, marginTop: 17 }, outlineButtonText: { color: COLORS.ink, fontSize: 9, fontWeight: "700", letterSpacing: 0.8 },
  pageIntro: { paddingHorizontal: 23, paddingTop: 30, paddingBottom: 23 }, pageTitle: { color: COLORS.ink, fontSize: 39, lineHeight: 46, marginTop: 12, fontFamily: Platform.OS === "ios" ? "Georgia" : "serif" },
  syncBanner: { backgroundColor: "#E9EDE5", marginHorizontal: 18, padding: 13, flexDirection: "row", gap: 9, alignItems: "center", marginBottom: 14 }, syncBannerError: { backgroundColor: "#F5E6E0" }, syncDot: { color: COLORS.sage, fontSize: 16 }, syncText: { color: COLORS.ink, fontSize: 11, flex: 1, lineHeight: 16 },
  cartRow: { marginHorizontal: 18, paddingVertical: 12, borderBottomWidth: 1, borderColor: COLORS.line, flexDirection: "row", alignItems: "center", gap: 11 }, cartThumb: { width: 76, height: 76, backgroundColor: COLORS.card, alignItems: "center", justifyContent: "center" }, cartImage: { width: 65, height: 65 }, cartInfo: { flex: 1 }, quantityRow: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 8 }, quantityButton: { width: 26, height: 26, borderWidth: 1, borderColor: COLORS.line, alignItems: "center", justifyContent: "center" }, quantityText: { color: COLORS.ink, fontSize: 15 }, lineTotal: { color: COLORS.ink, fontSize: 12, fontWeight: "700" }, totalRow: { marginHorizontal: 18, paddingVertical: 17, borderBottomWidth: 1, borderTopWidth: 1, borderColor: COLORS.line, flexDirection: "row", justifyContent: "space-between", marginTop: 13 }, totalLabel: { color: COLORS.muted, fontSize: 9, letterSpacing: 1.2, fontWeight: "700" }, totalAmount: { color: COLORS.ink, fontSize: 18, fontWeight: "700" },
  emptyState: { margin: 18, padding: 24, backgroundColor: COLORS.white, alignItems: "center", borderWidth: 1, borderColor: COLORS.line }, emptyMark: { color: COLORS.terracotta, fontSize: 31 }, emptyTitle: { color: COLORS.ink, fontSize: 23, marginTop: 10, fontFamily: Platform.OS === "ios" ? "Georgia" : "serif" },
  formCard: { margin: 18, marginTop: 17, backgroundColor: COLORS.white, borderWidth: 1, borderColor: COLORS.line, padding: 16 }, formTitle: { color: COLORS.ink, fontSize: 20, marginBottom: 16, fontFamily: Platform.OS === "ios" ? "Georgia" : "serif" }, field: { marginBottom: 13 }, fieldLabel: { color: COLORS.ink, fontSize: 10, fontWeight: "600", marginBottom: 6 }, input: { minHeight: 46, borderWidth: 1, borderColor: COLORS.line, paddingHorizontal: 12, paddingVertical: 10, color: COLORS.ink, backgroundColor: COLORS.paper, fontSize: 13 }, inputMulti: { minHeight: 88, textAlignVertical: "top" }, paymentNote: { color: COLORS.muted, fontSize: 11, lineHeight: 17, marginVertical: 5 }, darkButton: { backgroundColor: COLORS.ink, paddingVertical: 15, paddingHorizontal: 17, alignItems: "center", marginTop: 14 }, darkButtonText: { color: COLORS.white, fontWeight: "700", fontSize: 10, letterSpacing: 0.9 }, disabledButton: { opacity: 0.55 },
  choiceRow: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginBottom: 16 }, choice: { borderWidth: 1, borderColor: COLORS.line, paddingHorizontal: 11, paddingVertical: 9 }, choiceSelected: { borderColor: COLORS.terracotta, backgroundColor: "#F7EDE8" }, choiceText: { color: COLORS.muted, fontSize: 10 }, choiceTextSelected: { color: COLORS.terracotta, fontWeight: "700" },
  successCard: { margin: 18, padding: 22, alignItems: "center", backgroundColor: COLORS.white, borderWidth: 1, borderColor: COLORS.line }, successMark: { width: 43, height: 43, borderRadius: 22, overflow: "hidden", textAlign: "center", textAlignVertical: "center", backgroundColor: "#E9EDE5", color: COLORS.sage, fontSize: 22 }, errorText: { marginHorizontal: 18, marginVertical: 10, color: COLORS.error, fontSize: 12, lineHeight: 18 }, toast: { marginHorizontal: 18, marginTop: 12, padding: 13, backgroundColor: COLORS.ink }, toastText: { color: COLORS.white, fontSize: 11, lineHeight: 16 }, footer: { borderTopWidth: 1, borderColor: COLORS.line, marginHorizontal: 18, marginTop: 20, paddingTop: 12, flexDirection: "row", justifyContent: "space-between" }, footerText: { color: COLORS.muted, fontSize: 8, letterSpacing: 0.8 },
  tabBar: { borderTopWidth: 1, borderColor: COLORS.line, backgroundColor: COLORS.paper, paddingHorizontal: 6, paddingTop: 8, paddingBottom: Platform.OS === "ios" ? 8 : 12, flexDirection: "row", justifyContent: "space-around" }, tabButton: { alignItems: "center", minWidth: 62, paddingVertical: 4 }, tabLabel: { color: COLORS.muted, fontSize: 9, fontWeight: "600", letterSpacing: 0.4 }, tabLabelActive: { color: COLORS.terracotta }, tabUnderline: { height: 2, width: 18, backgroundColor: "transparent", marginTop: 6 }, tabUnderlineActive: { backgroundColor: COLORS.terracotta },
});
