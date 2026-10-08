# Folders for Paseo

A [Paseo](https://paseo.sh) plugin that sorts your workspaces into folders in the sidebar.

Paseo groups workspaces by project directory. If most of your work runs in the same directory, it ends up in one long list. This plugin adds folders on top of that, without changing projects, workspaces or agents. Once you use it, you can collapse the project in Paseo's own list.

## Features

- A **Folders** section at the top of the sidebar: **Unsorted** first, then one row per folder with its workspace count. One folder is open at a time and lists up to eight workspaces, with Paseo's running spinner and attention dot.
- Drag a workspace onto a folder to move it (long-press first on touch screens), or long-press it and tap a folder.
- A folder screen with search and a move button on every workspace.
- A management screen to create, rename, reorder and delete folders, and to search every workspace and the conversations inside it.
- An optional suggestions file, so a script can propose folders and one-line notes per conversation.
- Folder data lives in Paseo plugin settings on the host, so your desktop and mobile apps share it.

Subagents and archived workspaces are left out.

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
| `assignments` | Agent ID to folder name. A workspace you have not placed yourself goes where most of its conversations point; a workspace with several conversations named exactly like a folder goes to that folder. |
| `notes` | Agent ID to a short note shown under the title and included in search. |
| `force` | Agent IDs whose suggested folder should win even over a manual placement, for moves the user requested through the other tool. A forced conversation also moves its workspace when it is the only conversation there. |

The plugin imports when the app starts and every ten minutes. An import that changes nothing saves nothing.

To read placements back, a script can read the plugin's settings document on the host: `<Paseo home>/plugin-settings/<installation id>/folders.json`. `values.workspaceAssignments` and `values.workspaceManual` hold the workspaces you placed by hand.

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
