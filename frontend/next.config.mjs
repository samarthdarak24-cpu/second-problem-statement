/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['three'],

  /*
   * Static export — always enabled.
   *
   * Every page is a client component; there are no API routes, no server
   * actions and no `next/headers` usage. The whole simulation runs in the
   * browser, so the build always emits a directory of static files (`out/`)
   * that any static host (Render, Vercel static, Netlify, GitHub Pages) can
   * serve directly — free, no cold start, no server to manage.
   *
   * Note: `next start` will not work after this build — use a static host or
   * `npx serve out` locally to preview the production bundle.
   */
  output: 'export',

  images: {
    /*
     * Required by `output: 'export'`: Next's default image optimiser is a
     * server-side endpoint that a static export cannot provide.
     */
    unoptimized: true,
  },

  /*
   * Emit `dashboard/index.html` rather than `dashboard.html`, so every route
   * is a real directory with an index file. Static hosts serve those directly
   * without needing a rewrite rule per path.
   */
  trailingSlash: true,

  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;

