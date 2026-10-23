Folders lets you sort your Paseo workspaces into folders, keeps the ones you are working on at the top, and merges workspaces or moves a conversation from one workspace to another, which Paseo cannot do yet.

A Folders section at the top of the sidebar lists each folder with how many workspaces it holds. Open a folder to see its workspaces, newest first, with Paseo's own status indicators; Show more lists the rest. Press a workspace to open it. The workspace Paseo is showing is highlighted, as in its own list. Workspaces that are in no folder appear under Unsorted, which is open by default when it has anything in it. You can rename Unsorted and move it among the folders; it cannot be deleted.

In progress, above the folders, lists the workspaces you are working on, wherever they are filed: those pinned in Paseo first, then the others by your last message, eight in all. One with a reply you have not read, a question, an error or a conversation still running stays however long ago you used it. Pin to In progress, in a workspace's menu, is Paseo's own Pin to top. Remove from In progress takes a workspace out when you are done with it: no older workspace takes its place, and it comes back when you write in it again. Drag In progress into order as you would a folder; Reset In progress order, under More in the menu, goes back to pinned first, then last used. A workspace there with several conversations lists them, as in a folder.

To move a workspace, drag it onto another folder with the mouse, or right-click it (long-press on touch screens) and choose More, then Move to folder. Drop it on the top or bottom edge of another workspace to put it just above or below; a line shows where it will land, and a label under the pointer says what letting go will do. Folders open and close one by one, so several can be open at once; while you drag, holding the pointer near the top or bottom of the folders scrolls them, so rows out of view can still take the drop.

Hover a folder and press + to make a new workspace already in that folder. It opens on Paseo's new-tab screen and, once its first conversation has answered, takes that conversation's title. One left empty is archived a day after it was made, unless it is open, has a terminal, or you named or pinned it; no files are deleted.

To put conversations together, drag a workspace onto another workspace, or choose More, then Merge into workspace from its menu: its conversations become tabs in the other workspace, and the emptied one is archived. To take one out, click the count beside a workspace holding several to list its conversations, then drag one onto another workspace, or onto a folder to give it a workspace of its own there. Moves into another project ask first. Conversations keep their history; a running one waits until it has finished. Conversations from another project can join only if they are Claude conversations. This uses Paseo internals and is experimental.

A workspace's menu, modelled on Paseo's, copies the path, branch, resume command and agent id, renames the workspace, pins it to In progress or removes it from there, and archives it; its More holds Move to folder, Merge into workspace, Split off a conversation and Reset In progress order. Renaming a workspace that holds one conversation renames the conversation too, so its tab shows the same name. Right-click a listed conversation, or press its ⋮ button, for the same menu for that conversation alone: copy its path or ids, rename it or archive it, and under More, move it to a folder, into another workspace or to a new one.

In the sidebar, drag a folder up or down with the mouse to put it in order; a line shows where it will go. Press the new-folder button on the Folders header to add a folder, and right-click a folder, or press its ⋮ button, to make a workspace in it, rename it, add a folder below it or delete it. Press Folders itself to open the Folders screen, where you can do the same on touch screens, pressing and holding a folder to drag it, and search across every workspace and the conversations inside it. Deleting a folder moves its workspaces back to Unsorted; nothing is archived or deleted in Paseo.

## Suggestions file

Another tool, such as a script that sorts your conversations, can propose folders by writing a JSON file. By default the plugin reads `<Paseo home>/paseo-folders/suggestions.json`; you can set a different path on the Folders screen. It imports when the app starts and every ten minutes, and you can import by hand.

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

Folder names, placements and notes are stored as Paseo plugin settings on the host, so every app connected to that host sees the same folders. Removing the plugin deletes them. The plugin reads the suggestions file and lists agents and workspaces through Paseo. To pin, rename, merge and split workspaces it connects to the Paseo daemon on the host, and it saves the Paseo record of each conversation that moves to another project under `<Paseo home>/paseo-folders/moves/`. It makes no other network requests.
