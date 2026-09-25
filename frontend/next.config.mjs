/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['three'],

  /*
   * Static export.
   *
   * Every page here is a client component, and there are no API routes, no
   * server actions and no `next/headers` usage — the whole simulation runs in
   * the browser. Nothing needs a Node server at request time, so the app is
   * exported as plain HTML/CSS/JS and hosted as a static site: free, no cold
   * start, and no service to wake before a demo.
   *
   * The trade is that `next start` no longer works — the build emits a
   * directory of files (`out/`) instead of a server. This app does not notice.
   */
  output: 'export',

  images: {
    /*
     * Required by `output: 'export'`: Next's default image optimiser is a
     * server-side endpoint, which a static export cannot provide. The four
     * images in `public/images/` are already pre-sized in both a full and a
     * `-sm` variant, so there is nothing to optimise per request anyway.
     */
    unoptimized: true,
  },

  /*
   * Emit `dashboard/index.html` rather than `dashboard.html`, so every route is
   * a real directory with an index file. Static hosts serve those directly,
   * without needing a rewrite rule per path.
   */
  trailingSlash: true,

  eslint: {
    // Lint is run explicitly via `npm run lint`; keep production builds fast
    // and independent of stylistic lint failures.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
