import type { Metadata, Viewport } from "next";
import { Oswald, Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";

const oswald = Oswald({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "NightWatch — The Security Guard for Base Builders",
  description:
    "Grounded smart contract and repository security. Real static analysis, specialist AI review, adversarial verification, and 24/7 onchain guarding.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#1c1d1f",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${oswald.variable} ${inter.variable} dark`}>
      <body className="min-h-screen bg-[#1c1d1f] text-[#efebe3] font-sans antialiased selection:bg-[#e8741f] selection:text-[#1c1d1f] relative overflow-x-hidden">
        {/* Faint thin line-art wave curves (SVG, ~6% opacity) */}
        <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden opacity-[0.06]" aria-hidden="true">
          <svg className="w-full h-full" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none" viewBox="0 0 1440 900">
            <path d="M-100,150 C300,50 600,280 1000,120 C1250,20 1450,200 1600,140" fill="none" stroke="#efebe3" strokeWidth="1" />
            <path d="M-100,320 C250,220 550,450 950,280 C1250,150 1420,380 1600,300" fill="none" stroke="#efebe3" strokeWidth="1" />
            <path d="M-100,510 C320,400 680,620 1050,450 C1300,330 1480,560 1600,480" fill="none" stroke="#efebe3" strokeWidth="1" />
            <path d="M-100,700 C280,580 620,800 1000,630 C1280,500 1450,720 1600,650" fill="none" stroke="#efebe3" strokeWidth="1" />
            <path d="M-100,850 C350,750 720,950 1100,790 C1320,680 1490,880 1600,820" fill="none" stroke="#efebe3" strokeWidth="1" />
          </svg>
        </div>

        <div className="relative z-10">
          <Providers>{children}</Providers>
        </div>
      </body>
    </html>
  );
}
