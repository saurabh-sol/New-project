import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Space_Grotesk } from "next/font/google";
import { ShowRunner } from "@/components/arena/show-runner";
import { THEME_COLOR, THEME_KEY } from "@/lib/theme-keys";
import { WalletProvider } from "@/components/wallet/wallet-provider";
import { Web3Providers } from "@/components/wallet/web3-providers";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const display = Space_Grotesk({ variable: "--font-display", subsets: ["latin"], weight: ["500", "600", "700"] });

export const metadata: Metadata = {
  title: "The Council · AI Trading Desk",
  description: "Four AI agents (GPT, Claude, Grok and Jev) debate, negotiate and trade together at live prices.",
};

export const viewport: Viewport = { themeColor: THEME_COLOR.dark };

// Runs before the page is painted, so a visitor who chose the light theme never sees the dark one first.
const SHOW_CHOSEN_THEME = `(function(){try{var t=localStorage.getItem(${JSON.stringify(THEME_KEY)});if(t==="light"||t==="dark"){document.documentElement.setAttribute("data-theme",t);var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content",t==="light"?${JSON.stringify(THEME_COLOR.light)}:${JSON.stringify(THEME_COLOR.dark)})}}catch(e){}})()`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable} ${display.variable} h-full antialiased`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: SHOW_CHOSEN_THEME }} />
      </head>
      <body className="flex min-h-full flex-col">
        <div className="backdrop" />
        <Web3Providers>
          <ShowRunner />
          <WalletProvider>{children}</WalletProvider>
        </Web3Providers>
      </body>
    </html>
  );
}
