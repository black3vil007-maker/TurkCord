const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

try {
  console.log('[Build] 1/3 Installing client dependencies...');
  execSync('npm install', { cwd: path.join(__dirname, 'client'), stdio: 'inherit' });

  console.log('[Build] 2/3 Building client with Vite...');
  execSync('npm run build', { cwd: path.join(__dirname, 'client'), stdio: 'inherit' });

  console.log('[Build] 3/3 Syncing client/dist to root dist for Vercel...');
  const clientDist = path.join(__dirname, 'client', 'dist');
  const rootDist = path.join(__dirname, 'dist');
  if (fs.existsSync(clientDist)) {
    fs.cpSync(clientDist, rootDist, { recursive: true });
  }
  console.log('[Build] Deployment artifacts ready in both dist/ and client/dist!');
} catch (err) {
  console.error('[Build Error]', err);
  process.exit(1);
}
