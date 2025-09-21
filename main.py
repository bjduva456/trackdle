import random
import os
import spotipy
from spotipy.oauth2 import SpotifyOAuth

#get credentials from text file
def load_credentials(file_path="credentials.txt"):
    creds = {}
    with open(file_path, "r") as f:
        for line in f:
            if "=" in line:
                key, value = line.strip().split("=", 1)
                creds[key] = value
    return creds

credentials = load_credentials()

sp = spotipy.Spotify(auth_manager = SpotifyOAuth(
    client_id=credentials.get("SPOTIPY_CLIENT_ID"),
    client_secret=credentials.get("SPOTIPY_CLIENT_SECRET"),
    redirect_uri=credentials.get("SPOTIPY_REDIRECT_URI"),
    scope="playlist-read-private"
))