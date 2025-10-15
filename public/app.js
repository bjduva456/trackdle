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
    return true;
  } catch (err) {
    status.innerText = 'Error checking login';
    return false;
  }
}

loginBtn.addEventListener('click', () => {
  window.location = '/login';
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

async function fetchProfileAndToast() {
  try {
    const r = await fetch('/api/me');
    if (!r.ok) return;
    const profile = await r.json();
    const name = profile.display_name || profile.id || 'Spotify user';
    showToast(`Logged in as ${name}`);
  } catch (err) {
    console.error('profile fetch error', err);
  }
}

loadBtn.addEventListener('click', async () => {
  const url = playlistUrlInput.value.trim();
  if (!url) return alert('Enter playlist URL');
  const ok = await checkLoggedIn();
  if (!ok) return alert('Please login first');

  const resp = await fetch('/api/playlist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ playlistUrl: url }) });
  if (!resp.ok) return alert('Failed to load playlist');
  const data = await resp.json();
  tracks = data.tracks || [];
  if (!tracks.length) return alert('No tracks found in playlist');

  // pick random track
  answer = tracks[Math.floor(Math.random() * tracks.length)];
  console.log('answer', answer);
  clipIndex = 0;
  gameSection.hidden = false;
  log.innerHTML = '';
  appendLog('Playlist loaded. Start guessing!');
});

function appendLog(msg) {
  const d = document.createElement('div');
  d.textContent = msg;
  log.prepend(d);
}

playClipBtn.addEventListener('click', async () => {
  if (!answer) return alert('Load a playlist first');
  const clipLen = clipSequence[Math.min(clipIndex, clipSequence.length - 1)];
  clipLenLabel.innerText = `Clip ${clipLen}s`;

  // prefer preview_url
  if (answer.preview_url) {
    playPreviewClip(answer.preview_url, clipLen);
  } else {
    appendLog('No preview URL available for this track. Try using Spotify Web Playback SDK (requires Premium).');
  }
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

  clipIndex++;
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
  } else {
    appendLog(`Wrong guess: "${guessInput.value}"`);
    guessInput.value = '';
    if (clipIndex >= clipSequence.length) {
      appendLog(`Out of tries — Revealing answer: ${answer.name} — ${answer.artists}`);
      gameSection.hidden = true;
    }
  }
});

// initial check
checkLoggedIn();
