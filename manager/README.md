# TaxiwayBravo Plugins Manager

Current published manager version: **3.7.1**

Next source version: **3.8.0**

The manager uses the root `repository.json` feed to discover and update plugins.

From v3.7.1, plugins can be installed directly from this repository's branch archive using each plugin's `packageRootFolder`, so separate package ZIP files are not required.

## v3.8.0 self-updates

v3.8.0 adds an in-app manager updater. Once v3.8.0 has been built and installed once, future manager versions can be offered directly on the **Updates** page.

The root `repository.json` manager object supports:

- `version` — published manager version
- `downloadUrl` — direct HTTPS URL to the new `TaxiwayBravoPlugins.exe`
- `sha256` — expected SHA-256 hash of that EXE
- `releaseNotes` — text shown before installation
- `mandatory` — whether the confirmation prompt may be skipped for a required release

The manager downloads updates to `%LOCALAPPDATA%\TaxiwayBravoPlugins\Updates`, verifies SHA-256 when supplied, closes itself, replaces its EXE and restarts. The self-update path does **not** use PowerShell.

v3.8.0 also cache-busts repository requests so newly published plugins and versions are not hidden by stale raw-GitHub/CDN responses.
