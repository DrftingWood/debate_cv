import 'dotenv/config';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import open from 'open';
import { google } from 'googleapis';
import { extractAll } from '../src/gmail.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const REDIRECT_PATH = '/auth/google/callback';
const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing ${name} in .env. Copy .env.example to .env and fill it in.`);
    process.exit(1);
  }
  return v;
}

const clientId = requireEnv('GOOGLE_CLIENT_ID');
const clientSecret = requireEnv('GOOGLE_CLIENT_SECRET');
const redirectUri = process.env.GOOGLE_REDIRECT_URI || `http://localhost:${PORT}${REDIRECT_PATH}`;

const oauthClient = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

const consentUrl = oauthClient.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent',
  scope: SCOPES,
});

async function handleCallback(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname !== REDIRECT_PATH) {
    res.writeHead(404).end('Not found');
    return null;
  }
  const code = url.searchParams.get('code');
  if (!code) {
    res.writeHead(400).end('Missing authorization code.');
    return null;
  }
  const { tokens } = await oauthClient.getToken(code);
  oauthClient.setCredentials(tokens);
  res.writeHead(200, { 'Content-Type': 'text/html' }).end(
    '<p>Authorized. You can close this tab and return to the terminal.</p>',
  );
  return tokens;
}

function waitForAuth(server) {
  return new Promise((resolve, reject) => {
    server.on('request', async (req, res) => {
      try {
        const tokens = await handleCallback(req, res);
        if (tokens) resolve(tokens);
      } catch (err) {
        res.writeHead(500).end('Error during OAuth callback. See terminal.');
        reject(err);
      }
    });
  });
}

async function writeOutput(result) {
  const outDir = path.resolve(__dirname, '..', 'data');
  await fs.mkdir(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = path.join(outDir, `private-urls-${stamp}.json`);
  await fs.writeFile(outPath, JSON.stringify(result, null, 2));
  return outPath;
}

async function main() {
  const server = http.createServer();
  await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve));
  console.log(`Waiting for Gmail consent on http://localhost:${PORT}${REDIRECT_PATH}`);
  console.log('Opening consent page in your browser...');
  console.log(`If it doesn't open, paste this URL manually:\n  ${consentUrl}`);

  const authPromise = waitForAuth(server);
  await open(consentUrl).catch(() => {
    /* open might fail in a headless env; the printed URL is the fallback */
  });

  await authPromise;
  server.close();

  console.log('Authorized. Scanning Gmail for Tabbycat private URLs...');
  const result = await extractAll(oauthClient);

  const outPath = await writeOutput(result);
  console.log('');
  console.log(`Messages scanned: ${result.scanned}`);
  console.log(`Private URLs found: ${result.total}`);
  console.log('By host:', result.perHost);
  console.log('By tournament:', result.perTournament);
  console.log(`Saved to: ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
