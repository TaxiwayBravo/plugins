# Tidal Controls

Current version: **1.2.4**

Windows-only Vencord plugin that places TIDAL playback controls above Discord's voice/account panel.

Features include track metadata, artwork, play/pause, previous/next, seek timeline, shuffle and repeat.

## v1.2.4 direct fallback

Tidal Controls now has two playback backends:

1. **Windows media-session API** — full metadata, playback state and seek timeline when Windows responds normally.
2. **Direct TIDAL Win32 fallback** — automatically used when Windows' media-session manager hangs or fails.

Fallback mode reads TIDAL's own window metadata instead of relying on `Windows.Media.Control`. It keeps track/artist display, artwork lookup, play/pause, previous/next, shuffle and repeat working. Seeking is unavailable while fallback mode is active because TIDAL does not expose a safe direct seek interface through the window fallback.

The helper also places the Windows media-session API into a short cooldown after a timeout so Discord does not continuously create more stuck Windows media requests.

The runtime does not use PowerShell. The self-contained .NET helper is built with `build-helper.cmd` and stored under `%APPDATA%\Vencord\TidalControls`.

**After updating to 1.2.4, run `build-helper.cmd` once, then restart Discord.**
