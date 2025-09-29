import React, { useEffect, useState } from 'react';

function WebPlayback({ token }) {
  const [player, setPlayer] = useState(null);

  useEffect(() => {
    const script = document.createElement('script');
    script.src = "https://sdk.scdn.co/spotify-player.js";
    script.async = true;
    document.body.appendChild(script);

    window.onSpotifyWebPlaybackSDKReady = () => {
      const p = new window.Spotify.Player({
        name: 'Web Playback SDK Quick Start',
        getOAuthToken: cb => { cb(token); },
        volume: 0.5
      });
      setPlayer(p);

      p.addListener('ready', ({ device_id }) => {
        console.log('Ready with Device ID', device_id);
      });
      p.addListener('not_ready', ({ device_id }) => {
        console.log('Device ID went offline', device_id);
      });

      p.connect();
    };
  }, [token]);

  return (
    <div>
      <h2>Spotify Web Player</h2>
      <div>Player: {player ? 'Ready' : 'Loading...'}</div>
    </div>
  );
}

export default WebPlayback;