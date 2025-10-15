const loginBtn = document.getElementById('login');
const logoutBtn = document.getElementById('logout');
const status = document.getElementById('status');
const loadBtn = document.getElementById('loadPlaylist');
const playlistUrlInput = document.getElementById('playlistUrl');
const gameSection = document.getElementById('game');
const playClipBtn = document.getElementById('playClip');
const clipLenLabel = document.getElementById('clipLen');
const guessInput = document.getElementById('guessInput');
const submitGuessBtn = document.getElementById('submitGuess');
const log = document.getElementById('log');

let accessToken = null;
let tracks = [];
let answer = null;
let audio = null;

const clipSequence = [1, 3, 6, 10, 15, 30];
let clipIndex = 0;
let player = null;
let deviceId = null;
const connectPlayerBtn = document.getElementById('connectPlayer');
const playerStatus = document.getElementById('playerStatus');
let isPlaying = false;
// disable guess until a clip has been started
submitGuessBtn.disabled = true;

async function checkLoggedIn() {
  try {
    const r = await fetch('/token');
    if (!r.ok) {
      status.innerText = 'Not logged in';
      accessToken = null;
      loginBtn.style.display = '';
      logoutBtn.style.display = 'none';
      return false;
    }
    const j = await r.json();
    accessToken = j.access_token;
    status.innerText = 'Logged in (token available)';
    loginBtn.style.display = 'none';
    logoutBtn.style.display = '';
    // fetch profile and show toast
    fetchProfileAndToast();
    // if there was a pending playlist saved before re-login, restore and auto-load
    restorePendingPlaylistIfAny();
    return true;
  } catch (err) {
    status.innerText = 'Error checking login';
    return false;
  }
}

loginBtn.addEventListener('click', () => {
  window.location = '/login';
});

connectPlayerBtn.addEventListener('click', async () => {
  const ok = await checkLoggedIn();
  if (!ok) return alert('Please login first');
  initPlayer();
});

logoutBtn.addEventListener('click', async () => {
  await fetch('/logout');
  // reset UI state
  accessToken = null;
  loginBtn.style.display = '';
  logoutBtn.style.display = 'none';
  status.innerText = 'Logged out';
  gameSection.hidden = true;
  showToast(`Logged out`);
  // reset buttons
  playClipBtn.disabled = true;
  submitGuessBtn.disabled = true;
});

// Toast utilities
function showToast(message, ms = 3000) {
  const root = document.getElementById('toast-root');
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = message;
  root.appendChild(t);
  // force reflow then show
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => root.removeChild(t), 200);
  }, ms);
}

// Generic API fetch that handles 401 by preserving current playlist (if any), showing a toast, and redirecting to login
async function apiFetch(path, opts) {
  try {
    const r = await fetch(path, opts);
    if (r.status === 401) {
      // preserve pending playlist URL if present
      const pending = playlistUrlInput.value && playlistUrlInput.value.trim();
      if (pending) localStorage.setItem('trackdle_pending_playlist', pending);
      showToast('Session expired — redirecting to login...', 2000);
      setTimeout(() => { window.location = '/login'; }, 900);
      throw new Error('unauthenticated');
    }
    return r;
  } catch (err) {
    throw err;
  }
}

async function fetchProfileAndToast() {
  try {
    const r = await apiFetch('/api/me');
    if (!r || !r.ok) return;
    const profile = await r.json();
    const name = profile.display_name || profile.id || 'Spotify user';
    showToast(`Logged in as ${name}`);
  } catch (err) {
    // apiFetch will redirect on 401; ignore other errors
    console.error('profile fetch error', err);
  }
}

function restorePendingPlaylistIfAny() {
  const p = localStorage.getItem('trackdle_pending_playlist');
  if (p) {
    playlistUrlInput.value = p;
    // clear and auto-load once
    localStorage.removeItem('trackdle_pending_playlist');
    // auto-load
    loadPlaylist();
  }
}

