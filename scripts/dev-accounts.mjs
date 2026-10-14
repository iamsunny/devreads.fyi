import { spawn } from 'node:child_process';
const child = spawn(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'dev', '--local', '--port', '8787', '--persist-to', '.wrangler/dev-local', '--var', 'AUTH_MODE:local', '--var', 'AUTH_BASE_URL:http://localhost:8787', '--var', 'AUTH_ENABLED:true', '--var', 'AUTH_PROVIDERS:google,github,linkedin', '--var', 'COUNTER_MODE:preview'], { stdio: 'inherit' });
child.on('exit', code => process.exit(code ?? 1));
