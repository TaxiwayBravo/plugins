# Tidal Controls

Current version: **1.2.3**

Windows-only Vencord plugin that places TIDAL playback controls above Discord's voice/account panel.

Features include track metadata, artwork, play/pause, previous/next, seek timeline, shuffle and repeat.

## v1.2.3 reliability fix

- Windows media-session requests now have hard timeouts instead of being able to hang forever.
- The Vencord native bridge restarts a helper process if it becomes stuck.
- If TIDAL is running but Windows does not expose a recognisable TIDAL media session, Discord now shows a visible diagnostic card instead of silently hiding the player.
- If TIDAL's Windows media identity changes and it is the only available media session, the helper can safely use that session as a fallback.

The runtime does not use PowerShell. The self-contained .NET helper is built with `build-helper.cmd` and stored under `%APPDATA%\Vencord\TidalControls`.

**After updating to 1.2.3, run `build-helper.cmd` once so the installed helper EXE contains the v1.2.3 fixes, then restart Discord.**
