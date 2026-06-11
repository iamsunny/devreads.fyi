import { defineConfig } from 'astro/config';

import cloudflare from "@astrojs/cloudflare";

export default defineConfig({
  site: process.env.SITE_URL || (process.env.CF_PAGES ? 'https://devreads.fyi' : 'http://localhost:4321'),
  base: process.env.BASE_PATH || '/',
  build: { format: 'directory' },
  adapter: cloudflare()
});