async function loadPlaylist() {
  const url = playlistUrlInput.value.trim();
  if (!url) return alert('Enter playlist URL');
  const ok = await checkLoggedIn();
  if (!ok) return alert('Please login first');

  const resp = await apiFetch('/api/playlist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ playlistUrl: url }) });
  if (!resp.ok) return alert('Failed to load playlist');
  const data = await resp.json();
  tracks = data.tracks || [];
  if (!tracks.length) return alert('No tracks found in playlist');

  // pick random track
  answer = tracks[Math.floor(Math.random() * tracks.length)];
  console.log('answer', answer);
  clipIndex = 0;
  // enable play button and set initial clip label
  playClipBtn.disabled = false;
  clipLenLabel.innerText = `Clip ${clipSequence[Math.min(clipIndex, clipSequence.length - 1)]}s`;
  gameSection.hidden = false;
  log.innerHTML = '';
  appendLog('Playlist loaded. Start guessing!');
}

loadBtn.addEventListener('click', loadPlaylist);


function appendLog(msg) {
  const d = document.createElement('div');
  d.textContent = msg;
  log.prepend(d);
}

playClipBtn.addEventListener('click', async () => {
  if (!answer) return alert('Load a playlist first');
  if (isPlaying || playClipBtn.disabled) return; // prevent double-play

  // disable play while clip is playing
  playClipBtn.disabled = true;
  isPlaying = true;

  const currentIndex = Math.min(clipIndex, clipSequence.length - 1);
  const clipLen = clipSequence[currentIndex];
  clipLenLabel.innerText = `Playing ${clipLen}s`;

  // if player is connected, use Web Playback SDK (preferred)
  if (player && deviceId) {
    try {
      // enable guessing once playback starts
      submitGuessBtn.disabled = false;
      await playViaWebPlayback(answer.uri, clipLen);
    } catch (err) {
      console.error('web playback error', err);
      appendLog('Web Playback failed, falling back to preview_url if available.');
      if (answer.preview_url) playPreviewClip(answer.preview_url, clipLen);
      else appendLog('No preview available.');
    }
  } else {
    // fallback to preview_url
    if (answer.preview_url) {
      // enable guessing once playback starts
      submitGuessBtn.disabled = false;
      playPreviewClip(answer.preview_url, clipLen);
    } else {
      appendLog('No preview URL available for this track. Connect the Web Player (Premium required) to play full tracks.');
    }
  }

  // advance to next clip length for the next round
  clipIndex++;
});

function playPreviewClip(url, seconds) {
  if (audio) {
    audio.pause();
    audio = null;
  }
  audio = new Audio(url);
  audio.crossOrigin = 'anonymous';
  const start = 0;
  audio.currentTime = start;
  audio.play();

  setTimeout(() => {
    if (audio) audio.pause();
  }, seconds * 1000);
}

async function initPlayer() {
  if (player) return;
  if (!window.Spotify) {
    showToast('Spotify SDK not loaded');
    return;
  }

  player = new window.Spotify.Player({
    name: 'Trackdle Web Player',
    getOAuthToken: cb => {
      // get fresh token from server
      fetch('/token').then(r => r.json()).then(j => cb(j.access_token)).catch(e => { console.error('get token for sdk', e); });
    },
    volume: 0.7,
  });

  // error handling
  player.addListener('initialization_error', ({ message }) => { console.error(message); showToast('Player init error'); });
  player.addListener('authentication_error', ({ message }) => { console.error(message); showToast('Player authentication error'); });
  player.addListener('account_error', ({ message }) => { console.error(message); showToast('Account error (Premium required)'); });
  player.addListener('playback_error', ({ message }) => { console.error(message); showToast('Playback error'); });

  // playback status updates
  player.addListener('player_state_changed', state => {
    // can update play/pause UI if desired
  });

  // ready
  player.addListener('ready', ({ device_id }) => {
    deviceId = device_id;
    playerStatus.innerText = 'Connected';
    showToast('Web Player connected');
  });

  player.addListener('not_ready', ({ device_id }) => {
    if (deviceId === device_id) {
      deviceId = null;
      playerStatus.innerText = 'Not ready';
    }
  });

  // connect
  player.connect().then(success => {
    if (!success) showToast('Failed to connect player');
  });
}

async function playViaWebPlayback(uri, seconds) {
  if (!deviceId) throw new Error('no_device');
  // ensure we have a server token to call Web API
  const tokResp = await fetch('/token');
  if (!tokResp.ok) throw new Error('no_token');
  const tok = await tokResp.json();
  const access = tok.access_token;

  // start playback on device via Web API
  const playUrl = `https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`;
  const body = { uris: [uri] };
  const r = await fetch(playUrl, { method: 'PUT', headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (r.status === 204 || r.ok) {
    // give the player a small moment then seek to 0 and pause after seconds
    setTimeout(async () => {
      try { await player.seek(0); } catch (e) { console.warn('seek failed', e); }
      setTimeout(() => { player.pause().catch(() => {}); }, seconds * 1000);
    }, 300);
  } else {
    const errText = await r.text();
    throw new Error(`play failed: ${r.status} ${errText}`);
  }
}

submitGuessBtn.addEventListener('click', () => {
  const guess = guessInput.value.trim().toLowerCase();
  if (!guess) return;
  if (!answer) return alert('No active track');

  const title = answer.name.toLowerCase();
  const artists = answer.artists.toLowerCase();
  const isCorrect = title.includes(guess) || artists.includes(guess) || guess.includes(title) || guess.includes(artists);

  if (isCorrect) {
    appendLog(`Correct! Answer: ${answer.name} — ${answer.artists}`);
    gameSection.hidden = true;
    // stop playback if playing
    if (audio) { audio.pause(); audio = null; }
    if (player) { player.pause().catch(() => {}); }
    isPlaying = false;
    // no need to re-enable play when game ends
    playClipBtn.disabled = true;
  } else {
    appendLog(`Wrong guess: "${guessInput.value}"`);
    guessInput.value = '';
    if (clipIndex >= clipSequence.length) {
      appendLog(`Out of tries — Revealing answer: ${answer.name} — ${answer.artists}`);
      gameSection.hidden = true;
      if (audio) { audio.pause(); audio = null; }
      if (player) { player.pause().catch(() => {}); }
      isPlaying = false;
      playClipBtn.disabled = true;
      return;
    }
    // stop current playback when user guesses
    if (audio) { audio.pause(); audio = null; }
    if (player) { player.pause().catch(() => {}); }
    isPlaying = false;
    // re-enable play button for the next clip and update label to next length
    playClipBtn.disabled = false;
    const nextIndex = Math.min(clipIndex, clipSequence.length - 1);
    clipLenLabel.innerText = `Clip ${clipSequence[nextIndex]}s`;
  }
});

// initial check
checkLoggedIn();
