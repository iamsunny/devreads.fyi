// Renders the branded Open Graph image (1200x630 PNG) to public/og.png.
// Run once locally when the branding changes: node scripts/generate-og.mjs
// The PNG is committed; this script is not part of the CI build.
import sharp from 'sharp';

const svg = `<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
  <rect width="1200" height="630" fill="#0e1411"/>
  <rect x="0" y="622" width="1200" height="8" fill="#3fd68f"/>
  <text x="80" y="290" font-family="Consolas, 'Courier New', monospace" font-size="86" font-weight="bold" fill="#e8f3ec"><tspan fill="#3fd68f">~/</tspan>devreads<tspan fill="#3fd68f">&#9613;</tspan></text>
  <text x="84" y="380" font-family="Consolas, 'Courier New', monospace" font-size="42" fill="#3fd68f">$ tail -f engineering</text>
  <text x="84" y="540" font-family="Consolas, 'Courier New', monospace" font-size="30" fill="#7d9388">every engineering blog, one feed &#183; devreads.fyi</text>
</svg>`;

await sharp(Buffer.from(svg)).png().toFile('public/og.png');
console.log('public/og.png written (1200x630)');
