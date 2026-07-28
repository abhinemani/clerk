/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Keep the DB drivers out of the bundle (PGlite ships WASM; postgres is native).
  serverExternalPackages: ["@electric-sql/pglite", "postgres"],
  experimental: {
    // Server Actions are used for staff/portal mutations (§4).
    serverActions: { bodySizeLimit: "25mb" },
  },
};

export default nextConfig;
