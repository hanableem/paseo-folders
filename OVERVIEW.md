Folders lets you sort your Paseo conversations into folders. A Folders row at the top of the sidebar lists each folder with its conversation count. Opening a folder shows its conversations, newest first, with a search box. Tap a conversation to open it, or use its folder button to move it.

Every top-level agent on the host is included, archived ones too. Subagents are left out. Conversations that are in no folder appear under Unsorted.

Open Folders from the sidebar to create, rename, reorder or delete folders, and to search across all of them. Deleting a folder moves its conversations back to Unsorted; nothing is archived or deleted in Paseo.

## Suggestions file

Another tool, such as a script that classifies your conversations, can propose folders by writing a JSON file. By default the plugin reads `<Paseo home>/paseo-folders/suggestions.json`; you can set a different path in the Folders screen. It imports when the app starts and every ten minutes, and you can import by hand.

```json
{
  "version": 1,
  "folders": ["Work", "Reading"],
  "assignments": { "<agent id>": "Work" },
  "notes": { "<agent id>": "One line shown under the title" },
  "force": []
}
```

Folders are matched by name and created when missing. A conversation you moved by hand is never moved by an import, unless its ID is listed in `force`.

## Data and privacy

Folder names, placements and notes are stored as Paseo plugin settings on the host, so every app connected to that host sees the same folders. Removing the plugin deletes them. The plugin reads the suggestions file and lists agents through Paseo; it makes no other network requests.
