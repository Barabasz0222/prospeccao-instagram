/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["@libsql/client", "playwright"],
};

export default nextConfig;
