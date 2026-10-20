import type { Metadata } from "next";
import { Providers } from "@/components/providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Talón",
  description: "Gestión comercial para cualquier rubro. Hecha en la Argentina.",
  manifest: "/manifest.webmanifest",
  applicationName: "Talón",
  appleWebApp: { capable: true, title: "Talón", statusBarStyle: "default" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-AR" className="h-full antialiased">
      <body className="min-h-full">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
