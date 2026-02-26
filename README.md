<h1 align="center">Soundcloud Extras</h1>

<div align="center">
  <img src="https://img.shields.io/badge/Tampermonkey-Script-blue?style=for-the-badge&logo=tampermonkey" alt="Tampermonkey">
  <img src="https://img.shields.io/badge/SoundCloud-Extras-orange?style=for-the-badge&logo=soundcloud" alt="SoundCloud">
  <img src="https://img.shields.io/badge/Version-2.2-green?style=for-the-badge" alt="Version">
</div>

<div align="center">
  <h3>Save artwork and download tracks from SoundCloud with a simple right-click</h3>
</div>

---

## Demo

<div align="center">
  <img src="demo.gif" alt="Demo GIF" width="600">
</div>

## Features

- **Simple Right-Click Menu** - Right-click any artwork for options
- **Save Artwork** - Download high-quality artwork (500x500)
- **Download Tracks** - Save MP3 files directly from SoundCloud
- **Smart Naming** - Files are automatically named (track title or artist - track)
- **Works Everywhere** - Player, track lists, artist pages, playlists, and more
- **Lightweight** - No performance impact on your browsing

## Installation

### Prerequisites
- Install [Tampermonkey](https://www.tampermonkey.net/) for your browser:
  - [Chrome](https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo)
  - [Firefox](https://addons.mozilla.org/en-US/firefox/addon/tampermonkey/)
  - [Edge](https://microsoftedge.microsoft.com/addons/detail/tampermonkey/iikmkjmpaadaobahmlepeloendndfphd)
  - [Safari](https://apps.apple.com/us/app/tampermonkey/id1482490089)

### Install Script

1. **Click the install button:**
   
   [![Install Script](https://img.shields.io/badge/Install-Script-success?style=for-the-badge)](https://github.com/esqa/soundcloud-extras/raw/refs/heads/main/soundcloud-extras.user.js)

2. **Or install manually:**
   - Open Tampermonkey Dashboard
   - Click "Create a new script"
   - Copy and paste the script from [`soundcloud-extras.user.js`](soundcloud-extras.user.js)
   - Save with `Ctrl+S` (or `Cmd+S` on Mac)

## Usage

### Right-Click Menu Options

When you right-click on any track artwork, you'll see:
- **Save Image** - Downloads the track artwork
- **Save Track** - Downloads the MP3 file

<h3 align="center">Saving Artwork from the Main Player</h3>

<div align="center">
  <img src="player-example.gif" alt="Player Example" width="500">
</div>

<h3 align="center">Saving from Artist Pages</h3>

<div align="center">
  <img src="artist-example.gif" alt="Artist Page Example" width="500">
</div>

## How It Works

1. **Detection** - The script detects when you right-click on SoundCloud artwork
2. **Menu** - Shows custom options: "Save Image" and "Save Track"
3. **Artwork** - Fetches high-resolution artwork (500x500) and downloads it
4. **Tracks** - Uses SoundCloud's API to fetch and download MP3 files
5. **Naming** - Automatically names files based on track/artist information

## Supported Locations

The script works on artwork found in:

- Main player (bottom bar)
- Track pages
- User/Artist pages
- Playlist pages
- Search results
- Stream/Feed
- Charts and trending pages

## Configuration

The script works out of the box, but you can modify these settings in the code:

- **Image Quality**: Default is 500x500 (highest available)
- **Image Format**: Saves as `.jpg`
- **Audio Format**: Downloads as `.mp3`
- **Naming Convention**: 
  - Artwork: `track_title.jpg`
  - Tracks: `artist_name - track_title.mp3`

## Troubleshooting

<details>
<summary><b>Menu doesn't appear when right-clicking</b></summary>

- Make sure Tampermonkey is enabled
- Check that the script is active (should have a green dot in Tampermonkey)
- Refresh the SoundCloud page
- Make sure you're clicking directly on the artwork image
</details>

<details>
<summary><b>Download fails or shows error</b></summary>

- Check your browser's download settings
- Make sure you have permission to save files
- Try disabling other extensions that might interfere
- Check browser console for specific error messages
</details>

<details>
<summary><b>Wrong image quality or size</b></summary>

- The script automatically fetches the 500x500 version
- If the track only has lower quality artwork, that's what will be saved
- Original upload quality varies by artist/track
</details>

## Acknowledgments

- Built for the SoundCloud community
- Powered by [Tampermonkey](https://www.tampermonkey.net/)
- Inspired by the need to save beautiful album artwork

---

<div align="center">
  <p>Made with love for music lovers</p>
  <p>
    <a href="#soundcloud-extras">Back to top</a>
  </p>
</div>