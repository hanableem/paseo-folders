# Folders for Paseo

English | [简体中文](README.zh-CN.md)

A [Paseo](https://paseo.sh) plugin that adds folders to the sidebar, so you can group workspaces by topic, not just by project. It can also merge workspaces and move a conversation to another workspace, which Paseo cannot do yet.

<img src="docs/sidebar.png" width="600" alt="The Folders section at the top of Paseo's sidebar: folders with workspace counts, one folder open, and a workspace's menu showing Move to folder with the list of folders">

- **Folders.** Put workspaces from any project into folders at the top of the sidebar, drag them from one folder to another, and drag them up or down to put them in order. Workspaces you have not filed wait under Unsorted, and **In progress**, above the folders, keeps the ones you are working on one click away.
- **Merge and split.** Drag a workspace onto another to merge them: its conversations become tabs there. Drag a single conversation onto another workspace to move it, or onto a folder to give it a workspace of its own. Experimental.
- **The same folders everywhere.** Folders are stored on your Paseo host, so your desktop and mobile apps show the same ones.

Paseo groups workspaces by project directory. If most of your work runs in the same directory, it ends up in one long list. This plugin adds folders on top of that, without changing projects, workspaces or agents. Once you use it, you can collapse the project in Paseo's own list.

## Features

- A **Folders** section at the top of the sidebar: one row per folder with its workspace count, and **Unsorted** for workspaces in no folder, shown even when empty, first unless you move it. Press a folder to open or close it; several can be open at once. An open folder lists eight workspaces, with **Show more** and **Show less** for the rest. A folder lists its workspaces newest first until you drag one into place; from then on it keeps your order, and workspaces new to it go on top. Rows show Paseo's status in front of the title (running ring, attention and error dots) and, for a single conversation, its provider's mark; a listed conversation shows its own the same way.
- The workspace Paseo is showing is highlighted, as in Paseo's own list. Native mobile apps cannot read which one that is, so there the highlight marks the workspace last opened from the folders.
- **In progress**, above the folders, lists the workspaces you are working on, wherever they are filed, so they are one click away. Workspaces pinned in Paseo come first, the latest pin on top; the others follow by your last message in them, newest first, eight in all. A pinned workspace, or one with something to see (a reply you have not read, a question, an error or a conversation still running), stays even past eight. Right-click a workspace and choose **Pin to In progress** or **Unpin from In progress**: this is Paseo's own **Pin to top**, so Paseo's list shows the pin too. Pinning goes through Paseo's internal daemon client, as moves do, so a Paseo update can break it. When you are done with a workspace, right-click it and choose **Remove from In progress**: it stays out, whatever it has to show, until you write in it again or pin it, and one that was pinned is unpinned. No older workspace takes its place: from then on In progress takes in only the workspaces you write in, besides those it lists, so it keeps just what you are working on. Drag In progress into order as you would a folder: drop a workspace on the top or bottom edge of one there to put it just above or below (a line shows where it will land). From then on it keeps your order: a workspace you pin or use comes in on top, and one that only fills a place left empty, at the bottom; to go back to pinned first, then last used, right-click a workspace there and choose **More** › **Reset In progress order**. Your order alone does not keep a workspace listed; pinning does, and a workspace from a folder dropped between the rows of In progress is pinned there. As in a folder, a workspace with several conversations shows how many; press the count and arrow to list them under it. Drop a workspace or a conversation on the middle of a workspace under In progress to merge it there, as on that workspace's row in its folder. Press **In progress** to collapse it.
- Hover a folder and press **+** (on touch screens, an open folder shows it) to make a new workspace already filed there. It is a local workspace in the project most of that folder's workspaces use, and opens on Paseo's own new-tab screen. Paseo names a workspace after the prompt it was created with; this one starts empty, so once its first conversation has answered, it takes that conversation's title unless you have named it. One you leave empty stays in the folder as **New workspace**, and a day after it was made the plugin archives it, unless it is open, has a terminal, or you have named or pinned it. No files are deleted; to remove it sooner, right-click it and choose **Archive**. For another project or a worktree, use Paseo's **New workspace** and move the result.
- With a mouse, drag a workspace onto a folder to move it, onto the top or bottom edge of another workspace to put it just above or below that one (a line shows where it will land; dropping it on its own folder puts it at the top), or onto the middle of another workspace to merge it into that one. A workspace with several conversations shows their count with an arrow; click it to list them, then drag one onto another workspace to move it there, or onto a folder to give it a workspace of its own in that folder. While you drag, the target row is outlined and a label under the pointer says what letting go will do. Hold the pointer near the top or bottom of the folders to scroll them, so rows out of view can still take the drop. Moves into another project ask first.
- Manage folders right in the sidebar: drag a folder up or down with the mouse to put it in order (a line shows where it will land), press the new-folder button on the **Folders** header to add one, and right-click a folder (or press its **⋮**, which touch screens show on open folders) to make a workspace in it, rename it, add a folder below it or delete it. Deleting happens at once and sends its workspaces back to Unsorted.
- Right-click a workspace, or long-press it on touch screens, for a menu modelled on Paseo's workspace menu: copy path, copy branch name, copy resume command and agent id, rename, **Pin to In progress**, **Remove from In progress** (for a workspace under In progress) and archive. **More** holds the rest: **Move to folder**, **Merge into workspace** and **Split off a conversation**, which dragging does too, and **Reset In progress order**. Paseo keeps a workspace's name apart from its conversations' titles, and a tab shows its conversation's title, so renaming a workspace that holds one conversation renames the conversation too: the tab then shows the same name. This goes through Paseo's internal daemon client, as pinning does.
- Right-click a listed conversation, long-press it on touch screens, or press its **⋮**, for its workspace's menu, for that conversation alone: copy path, copy branch name, copy resume command and agent id, **Rename conversation** and **Archive conversation**, which is what closing its tab does. Under **More** it moves as dragging it does: **Move to folder** (it gets a workspace of its own in that folder), **Move into workspace** (it becomes a tab there; type to search) and **Move to a new workspace**. Renaming changes the conversation's title, which its tab shows, and leaves the workspace's name alone. Pinning and In progress belong to the whole workspace, so they stay in the workspace's menu.
- Merging moves a workspace's conversations into another workspace, where they become tabs, and archives the emptied workspace. Splitting moves one conversation into a new workspace next to it. See [Merge and split workspaces](#merge-and-split-workspaces-experimental).
- A management screen, laid out like Paseo's settings, to create, rename and delete folders, put them in order (press and hold a folder, then drag it), and search every workspace and the conversations inside it. Unsorted can be renamed and moved like a folder, but not deleted.
- An optional suggestions file, so a script can propose folders and one-line notes per conversation.
- Folder data lives in Paseo plugin settings on the host, so your desktop and mobile apps share it.

Subagents and archived workspaces are left out.

## Requirements

Paseo 0.11.1 or newer on both the daemon and the app.

## Install

```bash
paseo plugin install https://github.com/hanableem/paseo-folders.git
```

or, from a local copy:

```bash
paseo plugin install /absolute/path/to/paseo-folders
```

Paseo asks you to trust the plugin. Its server part registers the settings document, reads the suggestions file, and moves conversations when you merge or split workspaces.

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
| `folders` | Folder names in display order. Missing folders are created; existing ones keep their position. A folder you deleted is not created again, and conversations suggested for it stay where they are, until you make a folder with that name yourself. A folder you renamed still takes the conversations suggested under its old name. |
| `assignments` | Agent ID to folder name. A workspace you have not placed yourself goes where most of its conversations point; a workspace with several conversations named exactly like a folder goes to that folder. |
| `notes` | Agent ID to a short note shown under the title and included in search. |
| `force` | Agent IDs whose suggested folder should win even over a manual placement, for moves the user requested through the other tool. A forced conversation also moves its workspace when it is the only conversation there. |

The plugin imports when the app starts and every ten minutes. An import that changes nothing saves nothing.

To read placements back, a script can read the plugin's settings document on the host: `<Paseo home>/plugin-settings/<installation id>/folders.json`. `values.workspaceAssignments` and `values.workspaceManual` hold the workspaces you placed by hand. `values.autoTitle` lists workspaces made from a folder that are still waiting for their first conversation's title or, while empty, to be archived. `values.removedFromRecent` holds when you removed workspaces from In progress (these fields keep its first name, Recent), `values.recentOrder` the order you dragged In progress into (empty for its own order), and `values.recentHeld` and `values.recentHeldAt` what In progress listed when you last removed a workspace from it, and when. `values.unsortedName` and `values.unsortedAt` hold the name you gave Unsorted (empty for the default) and how many folders come before it. `values.formerFolderNames` maps the old names of folders you renamed to their folder IDs, and `values.deletedFolderNames` lists the names of folders you deleted.

## Merge and split workspaces (experimental)

Paseo cannot yet move a tab from one workspace to another. The plugin does it for idle conversations:

- Drag a workspace onto another workspace, or right-click it and choose **More** › **Merge into workspace** (workspaces in the same folder are listed first; type to search the rest).
- Open a workspace's conversation list (the count and arrow on its row) and drag one conversation onto another workspace to move just that one, or right-click it and choose **More** › **Move into workspace**.
- Drag a listed conversation onto a folder to give it a workspace of its own there, or right-click it and choose **More** › **Move to folder**. **Move to a new workspace** there (or **Split off a conversation** under its workspace's **More**) keeps it in the same folder.

Moves within one project happen as soon as you let go. A move into another project opens a dialog first, naming both projects, because the conversation's commands and file changes happen in the new project from then on. Afterwards the workspace that received conversations opens, with its conversations listed. A workspace without a title of its own keeps the name it showed when you dropped on it, and a workspace named after a conversation (as a split names it) takes the name of the newest conversation left when that one moves out.

- Within one directory, Paseo archives the conversation and imports its session into the other workspace, reusing the same agent record: the conversation keeps its ID, history, title, mode and model.
- Into a workspace of another directory (another project), only Claude conversations can move. Claude Code resumes a session by ID from any directory and keeps writing to the transcript where it started, so the history stays; the agent gets a new Paseo ID, and its title, labels, mode, model, thinking option, folder and note are carried over. Before the old record is deleted, a copy is saved under `<Paseo home>/paseo-folders/moves/`. Paseo tells only the connection that deletes a record ([getpaseo/paseo#4870](https://github.com/getpaseo/paseo/issues/4870)), so the old record is archived first: every open Paseo window hears about that and closes the conversation's tab.
- A conversation that is running or waiting for a permission answer does not move; try again when it has finished.
- A moved conversation is added as the last tab. The workspaces involved stay in the folders they were in.
- If an import fails, the conversation is put back where it was.

The moves run in the plugin's server through Paseo's internal daemon client, at `PASEO_WS_URL` or the listen address in Paseo's `config.json`, so a Paseo update can break them. The scripts below do the same from a terminal.

## Split a conversation into its own workspace (experimental)

Paseo cannot yet move a tab to another workspace. `scripts/split-agent.mjs` does it for an idle agent: it creates a local workspace in the agent's directory, archives the agent, and imports its provider session into the new workspace. Paseo reuses the same agent record, so the conversation, its ID and its history stay intact.

```bash
node scripts/split-agent.mjs <agent-id> "<new workspace title>" --dry-run   # show what would move
node scripts/split-agent.mjs <agent-id> "<new workspace title>"
```

It uses Paseo's internal daemon client, the `paseo` CLI from `PATH` (or `PASEO_CLI`), and the daemon at `PASEO_WS_URL` (default `ws://127.0.0.1:6767/ws`). If the import fails, the agent stays archived and can be unarchived from History.

## Move a conversation to another project (experimental)

Paseo cannot change the directory a conversation runs in, so it cannot move one to another project. `scripts/move-agent.mjs` does it for an idle Claude agent: it creates a local workspace in the target directory, archives and deletes the agent's Paseo record and imports its Claude session there. Claude Code resumes a session by ID from any directory and keeps writing to the transcript where the session started, so the history stays and the conversation can go on. The agent gets a new Paseo ID; its title, labels, mode, model and thinking option are carried over, and so are its folder and note in Folders. If nothing else is left in the old workspace, it is archived and the new one takes its title and pin.

```bash
node scripts/move-agent.mjs <agent-id> <target-directory> --dry-run   # show what would move
node scripts/move-agent.mjs <agent-id> <target-directory>
```

Before deleting anything, the script saves the agent as Paseo returned it under `<Paseo home>/paseo-folders/moves/`. If the import fails, it imports the session back into the old workspace. As in the sidebar, archiving the record before deleting it makes open Paseo windows close the conversation's tab. One agent at a time: an agent that shares a workspace with others gets a workspace of its own. Loading the session can make Claude Code append its own bookkeeping lines to the transcript, and, if the session ended with background tasks still running, a notice that they stopped; no turn is run.

## Privacy

- No telemetry and no network requests of its own.
- It reads only the suggestions file at the configured path.
- To merge and split workspaces, its server connects to the Paseo daemon on your machine and writes a copy of each conversation that changes directories under `<Paseo home>/paseo-folders/moves/`.
- Nothing is uploaded; folder data stays in Paseo's settings storage on your host.

## Development

```bash
npm install
npm run check   # typecheck and unit tests
paseo plugin install "$PWD"
paseo plugin reload paseo-folders   # after changes
```

Unit tests cover the folder model in `shared/model.ts` and run with Node's built-in test runner.

To try merging by hand, make throwaway conversations outside any agent, or with `env -u PASEO_AGENT_ID paseo run …`: `paseo run` inside a Paseo agent labels the new conversation as that agent's subagent, and Folders does not list subagents.

To try the sidebar without touching the app window, drive Paseo's bundled web client headless: with Playwright, answer requests for `http://localhost:6767/` from the app's `Resources/app-dist` (and `index.html` for `/` and `/h/…`), let every other request through, and launch Chromium with `--disable-features=LocalNetworkAccessChecks`. The daemon accepts that origin, the client connects to it on its own, and the plugin loads from the daemon as in the app. Folder and workspace rows carry element IDs starting `paseo-folders-drop:` (a workspace's row under In progress ends in `:recent`), which a test can use to find them and to drag between them with the mouse. Moves made this way are real.

`README.zh-CN.md` is a Chinese translation of this file; change both together.

## License

MIT. See [LICENSE](LICENSE).
