import type { Metadata, Viewport } from "next";
import { Caveat, Inter } from "next/font/google";
import "./globals.css";
import { ThemeProvider, themeInitScript } from "./theme/ThemeProvider";

export const metadata: Metadata = {
  metadataBase: new URL("https://editor.bloompdf.app"),
  title: "BloomPDF Editor — Edit PDFs right in your browser",
  description:
    "Edit text, images, forms and signatures in any PDF — free, open source and 100% private. Your file never leaves your device.",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon-192.png", type: "image/png", sizes: "192x192" },
      { url: "/icon-32.png", type: "image/png", sizes: "32x32" },
      { url: "/logo.png", type: "image/png" },
    ],
    shortcut: "/favicon.ico",
    apple: "/apple-icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FAF8F6" },
    { media: "(prefers-color-scheme: dark)", color: "#07080B" },
  ],
};

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const caveat = Caveat({ subsets: ["latin"], variable: "--font-hand", weight: ["500", "700"], display: "swap" });

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning className={`${inter.variable} ${caveat.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="font-sans antialiased">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
