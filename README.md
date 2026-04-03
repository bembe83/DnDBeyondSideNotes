# D&D Beyond Notes Sidebar

A Chrome Extension (Manifest V3) that injects a styled notes panel into D&D Beyond character pages.

The panel is themed from the active character sheet UI and positioned near the right-side cards.

## Features

- Injects a custom notes sidebar on character pages:
  - `https://www.dndbeyond.com/characters/*`
- SVG-based frame and border that adapt to the sheet's colors.
- Per-character cloud persistence using `chrome.storage.sync` (notes follow you across devices).
- Large notes are automatically split into chunks to stay within the 8 KB per-item limit.
- Debounced autosave while typing.
- Font size controls (A- / A+) in the footer, also persisted via `chrome.storage.sync`.
- Repositions itself as the page updates (route changes, dynamic content, resize/scroll).

## Project Structure

- `manifest.json`: Extension manifest and permissions.
- `content.js`: Main content script (injection, theming, placement, storage).
- `styles.css`: Sidebar layout and styling.
- `notes-template.html`: HTML template used to build the sidebar UI.

## Requirements

- Google Chrome (or a Chromium browser supporting MV3).
- Access to D&D Beyond character pages.

## Installation (Developer Mode)

1. Open Chrome and go to `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this project folder: `DnDBeyondSideNotes`.

## Usage

1. Open any D&D Beyond character page.
2. The notes sidebar appears automatically.
3. Type in the sidebar — notes save automatically after a short delay.
4. Use the **A-** and **A+** buttons in the footer to decrease or increase the text size.
5. Notes and font size are stored per character ID and synced across Chrome profiles via `chrome.storage.sync`.

## Storage

Notes are stored in `chrome.storage.sync` under keys scoped to the character ID:

| Key | Contents |
|---|---|
| `ddb_notes_<id>_meta` | `{ chunks: N }` — number of chunks |
| `ddb_notes_<id>_c0` … `_cN` | Up to 7000-character text chunks |
| `ddb_notes_font_size` | Preferred font size (integer, 10–24) |

## Permissions

From `manifest.json`:

- `storage`: Save notes and preferences per character.
- `host_permissions`:
  - `https://www.dndbeyond.com/*`
- `content_scripts` on:
  - `https://www.dndbeyond.com/characters/*`

## Notes on Sync Behavior
## Development

After any code change:

1. Go to `chrome://extensions`.
2. Click **Reload** on the extension.
3. Refresh the D&D Beyond character page.

## Troubleshooting

- Sidebar not visible:
  - Verify URL matches `/characters/`.
  - Reload extension and refresh page.
- Colors not adapting:
  - Scroll or switch tabs/cards so sheet widgets render, then wait a moment for retry logic.
- Manifest warnings in VS Code:
  - If a non-Chrome JSON schema is active in your workspace, editor warnings can be false positives.

## License

No license file is currently included. Add a `LICENSE` file if you plan to publish publicly.
