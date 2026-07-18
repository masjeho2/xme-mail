import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "xme-mail | Email Panel",
  description: "Multi-tenant email panel for x-me.cloud (Resend + Cloudflare)",
  applicationName: "xme-mail",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "xme-mail",
  },
  icons: {
    icon: [
      { url: "/icons/icon-32.png?v=3", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon-192.png?v=3", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png?v=3", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png?v=3", sizes: "180x180", type: "image/png" }],
    shortcut: ["/icons/icon-192.png?v=3"],
  },
};

export const viewport: Viewport = {
  themeColor: "#0c1320",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body className="antialiased min-h-screen">{children}</body>
    </html>
  );
}
