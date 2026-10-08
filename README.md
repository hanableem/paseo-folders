# Folders for Paseo

A [Paseo](https://paseo.sh) plugin that sorts your conversations into folders in the sidebar.

Paseo groups conversations by project directory. If most of your conversations run in the same directory, they end up in one long list. This plugin adds folders on top of that, without changing projects, workspaces or agents.

## Features

- A **Folders** row at the top of the sidebar, followed by one row per folder with its conversation count, and **Unsorted** for the rest.
- A folder screen with search, an archived toggle, and a move button on every conversation. Tapping a conversation opens it.
- A management screen to create, rename, reorder and delete folders, and to search every conversation.
- An optional suggestions file, so a script can propose folders and one-line notes. Placements you make by hand always win, unless the script lists the conversation in `force`.
- Folder data lives in Paseo plugin settings on the host, so your desktop and mobile apps share it.

Subagents are hidden. Archived agents are listed and shown dimmed.

## Requirements

Paseo 0.11.1 or newer on both the daemon and the app.

## Install

```bash
paseo plugin install /absolute/path/to/paseo-folders
```

Paseo asks you to trust the plugin. Its server part only registers the settings document and reads the suggestions file.

## Suggestions file

Default location: `<Paseo home>/paseo-folders/suggestions.json` (`~/.paseo` unless `PASEO_HOME` is set). You can set another path on the Folders screen.

```json
{
  "version": 1,
  "folders": ["Work", "Reading"],
  "assignments": { "<agent id>": "Work" },
  "notes": { "<agent id>": "One line shown under the title" },
  "force": ["<agent id>"]
}
```

| Field | Meaning |
| --- | --- |
| `folders` | Folder names in display order. Missing folders are created; existing ones keep their position. |
| `assignments` | Agent ID to folder name. Skipped for conversations you placed by hand, unless forced. |
| `notes` | Agent ID to a short note shown under the title and included in search. |
| `force` | Agent IDs whose suggested folder should win even over a manual placement, for moves the user requested through the other tool. |

The plugin imports when the app starts and every ten minutes. An import that changes nothing saves nothing.

To read placements back, a script can read the plugin's settings document on the host: `<Paseo home>/plugin-settings/<installation id>/folders.json`. Its `values.manual` map marks conversations placed by hand.

## Privacy

- No telemetry and no network requests of its own.
- It reads only the suggestions file at the configured path.
- Nothing is uploaded; folder data stays in Paseo's settings storage on your host.

## Development

```bash
npm install
npm run check   # typecheck and unit tests
paseo plugin install "$PWD"
paseo plugin reload paseo-folders   # after changes
```

Unit tests cover the folder model in `shared/model.ts` and run with Node's built-in test runner.
