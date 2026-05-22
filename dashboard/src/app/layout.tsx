import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "BunsMS - MapleStory v83 Guided by AI",
  description: "A classic MapleStory v83 private server with an omniscient AI Game Master. The Baker watches, adapts, and reshapes the world in real time.",
  icons: { icon: "/logo.png", apple: "/logo.png" },
  openGraph: {
    title: "BunsMS - MapleStory v83 Guided by AI",
    description: "The Baker has buns in the oven and eyes on the whole world. A MapleStory v83 server where a cheeky AI oracle kneads rates, drops, and events fresh daily. 🍑",
    images: [{ url: "/logo.png", width: 1024, height: 1024 }],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.className} dark`}>
      <body className="min-h-screen bg-bg-primary text-text-primary antialiased">
        {children}
      </body>
    </html>
  );
}
