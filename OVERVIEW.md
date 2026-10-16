Folders lets you sort your Paseo workspaces into folders. A Folders section at the top of the sidebar lists each folder with how many workspaces it holds. Open a folder to see its workspaces, newest first, with Paseo's own status indicators; Show more lists the rest. Press a workspace to open it. The workspace Paseo is showing is highlighted, as in its own list.

Hover a folder and press + to make a new workspace already in that folder. It opens on Paseo's new-tab screen and, once its first conversation has answered, takes that conversation's title.

To move a workspace, drag it onto another folder with the mouse, or right-click it (long-press on touch screens) and choose Move to folder. The same menu copies the path, branch, resume command and agent id, renames and archives. One folder is open at a time, so every folder stays on screen as a drop target.

To put conversations together, drag a workspace onto another workspace and confirm, or choose Merge into workspace from its menu: its conversations become tabs in the other workspace, and the emptied one is archived. Split off a conversation does the reverse for a workspace holding several. Conversations keep their history; a running one waits until it has finished. Conversations from another project can join only if they are Claude conversations. This uses Paseo internals and is experimental.

Workspaces that are in no folder appear under Unsorted, which opens by default when it has anything in it.

Open Folders from the sidebar to create, rename, reorder or delete folders, and to search across every workspace and the conversations inside it. Deleting a folder moves its workspaces back to Unsorted; nothing is archived or deleted in Paseo.

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

Suggestions are per conversation. A workspace you have not placed yourself goes where most of its conversations point. A workspace holding several conversations and named exactly like a folder goes to that folder. A workspace you moved by hand stays put, unless the other tool lists its only conversation in `force`.

## Data and privacy

Folder names, placements and notes are stored as Paseo plugin settings on the host, so every app connected to that host sees the same folders. Removing the plugin deletes them. The plugin reads the suggestions file and lists agents and workspaces through Paseo. To merge and split workspaces it connects to the Paseo daemon on the host, and it saves a copy of each conversation that moves to another project under `<Paseo home>/paseo-folders/moves/`. It makes no other network requests.
