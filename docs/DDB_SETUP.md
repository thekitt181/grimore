# D&D Beyond Integration Setup

Grimoire connects to D&D Beyond using your **Cobalt session token** — the same approach used by community tools like ddb-importer and Beyond20. There is no public OAuth API from Wizards of the Coast.

## Requirements

- An active [D&D Beyond](https://www.dndbeyond.com) account with access to your characters
- Characters must be in a campaign you can access, or set to **public** for direct fetch
- Server env: `DDB_TOKEN_ENCRYPTION_KEY` (32+ character random secret)

## Get your Cobalt token

1. Log in to [dndbeyond.com](https://www.dndbeyond.com) in Chrome or Firefox.
2. Open DevTools → **Application** (Chrome) or **Storage** (Firefox) → **Cookies** → `https://www.dndbeyond.com`.
3. Find the cookie named **`CobaltSession`**.
4. Copy its **value** (a long alphanumeric string).

> The token expires when you log out or after some time. Re-link if Grimoire shows "Session expired".

## Link in Grimoire

1. Open your **Campaign** page (GM) or use **Account link** in the session sidebar.
2. Paste the Cobalt token and click **Link account**.
3. Grimoire stores the token **encrypted** on the server. It is never sent back to the browser after linking.

## Features

| Feature | How to use |
|---------|------------|
| Import PC | Session sidebar → **Import PC**, paste character ID from sheet URL, or map context menu → **Link D&D Beyond character** |
| Character sheet | Right-click PC token → **Character sheet** |
| Combat actions | Right-click PC token → **Character actions** (attacks, spells, AoE placement) |
| HP sync | Enable **Push HP changes** in link settings; use **Sync from DDB** on the sheet to pull |
| Roll bridge | Enable in link settings; rolls from DDB game log appear in the dice tray |
| Encounters | Session sidebar → **Encounters** (link DDB campaign first) |
| Library import | Session sidebar → **Library import** — browse/import monsters, spells, items from owned + shared DDB books |

## Privacy & limitations

- Tokens are per-user and encrypted at rest with `DDB_TOKEN_ENCRYPTION_KEY`.
- All D&D Beyond HTTP calls run **server-side only** — clients never hold the Cobalt token after link.
- D&D Beyond may change internal APIs without notice; sync and roll bridge are best-effort.
- You must own the D&D Beyond content for characters you import.
- Grimoire shows **Powered by D&D Beyond** attribution in the UI.

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Invalid Cobalt token | Copy the cookie again while logged in; avoid extra spaces |
| Character 403 | Make the sheet public or ensure you have campaign access |
| HP not pushing | Check **Push HP changes** in link settings and `syncHpToDdb` on the token |
| No characters in list | Use **Import by character ID** (number from `dndbeyond.com/characters/12345`); or add the sheet to a D&D Beyond campaign |
| No encounters | Link your Grimoire campaign to a DDB campaign that has encounters |
| Rolls not appearing | Enable roll bridge; join a DDB campaign session with game log active |
