# TaxiwayBravo Vencord Plugins

Official TaxiwayBravo Vencord plugins, theme and update feed.

## Current plugins

- **Hidden Channel Info+** — v1.2
- **Tidal Controls** — v1.2.2
- **Taxiway Presence Rings** — v1.0.5

## Automatic updates

TaxiwayBravo Plugins Manager v3.7.1+ reads `repository.json` from this repository.

The feed points to GitHub's branch archive and a plugin-specific `packageRootFolder`. That means the manager installs and updates directly from the source stored under `plugins/`; separate release ZIPs are not required.

Feed:

`https://raw.githubusercontent.com/TaxiwayBravo/plugins/main/repository.json`

## Layout

- `plugins/` — canonical plugin source
- `themes/` — TaxiwayBravo theme
- `manager/` — manager/update documentation
- `repository.json` — machine-readable manager/plugin catalogue

> This repository must be public for users to use the update feed without GitHub authentication.
