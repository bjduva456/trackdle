import React, { useEffect, useState } from 'react';
import WebPlayback from './WebPlayback';
import Login from './Login';

function App() {
  const [token, setToken] = useState('');

  useEffect(() => {
    async function fetchToken() {
      const resp = await fetch('/token');  // proxy or direct URL
      const j = await resp.json();
      setToken(j.access_token);
    }
    fetchToken();
  }, []);

  return (
    <>
      {token ? <WebPlayback token={token} /> : <Login />}
    </>
  );
}

export default App;
