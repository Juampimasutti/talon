import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  // La app es operativa y depende de la sesión en cada pantalla.
  // El cache vive en TanStack Query y en Cache-Control de los catálogos,
  // donde se puede invalidar al guardar. El shell estático de Cache Components
  // pelea con las cookies de sesión y podría servir un comprobante viejo.
  cacheComponents: false,
  devIndicators: false,
  images: {
    formats: ["image/webp", "image/avif"],
  },
  async headers() {
    return [{ source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache" }] }];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
