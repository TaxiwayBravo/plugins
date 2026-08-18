# Voice Activity History v1.0.0

Local voice-session history for Vencord.

## Records

- Your own voice joins
- Your own voice leaves
- Your own channel moves
- Other users joining your current voice channel
- Other users leaving your current voice channel
- Other users moving into or out of your current voice channel

## Interface

Use `/voicehistory` to open the history panel.

Each entry shows the user/display name, JOIN / LEAVE / MOVE, source/destination channel, server name, date and exact time.

The panel also has **Clear history**.

## Privacy / storage

History stays local and is stored with Vencord's DataStore. The plugin keeps the most recent 300 events.

## Install

Install from TaxiwayBravo Plugins Manager, or copy `voiceActivityHistory` to `Vencord/src/userplugins/voiceActivityHistory`.
