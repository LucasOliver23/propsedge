/** @type {import('next').NextConfig} */
const nextConfig = {
  // lint roda no CI; não bloqueia o deploy por aviso de estilo
  eslint: { ignoreDuringBuilds: true },
  images: { remotePatterns: [{ protocol: "https", hostname: "a.espncdn.com" }] },
};
export default nextConfig;
