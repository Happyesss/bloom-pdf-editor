import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "./theme/ThemeProvider";

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
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
