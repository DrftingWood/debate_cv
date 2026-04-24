import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { google } from 'googleapis';
import { extractAll } from './gmail.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);

const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];

function makeOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI,
  );
}

const app = express();

app.use(
  session({
    secret: process.env.SESSION_SECRET || 'dev-only-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax' },
  }),
);

app.use(express.urlencoded({ extended: false }));

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

app.get('/auth/google', (_req, res) => {
  const url = makeOAuthClient().generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
  });
  res.redirect(url);
});

app.get('/auth/google/callback', async (req, res, next) => {
  try {
    const code = req.query.code;
    if (!code) return res.status(400).send('Missing authorization code.');
    const client = makeOAuthClient();
    const { tokens } = await client.getToken(code);
    req.session.tokens = tokens;
    res.redirect('/extract/view');
  } catch (err) {
    next(err);
  }
});

function requireAuth(req, res, next) {
  if (!req.session.tokens) {
    return res.status(401).send('Connect Gmail first at /');
  }
  const client = makeOAuthClient();
  client.setCredentials(req.session.tokens);
  req.oauthClient = client;
  next();
}

app.get('/extract', requireAuth, async (req, res, next) => {
  try {
    const result = await extractAll(req.oauthClient);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

app.get('/extract/view', requireAuth, async (req, res, next) => {
  try {
    const result = await extractAll(req.oauthClient);
    res.send(renderResults(result));
  } catch (err) {
    next(err);
  }
});

app.post('/disconnect', async (req, res, next) => {
  try {
    if (req.session.tokens && req.session.tokens.access_token) {
      const client = makeOAuthClient();
      client.setCredentials(req.session.tokens);
      try {
        await client.revokeToken(req.session.tokens.access_token);
      } catch {
        /* token may already be expired */
      }
    }
    req.session.destroy(() => res.redirect('/'));
  } catch (err) {
    next(err);
  }
});

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderResults(result) {
  const rows = result.urls
    .map(
      (r) => `
      <tr>
        <td><a href="${escapeHtml(r.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(r.url)}</a></td>
        <td>${escapeHtml(r.tournament)}</td>
        <td>${escapeHtml(r.host)}</td>
        <td>${escapeHtml(r.messageDate || '')}</td>
        <td>${escapeHtml(r.subject || '')}</td>
      </tr>`,
    )
    .join('');

  return `<!doctype html><html><head><meta charset="utf-8" />
    <title>Extracted private URLs</title>
    <style>
      body { font-family: system-ui, sans-serif; max-width: 1100px; margin: 2rem auto; padding: 0 1rem; }
      table { width: 100%; border-collapse: collapse; font-size: 14px; }
      th, td { border-bottom: 1px solid #eee; padding: 0.5rem; text-align: left; vertical-align: top; }
      th { background: #f4f4f4; }
      .summary { background: #f9f9f9; padding: 1rem; border-radius: 6px; margin-bottom: 1rem; }
      form { display: inline; }
      button { padding: 0.5rem 1rem; }
    </style></head><body>
    <h1>Extracted private URLs</h1>
    <div class="summary">
      <div>Messages scanned: <strong>${result.scanned}</strong></div>
      <div>Private URLs found: <strong>${result.total}</strong></div>
      <div>By host: <code>${escapeHtml(JSON.stringify(result.perHost))}</code></div>
      <div>By tournament: <code>${escapeHtml(JSON.stringify(result.perTournament))}</code></div>
    </div>
    <form method="POST" action="/disconnect">
      <button type="submit">Disconnect Gmail</button>
    </form>
    <table>
      <thead><tr><th>URL</th><th>Tournament</th><th>Host</th><th>Date</th><th>Subject</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5">No private URLs found.</td></tr>'}</tbody>
    </table>
  </body></html>`;
}

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).send('Internal error. Check server logs.');
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
