import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { isUtilityPage } from './src/lib/structured-data.mjs';

export default defineConfig({
  site: process.env.SITE_URL || 'https://devreads.fyi',
  base: process.env.BASE_PATH || '/',
  compressHTML: true,
  build: { format: 'directory' },
  integrations: [sitemap({ filter: (page) => !isUtilityPage(new URL(page).pathname, process.env.BASE_PATH || '/') })],
});
