import { build } from 'esbuild';
await build({entryPoints:['src/client/firebase-client.js'],outfile:'dist/firebase-client.js',bundle:true,minify:true,format:'esm',platform:'browser',target:'es2022',legalComments:'eof'});
console.log('Built Firebase Google sign-in client.');
