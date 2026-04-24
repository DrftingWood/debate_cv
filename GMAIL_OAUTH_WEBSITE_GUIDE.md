# Building a website that reads specific text from a user's Gmail (with consent)

You can build this safely and legally with **Google OAuth 2.0** + the **Gmail API**.

## 1) Architecture (recommended)

1. User clicks **Connect Gmail** on your site.
2. Your backend sends user to Google's OAuth consent screen.
3. User signs in and grants permission.
4. Google redirects back with an authorization code.
5. Your backend exchanges the code for access/refresh tokens.
6. Backend calls Gmail API (`users.messages.list` / `users.messages.get`).
7. Extract only the strings you need.
8. Store only minimal derived data.

> Keep all Gmail API calls on the server side. Do not expose tokens in frontend code.

## 2) Scope selection (important)

Use the smallest scope possible:

- Preferred for parsing content:
  - `https://www.googleapis.com/auth/gmail.readonly`
- Avoid broad scopes unless absolutely required.

## 3) Google Cloud setup

1. Create a Google Cloud project.
2. Enable **Gmail API**.
3. Configure OAuth consent screen (app name, privacy policy, support email).
4. Create OAuth client credentials (Web application).
5. Add redirect URI, e.g.:
   - `https://yourdomain.com/auth/google/callback`
   - `http://localhost:3000/auth/google/callback` (local dev)

If your app is external and requests sensitive scopes like Gmail read access, Google may require verification before broad public use.

## 4) Minimal Node.js backend example

```js
import express from 'express';
import session from 'express-session';
import { google } from 'googleapis';

const app = express();

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
}));

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];

app.get('/auth/google', (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
  });
  res.redirect(url);
});

app.get('/auth/google/callback', async (req, res) => {
  const code = req.query.code;
  const { tokens } = await oauth2Client.getToken(code);
  // Persist tokens encrypted and associated with your user ID.
  req.session.tokens = tokens;
  res.redirect('/connected');
});

app.get('/extract', async (req, res) => {
  if (!req.session.tokens) return res.status(401).send('Connect Gmail first');

  oauth2Client.setCredentials(req.session.tokens);
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  // Example: fetch recent inbox messages
  const list = await gmail.users.messages.list({
    userId: 'me',
    maxResults: 20,
    q: 'in:inbox newer_than:30d',
  });

  const ids = (list.data.messages || []).map(m => m.id);
  const matches = [];

  for (const id of ids) {
    const msg = await gmail.users.messages.get({
      userId: 'me',
      id,
      format: 'full',
    });

    const snippet = msg.data.snippet || '';

    // Replace with your actual pattern
    const found = snippet.match(/[A-Z]{3}-\d{6}/g) || [];
    if (found.length) matches.push({ id, found });
  }

  res.json({ matches });
});

app.listen(3000);
```

## 5) Email body parsing notes

- Gmail message bodies are often MIME multipart.
- Text may be in:
  - `payload.body.data`
  - `payload.parts[].body.data`
- Data is base64url-encoded. Decode before regex extraction.
- Prefer parsing plain text parts over HTML when possible.

## 6) Security and compliance checklist

- Get explicit user consent.
- Publish a clear Privacy Policy and Terms.
- Request minimum scope.
- Encrypt tokens at rest.
- Rotate secrets and use a secret manager.
- Add a “Disconnect Gmail” feature that revokes tokens.
- Respect data deletion requests.
- Log access for audits.

## 7) Product UX best practices

- Explain exactly what you read and why.
- Show a preview of extracted strings before saving.
- Let users delete extracted results.
- Let users choose mailbox filters/labels.

## 8) What not to do

- Do not collect Gmail credentials directly.
- Do not scrape Gmail web UI.
- Do not request `mail.google.com` full scope unless required.

---

If you want, next I can generate a complete starter app (frontend + backend) with:

- Google Sign-In button
- OAuth callback handling
- token storage abstraction
- extraction service with regex rules
- disconnect/revoke endpoint

## 9) Calicotab-specific extraction layer (new foundation)

After Gmail URL discovery, treat each Calicotab private URL as a source document and ingest:

- person identity and role(s) (speaker/judge/team member)
- tournament metadata (name, format, year)
- team tab metrics (team score, team outcomes)
- speaker tab metrics (speaker score, ranking, round/position stats)
- results/outrounds (octo/quarter/semi/final progression)

See:

- `docs/CALICOTAB_DATA_MODEL.md`
- `docs/INGESTION_WORKFLOW.md`
- `sql/001_init_calicotab_schema.sql`
