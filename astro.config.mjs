import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: process.env.SITE_URL || 'https://devreads.fyi',
  base: process.env.BASE_PATH || '/',
  compressHTML: true,
  build: { format: 'directory' },
  integrations: [sitemap()],
});
