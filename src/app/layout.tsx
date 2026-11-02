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
  "All-in-one cricket tournament app for India: player registration, IPL-style auction, fixtures and points table, ball-by-ball live scoring and stats, on any phone.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: `${APP_NAME} - All-in-one cricket tournament app: auction, fixtures & live scoring`, template: `%s | ${APP_NAME}` },
  description,
  keywords: ["cricket tournament app", "cricket tournament management", "live cricket scoring app", "cricket fixtures maker", "cricket auction app", "local cricket league"],
  openGraph: { type: "website", siteName: APP_NAME, locale: "en_IN", title: `${APP_NAME} - All-in-one cricket tournament app`, description },
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
