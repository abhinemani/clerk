/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Keep the DB drivers out of the bundle (PGlite ships WASM; postgres is native).
  serverExternalPackages: ["@electric-sql/pglite", "postgres"],
  experimental: {
    // Server Actions are used for staff/portal mutations (§4). 100mb admits
    // mailbox exports (mbox/ZIP-of-eml); individual FILE caps stay 25 MB at
    // the action layer.
    serverActions: { bodySizeLimit: "100mb" },
  },
};

export default nextConfig;
