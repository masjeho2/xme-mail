import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "xme-mail | Email Panel",
  description: "Multi-tenant email panel for x-me.cloud (Resend + Cloudflare)",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body className="antialiased min-h-screen">{children}</body>
    </html>
  );
}
