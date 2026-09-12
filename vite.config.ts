import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// robots.txt and sitemap.xml need the real domain, and a sitemap pointing at the wrong one is
// worse than none at all — search engines fetch it and index a site that isn't yours. So the
// domain comes from VITE_SITE_URL and nothing here invents a fallback: with it set, everything
// is emitted with absolute URLs; without it, the sitemap is simply not written and robots.txt
// ships without a Sitemap line. Both states are correct, neither can be wrong.
function seoPlugin(siteUrl: string): Plugin {
  const base = siteUrl.replace(/\/+$/, '');
  return {
    name: 'oneflow-seo',
    transformIndexHtml(html) {
      if (!base) return html;
      return html
        .replace(/content="\.\/(og-image\.png)"/g, `content="${base}/$1"`)
        .replace(
          '</head>',
          `  <meta property="og:url" content="${base}/" />\n` +
            `    <link rel="canonical" href="${base}/" />\n  </head>`
        );
    },
    generateBundle() {
      const robots = [
        'User-agent: *',
        'Allow: /',
        ...(base ? ['', `Sitemap: ${base}/sitemap.xml`] : []),
        '',
      ].join('\n');
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: robots });

      if (!base) return;
      // One entry, because the app is one URL: everything happens without navigating. Listing
      // routes that don't exist would just produce crawl errors.
      const sitemap =
        '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
        `  <url>\n    <loc>${base}/</loc>\n    <changefreq>weekly</changefreq>\n` +
        '    <priority>1.0</priority>\n  </url>\n' +
        '</urlset>\n';
      this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: sitemap });
    },
  };
}

export default defineConfig(({ mode }) => {
  // Empty prefix: VITE_SITE_URL is only read here, at build time, and never reaches the client.
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react(), seoPlugin(env.VITE_SITE_URL ?? '')],
    base: './',
    server: {
      port: 5173,
      strictPort: true,
    },
    build: {
      outDir: 'dist',
    },
  };
});
