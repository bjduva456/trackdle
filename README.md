# Trackdle

Trackdle is a Heardle-style music guessing game that lets you build a custom pool of answers from a Spotify playlist. Use any playlist to generate the game's answer set, then guess tracks from short previews and metadata.

## Goal

Provide a lightweight, local web app that lets music fans play a Heardle-style game from any Spotify playlist. Players can log in with Spotify Premium, submit a playlist URL, and play against a pool of real tracks from that playlist.

## Tech stack

- Node.js (server)
- Express (server routes and static file serving)
- express-session (session storage for OAuth tokens)
- Spotify Web API (OAuth + playlist/artist endpoints)
- Frontend: static files in `public/` (`index.html`, `app.js`, `styles.css`)
- axios (HTTP requests to Spotify API)
- dotenv (environment variable loading)

## Target users

- Music fans who enjoy Heardle-style games
- Players who want to play with a custom playlist (friends, classes, clubs)
- Anyone learning about the Spotify API and OAuth via a simple example app

## Quick setup (development)

Requirements
- Node.js (recommended v16+ or v18+)
- A Spotify developer app (for Client ID and redirect URI)
- Spotify Premium (for using the Spotify Web Playback)

1. Clone the repository and install dependencies

```powershell
cd <project directory>
npm install
```

2. Create a Spotify app
- Go to https://developer.spotify.com/dashboard and create an app.
- Add a Redirect URI to your Spotify app settings. By default this app uses:
	- `http://127.0.0.1:3000/callback` — make sure this exact URI is in your Spotify app settings.

3. Create a `.env` file in the project root with the following entries (example provided in repo):

```
SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_REDIRECT_URI=http://127.0.0.1:3000/callback
SESSION_SECRET=your_client_secret_id
PORT=3000
```

Notes:
- `SPOTIFY_REDIRECT_URI` is optional if you use the default; but if you change it you must update the redirect URI in your Spotify app dashboard.
- Never commit `.env` to source control.

4. Run the app

```powershell
# Development (auto-restarts with changes)
npm run dev

# Production / simple start
npm start
```

Then open http://127.0.0.1:3000 in your browser.

## How it works (high level)

- User clicks login and completes Spotify OAuth (PKCE). Tokens are stored in a server-side session.
- From the frontend you can submit a Spotify playlist URL to `/api/playlist`.
- The server fetches the playlist tracks and artist metadata (genres, release years) using the Spotify Web API.
- The frontend uses the returned track pool to run the Heardle-like gameplay (short previews and clues).

## Environment variables used by the server

- `SPOTIFY_CLIENT_ID` — required (from your Spotify Developer Dashboard)
- `SPOTIFY_REDIRECT_URI` — optional (default: `http://127.0.0.1:3000/callback`)
- `SESSION_SECRET` — recommended to set in production
- `PORT` — optional (defaults to 3000)

## Troubleshooting

- If you see an `Invalid client or redirect URI` message during login: confirm the Redirect URI in the Spotify Dashboard matches `SPOTIFY_REDIRECT_URI` exactly.
- If playlist fetching fails, check the server console for the Spotify API error (rate limits or expired tokens). You can re-login to refresh permissions.