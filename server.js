require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const axios = require('axios');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret',
  resave: false,
  saveUninitialized: true,
}));

// Serve static frontend
app.use(express.static(path.join(__dirname, 'public')));

// Helpers for PKCE
function base64URLEncode(str) {
  return str.toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest();
}

async function refreshAccessToken(req) {
  const refreshToken = req.session.tokens && req.session.tokens.refresh_token;
  if (!refreshToken) throw new Error('no_refresh_token');

  const tokenUrl = 'https://accounts.spotify.com/api/token';
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: process.env.SPOTIFY_CLIENT_ID,
  });

  const response = await axios.post(tokenUrl, params.toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  const data = response.data;
  // update session tokens
  req.session.tokens.access_token = data.access_token;
  req.session.tokens.expires_in = data.expires_in || req.session.tokens.expires_in;
  req.session.tokens.expires_at = Date.now() + ((data.expires_in || req.session.tokens.expires_in) * 1000);
  // Spotify may or may not return a new refresh_token
  if (data.refresh_token) req.session.tokens.refresh_token = data.refresh_token;
  return req.session.tokens.access_token;
}

async function ensureAccessToken(req) {
  if (!req.session.tokens) throw new Error('not_logged_in');
  const now = Date.now();
  // refresh if token will expire in next 60 seconds
  if (!req.session.tokens.expires_at || (req.session.tokens.expires_at - now) < 60000) {
    return refreshAccessToken(req);
  }
  return req.session.tokens.access_token;
}

// Start OAuth login
app.get('/login', (req, res) => {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI || `http://127.0.0.1:${PORT}/callback`;
  if (!clientId) return res.status(500).send('Missing SPOTIFY_CLIENT_ID env var');

  const codeVerifier = base64URLEncode(crypto.randomBytes(64));
  const codeChallenge = base64URLEncode(sha256(codeVerifier));
  req.session.codeVerifier = codeVerifier;
  // persist redirect URI so the same value is used during token exchange
  req.session.redirectUri = redirectUri;

  const state = crypto.randomBytes(16).toString('hex');
  req.session.oauthState = state;

  const scope = 'user-read-email playlist-read-private streaming user-modify-playback-state user-read-playback-state';
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    code_challenge_method: 'S256',
    code_challenge: codeChallenge,
    state,
    scope,
  });

  res.redirect(`https://accounts.spotify.com/authorize?${params.toString()}`);
});

// Callback handler: exchange code for tokens
async function handleAuthCallback(req, res) {
  const { code, state } = req.query;
  if (!code || !state || state !== req.session.oauthState) return res.status(400).send('Invalid state');

  const tokenUrl = 'https://accounts.spotify.com/api/token';
  // use the exact redirect URI that was used in /login (stored in session)
  const redirectUri = req.session.redirectUri || process.env.SPOTIFY_REDIRECT_URI || `http://127.0.0.1:${PORT}/callback`;

  try {
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: process.env.SPOTIFY_CLIENT_ID,
      code_verifier: req.session.codeVerifier,
    });

    const response = await axios.post(tokenUrl, params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    // store tokens and expiry timestamp
    const data = response.data;
    req.session.tokens = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_in: data.expires_in,
      // expires_at is a ms timestamp
      expires_at: Date.now() + (data.expires_in * 1000),
    };
    res.redirect('/');
  } catch (err) {
    console.error('token error', err.response ? err.response.data : err.message);
    // If Spotify returned an error response, show a helpful message
    if (err.response && err.response.data && err.response.data.error === 'invalid_client') {
      return res.status(400).send(`Invalid client or redirect URI. Make sure the Redirect URI configured in your Spotify app matches the redirect URI used during login: ${redirectUri}`);
    }
    res.status(500).send('Token exchange failed');
  }
}

// Register callback route aliases so redirect URI registered in Spotify can be matched
app.get('/callback', handleAuthCallback);
app.get('/auth/callback', handleAuthCallback);

// Logout: destroy session and redirect to home
app.get('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) console.error('logout error', err);
    res.redirect('/');
  });
});

// Return access token to frontend
app.get('/token', (req, res) => {
  if (!req.session.tokens) return res.status(401).json({ error: 'not_logged_in' });
  // ensure token is refreshed if needed
  ensureAccessToken(req).then(access_token => {
    res.json({ access_token, expires_in: req.session.tokens.expires_in });
  }).catch(err => {
    console.error('token ensure error', err);
    res.status(500).json({ error: 'token_error' });
  });
});

// API: fetch playlist tracks from Spotify
app.post('/api/playlist', async (req, res) => {
  const { playlistUrl } = req.body;
  if (!req.session.tokens) return res.status(401).json({ error: 'not_logged_in' });
  if (!playlistUrl) return res.status(400).json({ error: 'missing_playlistUrl' });

  // Extract playlist id
  const m = playlistUrl.match(/playlist\/([a-zA-Z0-9]+)/);
  if (!m) return res.status(400).json({ error: 'invalid_playlist_url' });
  const playlistId = m[1];

  try {
    // make sure access token is valid
    await ensureAccessToken(req);
    const resp = await axios.get(`https://api.spotify.com/v1/playlists/${playlistId}/tracks`, {
      headers: { Authorization: `Bearer ${req.session.tokens.access_token}` },
      params: { fields: 'items(track(id,name,artists(name),preview_url,uri))', limit: 100 },
    });

    const tracks = resp.data.items
      .map(i => i.track)
      .filter(t => t && t.id)
      .map(t => ({ id: t.id, name: t.name, artists: t.artists.map(a => a.name).join(', '), preview_url: t.preview_url, uri: t.uri }));

    res.json({ tracks });
  } catch (err) {
    console.error('playlist fetch error', err.response ? err.response.data : err.message);
    res.status(500).json({ error: 'failed_fetch' });
  }
});

// API: get current user's profile
app.get('/api/me', async (req, res) => {
  if (!req.session.tokens) return res.status(401).json({ error: 'not_logged_in' });
  try {
    await ensureAccessToken(req);
    const resp = await axios.get('https://api.spotify.com/v1/me', {
      headers: { Authorization: `Bearer ${req.session.tokens.access_token}` },
    });
    res.json(resp.data);
  } catch (err) {
    console.error('me fetch error', err.response ? err.response.data : err.message);
    res.status(500).json({ error: 'failed_fetch' });
  }
});

app.listen(PORT, () => console.log(`Server running on http://127.0.0.1:${PORT}`));
