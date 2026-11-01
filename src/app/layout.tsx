import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { Toaster } from "@/components/toast";
import { SetupBanner } from "@/components/setup-banner";
import { APP_NAME } from "@/lib/config";
import "./globals.css";

const geistSans = localFont({
  src: "../../node_modules/next/dist/next-devtools/server/font/geist-latin.woff2",
  display: "swap",
  variable: "--font-geist-sans",
});

const geistMono = localFont({
  src: "../../node_modules/next/dist/next-devtools/server/font/geist-mono-latin.woff2",
  display: "swap",
  variable: "--font-geist-mono",
});

export const metadata: Metadata = {
  title: { default: `${APP_NAME} - Cricket auctions, fixtures & live scoring`, template: `%s | ${APP_NAME}` },
  description: "Run your local cricket tournament: player registration, live auction, fixtures, ball-by-ball scoring and stats, on any phone.",
};

export const viewport: Viewport = {
  themeColor: "#059669",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans">
        <SetupBanner />
        {children}
        <Toaster />
      </body>
    </html>
  );
}
