Folders lets you sort your Paseo workspaces into folders, merge workspaces, and move a conversation from one workspace to another. A Folders section at the top of the sidebar lists each folder with how many workspaces it holds. Open a folder to see its workspaces, newest first, with Paseo's own status indicators; Show more lists the rest. Press a workspace to open it. The workspace Paseo is showing is highlighted, as in its own list.

Recent, above the folders, lists the workspaces you used last, wherever they are filed: those pinned in Paseo first, then the others by your last message, eight in all. One with a reply you have not read, a question, an error or work in progress stays however long ago you used it. Right-click a workspace and choose Pin to Recent to keep it there (this is Paseo's own Pin to top), or Remove from Recent when you are done with it: no older workspace takes its place, and it comes back when you write in it again. Drag Recent into order as you would a folder; Reset Recent order in the same menu goes back to pinned first, then last used. A workspace there with several conversations lists them, as in a folder.

Hover a folder and press + to make a new workspace already in that folder. It opens on Paseo's new-tab screen and, once its first conversation has answered, takes that conversation's title. One left empty is archived a day after it was made, unless it is open, has a terminal, or you named or pinned it; no files are deleted.

To move a workspace, drag it onto another folder with the mouse, or right-click it (long-press on touch screens) and choose Move to folder. The same menu copies the path, branch, resume command and agent id, renames, pins to Recent or removes from it, and archives. Renaming a workspace that holds one conversation renames the conversation too, so its tab shows the same name. Folders open and close one by one, so several can be open at once; while you drag, holding the pointer near the top or bottom of the folders scrolls them, so rows out of view can still take the drop.

To put conversations together, drag a workspace onto another workspace, or choose Merge into workspace from its menu: its conversations become tabs in the other workspace, and the emptied one is archived. To take one out, click the count beside a workspace holding several to list its conversations, then drag one onto another workspace, or onto a folder to give it a workspace of its own there; Split off a conversation in the menu does the same. Right-click a listed conversation, or press its More button, to rename it, copy its resume command or agent id, or move it to a new workspace. A label under the pointer says what letting go will do. Moves into another project ask first. Conversations keep their history; a running one waits until it has finished. Conversations from another project can join only if they are Claude conversations. This uses Paseo internals and is experimental.

Workspaces that are in no folder appear under Unsorted, which opens by default when it has anything in it. You can rename Unsorted and move it among the folders; it cannot be deleted.

In the sidebar, drag a folder up or down with the mouse to put it in order; a line shows where it will go. Press the new-folder button on the Folders header to add a folder, and right-click a folder, or press its More button, to make a workspace in it, rename it, add a folder below it or delete it. Open Folders from the sidebar to do the same on touch screens, where you press and hold a folder and drag it, and to search across every workspace and the conversations inside it. Deleting a folder moves its workspaces back to Unsorted; nothing is archived or deleted in Paseo.

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
