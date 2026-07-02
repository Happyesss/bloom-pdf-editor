import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PDF Editor — Pure TypeScript PDF Engine",
  description:
    "A robust PDF editor built from scratch in pure TypeScript. Zero external dependencies. Adobe Acrobat-class capabilities.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
