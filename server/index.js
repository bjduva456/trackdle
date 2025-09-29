const express = require('express');
const dotenv = require('dotenv');
const request = require('request');
const path = require('path');

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

const spotifyClientId = process.env.SPOTIFY_CLIENT_ID;
const spotifyClientSecret = process.env.SPOTIFY_CLIENT_SECRET;

app.get('/auth/login', (req, res) => {
  const scopes = [
    'streaming',
    'user-read-email',
    'user-read-private',
    'playlist-read-private',
    'playlist-read-collaborative',
  ].join(' ');
  const redirectUri = 'http://127.0.0.1:3000/auth/callback';
  const state = Math.random().toString(36).substring(2, 15);
  const authQuery = new URLSearchParams({
    response_type: 'code',
    client_id: spotifyClientId,
    scope: scopes,
    redirect_uri: redirectUri,
    state: state
  });
  const url = `https://accounts.spotify.com/authorize?${authQuery.toString()}`;
  res.redirect(url);
});

app.get('/auth/callback', (req, res) => {
  const code = req.query.code || null;
  const redirectUri = 'http://127.0.0.1:3000/auth/callback';

  const tokenOptions = {
    url: 'https://accounts.spotify.com/api/token',
    form: {
      code: code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code'
    },
    headers: {
      Authorization: 'Basic ' + Buffer.from(spotifyClientId + ':' + spotifyClientSecret).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    json: true
  };

  request.post(tokenOptions, (error, response, body) => {
    if (!error && response.statusCode === 200) {
      const access_token = body.access_token;
      const refresh_token = body.refresh_token;
      // maybe change later, for now just send to frontend
      res.redirect(`/token?access_token=${access_token}`);
    } else {
      res.status(response.statusCode).json(body);
    }
  });
});

// an endpoint the frontend can hit to get the token
app.get('/token', (req, res) => {
  const access_token = req.query.access_token;
  res.json({ access_token });
});

// (optional) serve React build in production
app.use(express.static(path.join(__dirname, '../build')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../build/index.html'));
});

app.listen(port, () => {
  console.log(`Server listening at http://127.0.0.1:${port}`);
});
