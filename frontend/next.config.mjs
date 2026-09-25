/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['three'],
  eslint: {
    // Lint is run explicitly via `npm run lint`; keep production builds fast
    // and independent of stylistic lint failures.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
