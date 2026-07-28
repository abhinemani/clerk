/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Server Actions are used for staff/portal mutations (§4).
    serverActions: { bodySizeLimit: "25mb" },
  },
};

export default nextConfig;
