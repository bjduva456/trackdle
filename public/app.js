const loginBtn = document.getElementById('login');
const logoutBtn = document.getElementById('logout');
const status = document.getElementById('status');
const loadBtn = document.getElementById('loadPlaylist');
const playlistUrlInput = document.getElementById('playlistUrl');
const loadingIndicator = document.getElementById('loadingIndicator');
const loadingProgress = document.getElementById('loadingProgress');
const playlistInfo = document.getElementById('playlistInfo');
const playlistCount = document.getElementById('playlistCount');
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
// Toggle this flag to show/hide debug answer output in the UI and console
const DEBUG_MODE = false;

// Normalize titles for comparison: lowercase, remove punctuation, remove parentheticals and feat. clauses, collapse whitespace
function normalizeTitle(s) {
  if (!s) return '';
  let t = s.toString().toLowerCase();
  // remove parenthetical content (e.g., "Song (Live)")
  t = t.replace(/\([^)]*\)/g, '');
  // remove common featuring patterns
  t = t.replace(/\b(feat\.|feat|ft\.|ft|featuring)\b[^-–—,\(]*/g, '');
  // remove punctuation
  t = t.replace(/["'“”‘’\.!?\,;:\-–—\/\\]/g, '');
  // collapse whitespace
  t = t.replace(/\s+/g, ' ').trim();
  return t;
}

const clipSequence = [3, 5, 10, 15, 20, 30];
let clipIndex = 0;
const maxAttempts = clipSequence.length;
let currentAttempt = 0;
function updateAttemptsLabel() {
  const el = document.getElementById('attemptsLabel');
  if (!el) return;
  el.textContent = `Attempt ${currentAttempt} of ${maxAttempts}`;
}
let player = null;
let deviceId = null;
const connectPlayerBtn = document.getElementById('connectPlayer');
const playerStatus = document.getElementById('playerStatus');
let isPlaying = false;
// disable guess until a clip has been started
submitGuessBtn.disabled = true;
const giveUpBtn = document.getElementById('giveUpBtn');
// give up should be disabled until a round is active
if (giveUpBtn) giveUpBtn.disabled = true;
const victoryBanner = document.getElementById('victoryBanner');
const victoryText = document.getElementById('victoryText');
const newGameBtn = document.getElementById('newGameBtn');
const comparisonContainer = document.getElementById('comparisonContainer');
const comparisonTableBody = document.querySelector('#comparisonTable tbody');
const suggestionsBox = document.getElementById('suggestions');
let suggestionItems = [];
let suggestionIndex = -1;

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
  if (giveUpBtn) giveUpBtn.disabled = true;
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

  // show loading UI
  if (loadingIndicator) loadingIndicator.hidden = false;
  if (loadingProgress) { loadingProgress.textContent = 'Loading playlist... (may take a few seconds for large playlists)'; loadingProgress.hidden = false; }
  if (playlistInfo) { playlistInfo.hidden = true; }
  // accessibility: mark load button busy
  loadBtn.setAttribute('aria-busy', 'true');
  // disable controls while loading
  loadBtn.disabled = true;
  playClipBtn.disabled = true;
  submitGuessBtn.disabled = true;

  let data;
  try {
    const resp = await apiFetch('/api/playlist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ playlistUrl: url }) });
    if (!resp.ok) return alert('Failed to load playlist');
    data = await resp.json();
    tracks = data.tracks || [];
    showToast(`Playlist loaded (${tracks.length} tracks)`);
    if (playlistInfo && playlistCount) {
      playlistCount.textContent = tracks.length.toString();
      playlistInfo.hidden = false;
    }
  } catch (err) {
    console.error('loadPlaylist error', err);
    showToast('Failed to load playlist');
    alert('Failed to load playlist');
    return;
  } finally {
    // always hide loading UI and re-enable load button; other controls enabled later as appropriate
    if (loadingIndicator) loadingIndicator.hidden = true;
    if (loadingProgress) loadingProgress.hidden = true;
    loadBtn.disabled = false;
    loadBtn.removeAttribute('aria-busy');
  }
  if (!tracks.length) return alert('No tracks found in playlist');

  // pick random track
  answer = tracks[Math.floor(Math.random() * tracks.length)];
  if (DEBUG_MODE) {
    console.log('selected answer (debug):', answer);
    const debugEl = document.getElementById('debugAnswer');
    if (debugEl) debugEl.textContent = `DEBUG ANSWER: ${answer.name} — ${answer.artists}`;
  } else {
    const debugEl = document.getElementById('debugAnswer');
    if (debugEl) debugEl.textContent = '';
  }
  clipIndex = 0;
  // clear any banner classes
  if (victoryBanner) { victoryBanner.classList.remove('banner-win','banner-lose'); victoryBanner.hidden = true; }
  // enable give up now that a round is active
  if (giveUpBtn) giveUpBtn.disabled = false;
  currentAttempt = 0;
  updateAttemptsLabel();
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
  // note: do not advance clipIndex here — advances on guess so the label/progression
  // always moves when the player makes a guess (even if they didn't play audio).
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
  const rawGuess = (guessInput.value || '').trim();
  if (!rawGuess) return;
  if (!answer) return alert('No active track');

  const title = normalizeTitle(answer.name);

  // Count this guess as an attempt (increment immediately so wins use the correct attempt number)
  currentAttempt = Math.min(currentAttempt + 1, maxAttempts);
  updateAttemptsLabel();

  // Treat every guess as a title guess only — exact match after normalization
  const titleMatch = title === normalizeTitle(rawGuess);

  // Build and display a single-row comparison for this title guess
  showComparisonForGuess(rawGuess, answer);

  // Advance the clip index on every guess (cap to last index)
  clipIndex = Math.min(clipIndex + 1, clipSequence.length - 1);
  const nextIndex = Math.min(clipIndex, clipSequence.length - 1);
  clipLenLabel.innerText = `Clip ${clipSequence[nextIndex]}s`;

  // clear the guess input so player doesn't have to
  guessInput.value = '';

  if (titleMatch) {
    appendLog(`Correct! Title matched. Answer: ${answer.name} — ${answer.artists}`);
    // show victory banner
    victoryText.innerText = `You guessed the title: ${answer.name}`;
    if (victoryBanner) { victoryBanner.classList.remove('banner-lose'); victoryBanner.classList.add('banner-win'); }
    victoryBanner.hidden = false;
    gameSection.hidden = false; // keep game visible so banner shows in context
    // stop playback if playing
    if (audio) { audio.pause(); audio = null; }
    if (player) { player.pause().catch(() => {}); }
    isPlaying = false;
    // disable further controls until player clicks Play again
    playClipBtn.disabled = true;
    submitGuessBtn.disabled = true;
    if (giveUpBtn) giveUpBtn.disabled = true;
  } else {
    // hide suggestions after an incorrect guess
    if (suggestionsBox) { suggestionsBox.hidden = true; suggestionItems = []; suggestionIndex = -1; }

    // Lose condition: player used all attempts
    if (currentAttempt >= maxAttempts) {
      appendLog(`Out of tries — Revealing answer: ${answer.name} — ${answer.artists}`);
      // reveal final answer and show loss banner
      victoryText.innerText = `You lost — Answer: ${answer.name}`;
      if (victoryBanner) { victoryBanner.classList.remove('banner-win'); victoryBanner.classList.add('banner-lose'); }
      victoryBanner.hidden = false;
      // keep game visible so user can see comparison
      gameSection.hidden = false;
      if (audio) { audio.pause(); audio = null; }
      if (player) { player.pause().catch(() => {}); }
      isPlaying = false;
      playClipBtn.disabled = true;
      submitGuessBtn.disabled = true;
      if (giveUpBtn) giveUpBtn.disabled = true;
      return;
    }

    // stop current playback when user guesses
    if (audio) { audio.pause(); audio = null; }
    if (player) { player.pause().catch(() => {}); }
    isPlaying = false;
    // re-enable play button for the next clip
    playClipBtn.disabled = false;
  }
});

newGameBtn.addEventListener('click', () => {
  // start a new random track from the loaded playlist
  if (!tracks || !tracks.length) return;
  answer = tracks[Math.floor(Math.random() * tracks.length)];
  if (DEBUG_MODE) {
    console.log('selected answer (debug):', answer);
    const debugEl = document.getElementById('debugAnswer');
    if (debugEl) debugEl.textContent = `DEBUG ANSWER: ${answer.name} — ${answer.artists}`;
  } else {
    const debugEl = document.getElementById('debugAnswer');
    if (debugEl) debugEl.textContent = '';
  }
  clipIndex = 0;
  if (victoryBanner) { victoryBanner.hidden = true; victoryBanner.classList.remove('banner-win','banner-lose'); }
  comparisonContainer.hidden = true;
  comparisonTableBody.innerHTML = '';
  playClipBtn.disabled = false;
  submitGuessBtn.disabled = true;
  if (giveUpBtn) giveUpBtn.disabled = false;
  clipLenLabel.innerText = `Clip ${clipSequence[0]}s`;
  log.innerHTML = '';
  currentAttempt = 0;
  updateAttemptsLabel();
  appendLog('New track selected. Start guessing!');
});

if (giveUpBtn) {
  giveUpBtn.addEventListener('click', () => {
    if (!answer) return;
    // set attempts to max and show loss banner
    currentAttempt = maxAttempts;
    updateAttemptsLabel();
    appendLog(`Player gave up — Revealing answer: ${answer.name} — ${answer.artists}`);
    victoryText.innerText = `You gave up — Answer: ${answer.name}`;
    if (victoryBanner) { victoryBanner.classList.remove('banner-win'); victoryBanner.classList.add('banner-lose'); }
    victoryBanner.hidden = false;
    // disable controls
    if (audio) { audio.pause(); audio = null; }
    if (player) { player.pause().catch(() => {}); }
    isPlaying = false;
    playClipBtn.disabled = true;
    submitGuessBtn.disabled = true;
    giveUpBtn.disabled = true;
  });
}

function showComparisonForGuess(guessText, answerTrack) {
  comparisonContainer.hidden = false;

  // don't clear the table: each row represents a guess
  const tbody = comparisonTableBody;

  const raw = (guessText || '').trim();
  const guessLower = raw.toLowerCase();

  const title = (answerTrack.name || '').toString();
  const titleLower = normalizeTitle(title);

  // normalize artists: support array or string
  let artists = '';
  if (Array.isArray(answerTrack.artists)) artists = answerTrack.artists.map(a => a.name || a).join(', ');
  else artists = (answerTrack.artists || '').toString();
  const artistsLower = artists.toLowerCase();

  const year = (answerTrack.release_year || (answerTrack.album && answerTrack.album.release_date && answerTrack.album.release_date.slice(0,4))) || '';
  const genre = (answerTrack.genre || '') || '';
  const genreLower = genre.toLowerCase();

  // Treat every guess as a title guess only — exact match (case-insensitive)
  const isTitleGuess = titleLower === guessLower;

  // Try to parse a year from guess (e.g., 1999, 2020)
  const yearMatch = raw.match(/\b(19|20)\d{2}\b/);
  const guessedYear = yearMatch ? yearMatch[0] : '';

  // For genre, include guessed genre only if guess contains answer genre
  let guessedGenre = '';
  if (genre && guessLower.includes(genreLower)) guessedGenre = raw;
  // Try to find a track in the loaded playlist that matches the guessed title
  let matchedTrack = null;
  if (tracks && tracks.length) {
    const gl = normalizeTitle(raw);
    matchedTrack = tracks.find(t => {
      const tname = normalizeTitle(t.name || '');
      return tname === gl;
    }) || null;
  }

  // Prepare target (the actual answer) normalized values for comparison
  const targetTitle = (answerTrack && answerTrack.name) ? answerTrack.name.toString() : '';
  const targetTitleLower = normalizeTitle(targetTitle);
  const targetArtists = (answerTrack && answerTrack.artists) ? (Array.isArray(answerTrack.artists) ? answerTrack.artists.map(a=>a.name||a).join(', ') : answerTrack.artists.toString()) : '';
  const targetArtistsLower = targetArtists.toLowerCase();
  const targetYear = (answerTrack && (answerTrack.release_year || (answerTrack.album && answerTrack.album.release_date && answerTrack.album.release_date.slice(0,4)))) || '';
  const targetGenre = (answerTrack && answerTrack.genre) ? answerTrack.genre.toString() : ''; const targetGenreLower = targetGenre.toLowerCase();

  const tr = document.createElement('tr');

  // Title cell: always show guess; green if matches target, red otherwise
  const tdTitle = document.createElement('td');
  tdTitle.textContent = raw;
  if (targetTitleLower === normalizeTitle(raw)) tdTitle.classList.add('result-correct');
  else tdTitle.classList.add('result-wrong');

  // Artist cell: if the guessed title maps to a playlist track, show its artist(s) and compare to the target artist(s)
  const tdArtist = document.createElement('td');
  if (matchedTrack) {
    const matchedArtists = Array.isArray(matchedTrack.artists) ? matchedTrack.artists.map(a=>a.name||a).join(', ') : (matchedTrack.artists || '');
    tdArtist.textContent = matchedArtists;
    const maLower = matchedArtists.toLowerCase();
    if (maLower === targetArtistsLower || maLower.includes(targetArtistsLower) || targetArtistsLower.includes(maLower)) tdArtist.classList.add('result-correct');
    else tdArtist.classList.add('result-wrong');
  } else {
    tdArtist.textContent = '-';
    tdArtist.classList.add('empty-cell');
  }

  // Year cell
  const tdYear = document.createElement('td');
  if (matchedTrack) {
    const myear = (matchedTrack.release_year || (matchedTrack.album && matchedTrack.album.release_date && matchedTrack.album.release_date.slice(0,4))) || '';
    tdYear.textContent = myear || '-';
    if (myear && targetYear && myear.toString() === targetYear.toString()) tdYear.classList.add('result-correct');
    else if (myear) tdYear.classList.add('result-wrong');
    else tdYear.classList.add('empty-cell');
  } else {
    tdYear.textContent = guessedYear || '-';
    if (guessedYear && targetYear && guessedYear === targetYear.toString()) tdYear.classList.add('result-correct');
    else if (guessedYear) tdYear.classList.add('result-wrong');
    else tdYear.classList.add('empty-cell');
  }

  // Genre cell
  const tdGenre = document.createElement('td');
  if (matchedTrack) {
    const mgenre = matchedTrack.genre || '';
    tdGenre.textContent = mgenre || '-';
    if (mgenre && targetGenre && mgenre.toLowerCase() === targetGenreLower) tdGenre.classList.add('result-correct');
    else if (mgenre) tdGenre.classList.add('result-wrong');
    else tdGenre.classList.add('empty-cell');
  } else {
    tdGenre.textContent = guessedGenre || '-';
    if (guessedGenre && targetGenre && guessedGenre.toLowerCase().includes(targetGenreLower)) tdGenre.classList.add('result-correct');
    else if (guessedGenre) tdGenre.classList.add('result-wrong');
    else tdGenre.classList.add('empty-cell');
  }

  tr.appendChild(tdTitle);
  tr.appendChild(tdArtist);
  tr.appendChild(tdYear);
  tr.appendChild(tdGenre);
  tbody.appendChild(tr);
}

// --- Autocomplete / suggestions for guess input ---
function clearSuggestions() {
  if (!suggestionsBox) return;
  suggestionsBox.innerHTML = '';
  suggestionsBox.hidden = true;
  suggestionItems = [];
  suggestionIndex = -1;
}

function populateSuggestions(filter) {
  if (!suggestionsBox) return;
  const q = (filter || '').toString().trim().toLowerCase();
  suggestionsBox.innerHTML = '';
  suggestionItems = [];
  suggestionIndex = -1;
  if (!q || !tracks || !tracks.length) {
    suggestionsBox.hidden = true;
    return;
  }
  // find up to 20 unique titles containing the query
  const seen = new Set();
  const results = [];
  for (let i = 0; i < tracks.length && results.length < 20; i++) {
    const t = (tracks[i].name || '').toString();
    const norm = t.toLowerCase();
    if (norm.includes(q) && !seen.has(norm)) {
      seen.add(norm);
      results.push(t);
    }
  }
  if (!results.length) { suggestionsBox.hidden = true; return; }
  // render items
  results.forEach((text, idx) => {
    const div = document.createElement('div');
    div.className = 'suggestion-item';
    // highlight matching substring
    const lower = text.toLowerCase();
    const start = lower.indexOf(q);
    if (start >= 0) {
      const before = text.slice(0, start);
      const match = text.slice(start, start + q.length);
      const after = text.slice(start + q.length);
      div.innerHTML = `${escapeHtml(before)}<span class="suggestion-highlight">${escapeHtml(match)}</span>${escapeHtml(after)}`;
    } else {
      div.textContent = text;
    }
    div.addEventListener('mousedown', (ev) => {
      // mousedown used to avoid blur before click
      ev.preventDefault();
      guessInput.value = text;
      clearSuggestions();
      guessInput.focus();
    });
    suggestionsBox.appendChild(div);
    suggestionItems.push(div);
  });
  suggestionsBox.hidden = false;
}

function escapeHtml(s) {
  return (s+'').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"})[ch]);
}

// input events
if (guessInput) {
  guessInput.addEventListener('input', (e) => {
    const v = e.target.value || '';
    populateSuggestions(v);
  });
  guessInput.addEventListener('keydown', (e) => {
    if (!suggestionItems || suggestionItems.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      // move down
      suggestionIndex = Math.min(suggestionIndex + 1, suggestionItems.length - 1);
      updateSuggestionActive();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      suggestionIndex = Math.max(suggestionIndex - 1, 0);
      updateSuggestionActive();
    } else if (e.key === 'Enter') {
      if (suggestionIndex >= 0 && suggestionIndex < suggestionItems.length) {
        e.preventDefault();
        const txt = suggestionItems[suggestionIndex].textContent;
        guessInput.value = txt;
        clearSuggestions();
      }
    } else if (e.key === 'Escape') {
      clearSuggestions();
    }
  });
  // hide suggestions on blur (short timeout to allow click)
  guessInput.addEventListener('blur', () => { setTimeout(() => clearSuggestions(), 120); });
}

function updateSuggestionActive() {
  suggestionItems.forEach((el, i) => el.classList.toggle('active', i === suggestionIndex));
  if (suggestionIndex >= 0 && suggestionIndex < suggestionItems.length) {
    const el = suggestionItems[suggestionIndex];
    // ensure visible
    el.scrollIntoView({ block: 'nearest' });
  }
}

// initial check
checkLoggedIn();
