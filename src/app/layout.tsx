import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { Toaster } from "@/components/toast";
import { SetupBanner } from "@/components/setup-banner";
import { APP_NAME, SITE_URL } from "@/lib/config";
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

const description =
  "Cricket tournament app for India: player registration, live player auction, fixtures, ball-by-ball live scoring and stats, on any phone.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: `${APP_NAME} - Cricket auction app, fixtures & live scoring`, template: `%s | ${APP_NAME}` },
  description,
  keywords: ["cricket auction app", "cricket player auction", "cricket tournament app", "live cricket scoring", "local cricket league", "IPL style auction"],
  openGraph: { type: "website", siteName: APP_NAME, locale: "en_IN", title: `${APP_NAME} - Cricket auction app`, description },
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
