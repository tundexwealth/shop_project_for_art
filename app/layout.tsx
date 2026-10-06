import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Artini — Art, made one thread at a time",
  description: "Thoughtful string art, made by hand in Lagos. Find a piece for your home or bring your team together for a creative workshop.",
  icons: { icon: "/artini-logo.png" }
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
