/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    instrumentationHook: true,
    serverComponentsExternalPackages: ["bcryptjs", "jsonwebtoken"],
  },
};

module.exports = nextConfig;
