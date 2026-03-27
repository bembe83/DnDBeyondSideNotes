# D&D Beyond Notes Sidebar

A Chrome Extension (Manifest V3) that injects a styled notes panel into D&D Beyond character pages.

The panel is themed from the active character sheet UI, positioned near the right-side cards, and synced with D&D Beyond's native notes area.

## Features

- Injects a custom notes sidebar on character pages:
  - `https://www.dndbeyond.com/characters/*`
- SVG-based frame and border that adapt to the sheet's colors.
- Per-character local persistence using `chrome.storage.local`.
- Debounced autosave while typing.
- Two-way sync with D&D Beyond notes:
  - Reads from `.ct-notes` (last `.ct-notes__note`).
  - Writes back to native editable notes input when available.
- Repositions itself as the page updates (route changes, dynamic content, resize/scroll).

## Project Structure

- `manifest.json`: Extension manifest and permissions.
- `content.js`: Main content script (injection, theming, sync, placement, storage).
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
3. Type in the sidebar to save notes.
4. Notes are stored per character ID and synced with D&D Beyond notes when native notes are present.

## Permissions

From `manifest.json`:

- `storage`: Save notes per character.
- `host_permissions`:
  - `https://www.dndbeyond.com/*`
- `content_scripts` on:
  - `https://www.dndbeyond.com/characters/*`

## Notes on Sync Behavior

- The extension targets the `.ct-notes` section and uses the last `.ct-notes__note` as the source.
- If D&D Beyond lazy-loads notes content, sync starts once notes exist in the DOM.
- Local sidebar storage remains active even when native notes controls are not editable.

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
- Native notes not syncing immediately:
  - Open the notes area at least once if the page lazily injects it.
- Manifest warnings in VS Code:
  - If a non-Chrome JSON schema is active in your workspace, editor warnings can be false positives.

## License

No license file is currently included. Add a `LICENSE` file if you plan to publish publicly.
