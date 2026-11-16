import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { connection } from "next/server";

import { Toaster } from "@/components/toast";
import { fontVariables } from "@/fonts";
import { COLOR_SCHEME_COOKIE, parseColorScheme } from "@/lib/ui-preferences";

import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Dossier", template: "%s · Dossier" },
  description: "Your job search, on your server.",
  appleWebApp: {
    capable: true,
    title: "Dossier",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#eeebe4" },
    { media: "(prefers-color-scheme: dark)", color: "#1a1917" },
  ],
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Every page renders per request: its scripts carry that request's CSP nonce (E11-5).
  await connection();
  // Light or dark as chosen in the sidebar; without a choice, the system's.
  const scheme = parseColorScheme((await cookies()).get(COLOR_SCHEME_COOKIE)?.value);
  return (
    <html lang="en" data-theme={scheme} className={`${fontVariables} h-full antialiased`}>
      <body className="min-h-full">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
