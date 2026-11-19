# Retro Radio 📻

World radio stations on an old-school analog radio. Inspired by Radio Garden.

- **COUNTRY knob**: pick a country (long-press it, or tap the country name, for a list)
- **REGION knob**: pick a province or state (long-press it for a list)
- **TUNING knob**: scan through the stations in that province; the red needle moves along the FM scale
- **VOLUME knob**: fully left is OFF; turn right to switch on and turn up
- **Search**: type `OFM`, `94.7`, `947`, `East Coast Radio`, `ecr` … and tap a result to tune straight to it
- **Scan**: jumps to the next station that actually plays and skips dead streams
- **Save / Favs / Recent**: long-press the dial or tap Save to keep a station
- **Setup**: sleep timer, static on/off, amber or green dial light, share, update

Drag a knob in a circle to turn it, or tap its right side for one step forward and its left side for one step back.

## Install

**Android (APK)**: open the latest release and download `RetroRadio.apk`:
https://github.com/m9r1u5/Radio/releases/latest

**iPhone / any phone (web app)**: open https://m9r1u5.github.io/Radio/ in Safari → Share → *Add to Home Screen*.

## Station data

- All stations come from the free [Radio Browser](https://www.radio-browser.info) directory (no API key, no cost).
- `stations-za.json` is a curated South African list (province, frequency, short names). Edit it to fix a
  frequency or add a station. Leave `url` empty and the app finds the stream by name; fill in `url` to force a stream.
  Entries marked `"verify": true` need their frequency checked.

## Files

| File | What it is |
|---|---|
| `index.html`, `style.css`, `app.js` | the app |
| `stations-za.json` | curated SA stations |
| `sw.js`, `manifest.json`, icons | makes it an installable offline web app |
| `version.json` | bump this (and `APP_VERSION` in app.js + `CACHE` in sw.js) when you release an update |
| `capacitor.config.json`, `native/` | Android app wrapper + background-playback service |
| `.github/workflows/build-apk.yml` | builds the APK on every push and publishes it as a release |
