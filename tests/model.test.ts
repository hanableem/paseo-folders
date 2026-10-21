import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addFolder,
  applyForcedToWorkspaces,
  countWorkspacesByFolder,
  deleteFolder,
  dropAction,
  dropNodeId,
  dropNodePart,
  folderName,
  folderOf,
  folderOrder,
  FoldersDocumentSchema,
  groupWorkspaces,
  inFolderOrder,
  insertBefore,
  keepFolder,
  type ListedAgent,
  markAutoTitle,
  matchesWorkspace,
  mergeSuggestions,
  mergeTargets,
  mostCommon,
  moveAgent,
  moveFolder,
  moveFolderAmong,
  moveWorkspace,
  parseDropNodeId,
  parseRoute,
  placeNames,
  placementAt,
  placeWorkspace,
  reorderTarget,
  rowEdge,
  renameAgent,
  renameFolder,
  SuggestionsSchema,
  agentBucket,
  resumeCommand,
  sameDirectory,
  UNSORTED_ID,
  workspaceBucket,
  withoutAutoTitle,
  workspaceFolderOf,
} from "../shared/model.ts";

const empty = () => FoldersDocumentSchema.parse({});
const agent = (id: string, workspaceId: string, activityAt = "2026-01-01T00:00:00Z", title = id): ListedAgent => ({
  id,
  title,
  provider: "claude",
  workspaceId,
  workspaceName: "",
  archived: false,
  bucket: "done",
  sessionId: "",
  activityAt,
});
const withFolders = (...names: string[]) => names.reduce((d, n) => addFolder(d, n), empty());
const idOf = (doc: ReturnType<typeof empty>, name: string) => doc.folders.find((f) => f.name === name)!.id;

test("an empty document parses with defaults", () => {
  const doc = empty();
  assert.deepEqual(doc.folders, []);
  assert.deepEqual(doc.workspaceAssignments, {});
  assert.equal(doc.suggestionsPath, "");
});

test("adding folders ignores blanks and duplicates", () => {
  let doc = addFolder(empty(), "  Reading ");
  doc = addFolder(doc, "Reading");
  doc = addFolder(doc, "   ");
  assert.deepEqual(doc.folders.map((f) => f.name), ["Reading"]);
});

test("workspaces group active top-level agents, newest first, and take the workspace title", () => {
  const agents = [
    agent("a1", "w1", "2026-01-01T00:00:00Z"),
    agent("a2", "w1", "2026-01-03T00:00:00Z"),
    agent("b1", "w2", "2026-01-02T00:00:00Z", "Solo chat"),
    { ...agent("c1", "w3"), archived: true },
  ];
  const workspaces = groupWorkspaces(agents, new Map([["w1", "Daily"]]));
  assert.deepEqual(workspaces.map((w) => w.id), ["w1", "w2"]);
  assert.equal(workspaces[0].title, "Daily");
  assert.deepEqual(workspaces[0].agents.map((a) => a.id), ["a2", "a1"]);
  assert.equal(workspaces[1].title, "Solo chat");
});

test("a workspace goes where most of its conversations point; ties go to the newest", () => {
  let doc = withFolders("Health", "Money");
  doc = { ...doc, assignments: { a1: idOf(doc, "Health"), a2: idOf(doc, "Money"), a3: idOf(doc, "Money") } };
  const [ws] = groupWorkspaces(
    [agent("a1", "w", "2026-01-03T00:00:00Z"), agent("a2", "w", "2026-01-02T00:00:00Z"), agent("a3", "w", "2026-01-01T00:00:00Z")],
    new Map([["w", "Mixed"]]),
  );
  assert.equal(workspaceFolderOf(doc, ws), idOf(doc, "Money"));
  const tie = { ...ws, agents: ws.agents.slice(0, 2) };
  assert.equal(workspaceFolderOf(doc, tie), idOf(doc, "Health"));
});

test("a multi-conversation workspace named like a folder goes to that folder", () => {
  let doc = withFolders("Daily", "Health");
  doc = { ...doc, assignments: { a1: idOf(doc, "Health"), a2: idOf(doc, "Health") } };
  const [ws] = groupWorkspaces([agent("a1", "w"), agent("a2", "w")], new Map([["w", "Daily"]]));
  assert.equal(workspaceFolderOf(doc, ws), idOf(doc, "Daily"));
});

test("moving a workspace by hand wins over its conversations, including into Unsorted", () => {
  let doc = withFolders("A", "B");
  doc = { ...doc, assignments: { a1: idOf(doc, "A") } };
  const [ws] = groupWorkspaces([agent("a1", "w")], new Map());
  doc = moveWorkspace(doc, "w", idOf(doc, "B"));
  assert.equal(workspaceFolderOf(doc, ws), idOf(doc, "B"));
  assert.equal(doc.workspaceManual.w, true);
  doc = moveWorkspace(doc, "w", UNSORTED_ID);
  assert.equal(workspaceFolderOf(doc, ws), UNSORTED_ID);
});

test("deleting a folder returns its workspaces and agents to Unsorted", () => {
  let doc = withFolders("A", "B");
  const a = idOf(doc, "A");
  doc = moveWorkspace(moveAgent(doc, "x", a), "w", a);
  doc = deleteFolder(doc, a);
  assert.equal(folderOf(doc, "x"), UNSORTED_ID);
  assert.equal(doc.workspaceAssignments.w, undefined);
  assert.equal(doc.workspaceManual.w, undefined);
});

const names = (doc: ReturnType<typeof empty>) => folderOrder(doc).map((f) => f.name);

test("renaming refuses a name another folder or Unsorted uses; reordering counts Unsorted and stays in bounds", () => {
  let doc = withFolders("A", "B");
  const [a, b] = doc.folders;
  assert.equal(renameFolder(doc, b.id, "A"), doc);
  assert.equal(renameFolder(doc, b.id, "Unsorted"), doc);
  doc = renameFolder(doc, b.id, "C");
  assert.deepEqual(names(doc), ["Unsorted", "A", "C"]);
  assert.equal(moveFolder(doc, a.id, 1), doc);
  doc = moveFolder(doc, a.id, 2);
  assert.deepEqual(names(doc), ["Unsorted", "C", "A"]);
  doc = moveFolder(doc, a.id, -5);
  assert.deepEqual(names(doc), ["A", "Unsorted", "C"]);
  doc = withFolders("A", "B", "C", "D");
  doc = moveFolder(doc, idOf(doc, "A"), 9);
  assert.deepEqual(names(doc), ["Unsorted", "B", "C", "D", "A"]);
});

test("Unsorted moves and takes a name but cannot be deleted, and keeps its place when folders go", () => {
  assert.deepEqual(names(withFolders("X")), ["Unsorted", "X"]);
  let doc = withFolders("A", "B", "C");
  doc = moveFolder(doc, UNSORTED_ID, 2);
  assert.deepEqual(names(doc), ["A", "B", "Unsorted", "C"]);
  doc = renameFolder(doc, UNSORTED_ID, " Inbox ");
  assert.equal(folderName(doc, UNSORTED_ID), "Inbox");
  assert.equal(renameFolder(doc, UNSORTED_ID, "A"), doc);
  assert.equal(addFolder(doc, "Inbox"), doc);
  assert.equal(deleteFolder(doc, UNSORTED_ID), doc);
  doc = deleteFolder(doc, idOf(doc, "A"));
  assert.deepEqual(names(doc), ["B", "Inbox", "C"]);
  doc = deleteFolder(doc, idOf(doc, "C"));
  doc = addFolder(doc, "D");
  assert.deepEqual(names(doc), ["B", "Inbox", "D"]);
  assert.equal(folderName(doc, idOf(doc, "D")), "D");
  assert.equal(renameFolder(doc, UNSORTED_ID, "Unsorted").unsortedName, "");
});

test("a dragged row lands where its middle passes the middles of the others", () => {
  const rows = [0, 48, 96, 144].map((y) => ({ y, height: 48 }));
  assert.equal(reorderTarget(rows, 1, 0), 1);
  assert.equal(reorderTarget(rows, 1, 20), 1);
  assert.equal(reorderTarget(rows, 1, 30), 2);
  assert.equal(reorderTarget(rows, 1, -30), 0);
  assert.equal(reorderTarget(rows, 0, 500), 3);
  assert.equal(reorderTarget(rows, 3, -500), 0);
  assert.equal(reorderTarget(rows, 7, 0), 7);
});

test("a new folder can go right after another one, Unsorted included", () => {
  const doc = moveFolder(withFolders("A", "B"), UNSORTED_ID, 2);
  assert.deepEqual(names(doc), ["A", "B", "Unsorted"]);
  assert.deepEqual(names(addFolder(doc, "C", idOf(doc, "A"))), ["A", "C", "B", "Unsorted"]);
  assert.deepEqual(names(addFolder(doc, "C", idOf(doc, "B"))), ["A", "B", "C", "Unsorted"]);
  assert.deepEqual(names(addFolder(doc, "C", UNSORTED_ID)), ["A", "B", "Unsorted", "C"]);
  assert.deepEqual(names(addFolder(doc, "C", "gone")), ["A", "B", "Unsorted", "C"]);
  assert.equal(addFolder(doc, "A", idOf(doc, "B")), doc);
});

test("reordering the folders on screen keeps a hidden Unsorted beside a neighbour", () => {
  const doc = moveFolder(withFolders("A", "B", "C"), UNSORTED_ID, 1);
  assert.deepEqual(names(doc), ["A", "Unsorted", "B", "C"]);
  const shown = ["A", "B", "C"].map((n) => idOf(doc, n));
  const [a, b, c] = shown;
  assert.deepEqual(names(moveFolderAmong(doc, shown, b, 0)), ["B", "A", "Unsorted", "C"]);
  assert.deepEqual(names(moveFolderAmong(doc, shown, a, 2)), ["Unsorted", "B", "C", "A"]);
  assert.deepEqual(names(moveFolderAmong(doc, shown, c, 1)), ["A", "Unsorted", "C", "B"]);
  assert.equal(moveFolderAmong(doc, shown, b, 1), doc);
  assert.equal(moveFolderAmong(doc, [a, "gone"], a, 1), doc);
  const all = folderOrder(doc).map((f) => f.id);
  assert.deepEqual(names(moveFolderAmong(doc, all, UNSORTED_ID, 3)), ["A", "B", "C", "Unsorted"]);
});

test("imports create missing folders by name and never move hand-placed agents", () => {
  let doc = withFolders("Health");
  const health = idOf(doc, "Health");
  doc = moveAgent(doc, "kept", health);
  const suggestions = SuggestionsSchema.parse({
    version: 1,
    folders: ["Health", "Daily"],
    assignments: { kept: "Daily", fresh: "Daily", other: "Language" },
    notes: { fresh: "Asked about a router" },
  });
  const result = mergeSuggestions(doc, suggestions, "2026-01-02T00:00:00Z");
  assert.equal(result.createdFolders, 2);
  assert.equal(result.placed, 2);
  assert.equal(result.keptManual, 1);
  assert.equal(folderOf(result.doc, "kept"), health);
  assert.equal(folderOf(result.doc, "fresh"), idOf(result.doc, "Daily"));
  assert.equal(result.doc.notes.fresh, "Asked about a router");
  const again = mergeSuggestions(result.doc, suggestions, "2026-01-03T00:00:00Z");
  assert.equal(again.placed, 0);
  assert.equal(again.doc, result.doc, "an unchanged import must not produce a new document to save");
});

test("imports do not make a deleted folder again until the user makes one with that name", () => {
  let doc = withFolders("Daily", "News");
  doc = moveAgent(doc, "x", idOf(doc, "Daily"));
  doc = deleteFolder(doc, idOf(doc, "News"));
  const s = SuggestionsSchema.parse({ version: 1, folders: ["Daily", "News"], assignments: { x: "News", y: "News" }, force: ["x"] });
  const result = mergeSuggestions(doc, s, "2026-01-05T00:00:00Z");
  assert.deepEqual(result.doc.folders.map((f) => f.name), ["Daily"]);
  assert.equal(result.forDeletedFolders, 2, "forced or not, a suggestion for a deleted folder is left out");
  assert.equal(folderOf(result.doc, "x"), idOf(doc, "Daily"), "and the agent stays where it was");
  assert.equal(folderOf(result.doc, "y"), UNSORTED_ID);
  assert.equal(result.doc, doc, "an import that only meets deleted folders saves nothing");
  const remade = addFolder(doc, "News");
  assert.deepEqual(remade.deletedFolderNames, []);
  assert.equal(folderOf(mergeSuggestions(remade, s, "2026-01-05T00:00:00Z").doc, "y"), idOf(remade, "News"));
});

test("a renamed folder keeps the conversations a suggestions file files under its old name", () => {
  let doc = withFolders("Health");
  const health = idOf(doc, "Health");
  doc = renameFolder(doc, health, "Health & Fitness");
  const s = SuggestionsSchema.parse({ version: 1, folders: ["Health"], assignments: { x: "Health" } });
  const result = mergeSuggestions(doc, s, "2026-01-06T00:00:00Z");
  assert.equal(result.createdFolders, 0);
  assert.equal(folderOf(result.doc, "x"), health);
  const back = renameFolder(doc, health, "Health");
  assert.deepEqual(back.formerFolderNames, { "Health & Fitness": health });
  const taken = addFolder(doc, "Health");
  assert.equal(folderOf(mergeSuggestions(taken, s, "2026-01-06T00:00:00Z").doc, "x"), idOf(taken, "Health"));
  const gone = deleteFolder(doc, health);
  assert.deepEqual([...gone.deletedFolderNames].sort(), ["Health", "Health & Fitness"]);
  assert.deepEqual(gone.formerFolderNames, {});
  assert.equal(mergeSuggestions(gone, s, "2026-01-06T00:00:00Z").createdFolders, 0);
});

test("a forced suggestion re-files a hand-placed agent and its single-conversation workspace", () => {
  let doc = withFolders("A", "B");
  doc = moveWorkspace(moveAgent(doc, "x", idOf(doc, "A")), "w", idOf(doc, "A"));
  const s = SuggestionsSchema.parse({ version: 1, assignments: { x: "B" }, force: ["x"] });
  const merged = mergeSuggestions(doc, s, "2026-01-04T00:00:00Z").doc;
  assert.equal(folderOf(merged, "x"), idOf(merged, "B"));
  const workspaces = groupWorkspaces([agent("x", "w")], new Map());
  const filed = applyForcedToWorkspaces(merged, s.force, workspaces);
  assert.equal(workspaceFolderOf(filed, workspaces[0]), idOf(filed, "B"));
  const shared = groupWorkspaces([agent("x", "v"), agent("y", "v")], new Map());
  assert.equal(applyForcedToWorkspaces(merged, s.force, shared), merged, "a shared workspace stays put");
});

test("counts use workspaces, and search covers titles of the conversations inside", () => {
  let doc = withFolders("A");
  doc = { ...doc, assignments: { a1: idOf(doc, "A") } };
  const workspaces = groupWorkspaces([agent("a1", "w1", undefined, "Router setup"), agent("b1", "w2")], new Map());
  const counts = countWorkspacesByFolder(doc, workspaces);
  assert.equal(counts[idOf(doc, "A")], 1);
  assert.equal(counts[UNSORTED_ID], 1);
  assert.ok(matchesWorkspace(workspaces.find((w) => w.id === "w1")!, {}, "router"));
  assert.ok(matchesWorkspace(workspaces.find((w) => w.id === "w2")!, { b1: "about Wi-Fi" }, "wi-fi"));
  assert.ok(!matchesWorkspace(workspaces.find((w) => w.id === "w2")!, {}, "printer"));
});

test("suggestions files must declare version 1", () => {
  assert.ok(!SuggestionsSchema.safeParse({ folders: [] }).success);
  assert.ok(SuggestionsSchema.safeParse({ version: 1 }).success);
});

test("status buckets follow Paseo's order: permission, error, running, unread, done", () => {
  assert.equal(agentBucket({ status: "running", pendingPermissionCount: 1 }), "needs_input");
  assert.equal(agentBucket({ status: "idle", attentionReason: "error", requiresAttention: true }), "failed");
  assert.equal(agentBucket({ status: "initializing" }), "running");
  assert.equal(agentBucket({ status: "idle", requiresAttention: true, attentionReason: "finished" }), "attention");
  assert.equal(agentBucket({ status: "idle" }), "done");
  const ws = { agents: [{ bucket: "attention" as const }, { bucket: "running" as const }, { bucket: "done" as const }] };
  assert.equal(workspaceBucket(ws), "running");
});

test("resume commands match Paseo's tab menu", () => {
  assert.equal(resumeCommand("claude", "abc"), "claude --resume abc");
  assert.equal(resumeCommand("codex/gpt", "t1"), "codex resume t1");
  assert.equal(resumeCommand("grok", "x"), null);
  assert.equal(resumeCommand("claude", ""), null);
});

test("routes name the workspace, agent or plugin screen Paseo shows", () => {
  assert.deepEqual(parseRoute("/h/srv/workspace/w%3A1"), { kind: "workspace", id: "w:1" });
  assert.deepEqual(parseRoute("/h/srv/agent/a1"), { kind: "agent", id: "a1" });
  assert.deepEqual(parseRoute("/h/srv/plugin/paseo-folders/screen/open"), { kind: "plugin", pluginId: "paseo-folders" });
  assert.equal(parseRoute("/new"), null);
  assert.equal(parseRoute("/h/srv"), null);
  assert.deepEqual(parseRoute("/h/srv/workspace/%E0%A4%A"), { kind: "workspace", id: "%E0%A4%A" });
});

test("the usual project is the most common one, first seen on ties", () => {
  assert.equal(mostCommon(["/a", "/b", "/b", ""]), "/b");
  assert.equal(mostCommon(["/a", "/b"]), "/a");
  assert.equal(mostCommon(["", ""]), null);
});

test("workspaces made from a folder wait for a title until settled", () => {
  const doc = markAutoTitle(empty(), "w1", "2026-10-08T00:00:00Z");
  assert.deepEqual(doc.autoTitle, { w1: "2026-10-08T00:00:00Z" });
  assert.deepEqual(withoutAutoTitle(doc, ["w1"]).autoTitle, {});
  assert.equal(withoutAutoTitle(doc, ["w2"]), doc);
  assert.deepEqual(FoldersDocumentSchema.parse({ folders: [] }).autoTitle, {});
});

test("a moved conversation keeps its folder, hand placement and note under its new agent ID", () => {
  let doc = withFolders("Health");
  doc = { ...doc, assignments: { a1: idOf(doc, "Health") }, manual: { a1: true }, notes: { a1: "blood tests" } };
  const moved = renameAgent(doc, "a1", "n1");
  assert.deepEqual(moved.assignments, { n1: idOf(doc, "Health") });
  assert.deepEqual(moved.manual, { n1: true });
  assert.deepEqual(moved.notes, { n1: "blood tests" });
  assert.equal(renameAgent(doc, "a1", "a1"), doc, "an unchanged ID changes nothing");
  assert.equal(renameAgent(moved, "a1", "n2"), moved, "an ID with nothing filed under it changes nothing");
});

test("a workspace that gains or loses conversations stays in the folder it showed in", () => {
  let doc = withFolders("Chores", "Money");
  doc = { ...doc, assignments: { t1: idOf(doc, "Chores"), m1: idOf(doc, "Money"), m2: idOf(doc, "Money") } };
  const target = { id: "w1", title: "Chores", agents: [{ id: "t1" }] };
  assert.equal(keepFolder(doc, target, idOf(doc, "Chores")), doc, "nothing to pin while it would stay anyway");
  const merged = keepFolder(doc, { ...target, title: "Errands", agents: [{ id: "t1" }, { id: "m1" }, { id: "m2" }] }, idOf(doc, "Chores"));
  assert.equal(merged.workspaceAssignments.w1, idOf(doc, "Chores"));
  assert.equal(merged.workspaceManual.w1, true);
});

test("merge targets list the workspace's own folder first, newest first, and follow the search", () => {
  let doc = withFolders("Chores", "Money");
  doc = { ...doc, assignments: { a: idOf(doc, "Chores"), b: idOf(doc, "Chores"), c: idOf(doc, "Money"), d: idOf(doc, "Chores") } };
  const workspaces = groupWorkspaces(
    [
      agent("a", "wa", "2026-01-01T00:00:00Z", "Dishes"),
      agent("b", "wb", "2026-01-02T00:00:00Z", "Laundry"),
      agent("c", "wc", "2026-01-05T00:00:00Z", "Taxes"),
      agent("d", "wd", "2026-01-03T00:00:00Z", "Recycling"),
    ],
    new Map(),
  );
  const source = workspaces.find((w) => w.id === "wa")!;
  assert.deepEqual(mergeTargets(doc, workspaces, source, "").map((w) => w.id), ["wd", "wb", "wc"]);
  assert.deepEqual(mergeTargets(doc, workspaces, source, "tax").map((w) => w.id), ["wc"]);
  assert.deepEqual(mergeTargets(doc, workspaces, source, "dishes"), [], "never itself");
});

test("drops file a workspace, move conversations into another workspace, or give one its own workspace", () => {
  let doc = withFolders("Chores", "Money");
  doc = { ...doc, assignments: { a: idOf(doc, "Chores"), b: idOf(doc, "Chores") } };
  const listed = groupWorkspaces([agent("a", "wa"), agent("b", "wa"), agent("c", "wc")], new Map());
  const two = listed.find((w) => w.id === "wa")!;
  const one = listed.find((w) => w.id === "wc")!;
  const whole = { kind: "workspace" as const, ws: two };
  const single = { kind: "conversation" as const, ws: two, agent: two.agents[0] };
  const folder = (name: string) => ({ kind: "folder" as const, id: name === "Unsorted" ? UNSORTED_ID : idOf(doc, name) });
  const workspace = (id: string) => ({ kind: "workspace" as const, id });

  assert.deepEqual(dropAction(doc, whole, folder("Money")), { kind: "file", folderId: idOf(doc, "Money") });
  assert.equal(dropAction(doc, whole, folder("Chores")), null, "already in that folder");
  assert.deepEqual(dropAction(doc, whole, workspace("wc")), { kind: "merge", workspaceId: "wc" });
  assert.equal(dropAction(doc, whole, workspace("wa")), null, "onto itself");
  assert.equal(dropAction(doc, whole, null), null);
  assert.deepEqual(dropAction(doc, single, workspace("wc")), { kind: "merge", workspaceId: "wc" });
  assert.equal(dropAction(doc, single, workspace("wa")), null, "back onto its own workspace");
  assert.deepEqual(dropAction(doc, single, folder("Chores")), { kind: "split", folderId: idOf(doc, "Chores") }, "its own folder too");
  assert.deepEqual(dropAction(doc, single, folder("Unsorted")), { kind: "split", folderId: UNSORTED_ID });
  const blank = { id: "wn", title: "New workspace", agents: [], activityAt: "2026-01-01T00:00:00Z" };
  assert.equal(dropAction(doc, { kind: "workspace", ws: blank }, workspace("wc")), null, "nothing to move");
  assert.deepEqual(dropAction(doc, { kind: "workspace", ws: one }, workspace("wn")), { kind: "merge", workspaceId: "wn" });
});

test("drop targets round-trip through element IDs, conversation rows standing for their workspace", () => {
  const ws = { kind: "workspace" as const, id: "wks_1" };
  assert.deepEqual(parseDropNodeId(dropNodeId(ws)), ws);
  assert.deepEqual(parseDropNodeId(dropNodeId(ws, "agent:with/odd chars")), ws);
  assert.deepEqual(parseDropNodeId(dropNodeId({ kind: "folder", id: UNSORTED_ID })), { kind: "folder", id: UNSORTED_ID });
  assert.equal(parseDropNodeId("root"), null);
  assert.equal(parseDropNodeId("paseo-folders-drop:shelf:x"), null);
  assert.equal(parseDropNodeId(null), null);
  assert.equal(dropNodePart(dropNodeId(ws, "agent:with/odd chars")), "agent:with/odd chars");
  assert.equal(dropNodePart(dropNodeId(ws)), null);
  assert.equal(dropNodePart("root"), null);
});

test("directories compare without trailing slashes; places read apart by project, else by path", () => {
  assert.ok(sameDirectory("/Users/me/notes/", "/Users/me/notes"));
  assert.ok(!sameDirectory("/Users/me/notes", "/Users/me/notes-2"));
  assert.ok(sameDirectory("/", "//"));
  const notes = { directory: "/Users/me/notes", projectName: "notes" };
  const code = { directory: "/Users/me/Developer/app", projectName: "app" };
  assert.deepEqual(placeNames(notes, code), ["notes", "app"]);
  const worktree = { directory: "/Users/me/Developer/app-wt", projectName: "app" };
  assert.deepEqual(placeNames(code, worktree), ["~/Developer/app", "~/Developer/app-wt"]);
  assert.deepEqual(placeNames({ directory: "/srv/a", projectName: "" }, code), ["/srv/a", "~/Developer/app"]);
});

const ids = (list: readonly { id: string }[]) => list.map((w) => w.id);

test("a folder put in order keeps it, with workspaces it has not ranked yet on top, newest first", () => {
  let doc = withFolders("Reading");
  const r = idOf(doc, "Reading");
  const listed = [{ id: "new2" }, { id: "w3" }, { id: "new1" }, { id: "w1" }, { id: "w2" }];
  assert.deepEqual(ids(inFolderOrder(doc, r, listed)), ["new2", "w3", "new1", "w1", "w2"], "newest first without an order");
  doc = { ...doc, workspaceOrder: { [r]: ["w2", "gone", "w1", "w3"] } };
  assert.deepEqual(ids(inFolderOrder(doc, r, listed)), ["new2", "new1", "w2", "w1", "w3"]);
  assert.deepEqual(ids(inFolderOrder(doc, UNSORTED_ID, listed)), ids(listed), "other folders keep newest first");
});

test("inserting takes the workspace out and puts it back above the given one, or at the end", () => {
  const shown = ["a", "b", "c", "d"];
  assert.deepEqual(insertBefore(shown, "d", "b"), ["a", "d", "b", "c"]);
  assert.deepEqual(insertBefore(shown, "a", "d"), ["b", "c", "a", "d"]);
  assert.deepEqual(insertBefore(shown, "b", null), ["a", "c", "d", "b"]);
  assert.deepEqual(insertBefore(shown, "x", "a"), ["x", "a", "b", "c", "d"], "one from another folder");
  assert.deepEqual(insertBefore(shown, "c", "c"), shown, "above itself stays put");
  assert.equal(insertBefore(shown, "a", "missing"), null);
});

test("placing a workspace saves the folder's order as shown and files it there by hand", () => {
  let doc = withFolders("Reading", "Chores");
  const [r, c] = [idOf(doc, "Reading"), idOf(doc, "Chores")];
  doc = placeWorkspace(doc, "w3", r, ["w1", "w2", "w3"], "w1");
  assert.deepEqual(doc.workspaceOrder[r], ["w3", "w1", "w2"]);
  assert.equal(doc.workspaceAssignments.w3, r);
  assert.equal(doc.workspaceManual.w3, true);
  assert.equal(doc.workspaceManual.w1, undefined, "its neighbours keep their own placement");
  doc = placeWorkspace(doc, "w1", c, ["c1"], null);
  assert.deepEqual(doc.workspaceOrder[c], ["c1", "w1"]);
  assert.deepEqual(doc.workspaceOrder[r], ["w3", "w2"], "the folder it left lets go of it");
  assert.equal(placeWorkspace(doc, "w2", r, ["w3", "w2"], "missing"), doc);
});

test("filing a workspace elsewhere drops it from other orders; deleting a folder drops its order", () => {
  let doc = withFolders("Reading", "Chores");
  const [r, c] = [idOf(doc, "Reading"), idOf(doc, "Chores")];
  doc = { ...doc, workspaceOrder: { [r]: ["w1", "w2"], [c]: ["c1"] } };
  const kept = moveWorkspace(doc, "w1", r);
  assert.deepEqual(kept.workspaceOrder[r], ["w1", "w2"], "staying in its folder keeps its place");
  doc = moveWorkspace(doc, "w1", c);
  assert.deepEqual(doc.workspaceOrder[r], ["w2"]);
  assert.deepEqual(doc.workspaceOrder[c], ["c1"], "it starts unranked, so on top, in the new folder");
  doc = deleteFolder(doc, r);
  assert.equal(doc.workspaceOrder[r], undefined);
});

test("a row's top and bottom quarters are its edges; the middle is the row itself", () => {
  const row = { y: 100, height: 40 };
  assert.equal(rowEdge(row, 100), "above");
  assert.equal(rowEdge(row, 109), "above");
  assert.equal(rowEdge(row, 110), null);
  assert.equal(rowEdge(row, 129), null);
  assert.equal(rowEdge(row, 130), "below");
  assert.equal(rowEdge(row, 139), "below");
});

test("dropping a workspace between rows places it; dropping where it is does nothing", () => {
  let doc = withFolders("Reading", "Chores");
  const [r, c] = [idOf(doc, "Reading"), idOf(doc, "Chores")];
  const ws = (id: string) => ({ id, title: id, agents: [{ id: `${id}-a` }] });
  doc = { ...moveWorkspace(moveWorkspace(moveWorkspace(doc, "w1", r), "w2", r), "w3", r), workspaceOrder: {} };
  const lists = new Map([[r, [ws("w1"), ws("w2"), ws("w3")]], [c, [ws("c1")]]]);
  const row = (id: string) => ({ kind: "workspace" as const, id });
  const folder = (id: string) => ({ kind: "folder" as const, id });
  assert.deepEqual(placementAt(doc, lists, ws("w3"), row("w1"), "above"), { kind: "place", folderId: r, before: "w1" });
  assert.deepEqual(placementAt(doc, lists, ws("w1"), row("w2"), "below"), { kind: "place", folderId: r, before: "w3" });
  assert.deepEqual(placementAt(doc, lists, ws("w1"), row("w3"), "below"), { kind: "place", folderId: r, before: null });
  assert.equal(placementAt(doc, lists, ws("w2"), row("w1"), "below"), null, "just below the row above it");
  assert.equal(placementAt(doc, lists, ws("w2"), row("w3"), "above"), null, "just above the row below it");
  assert.equal(placementAt(doc, lists, ws("w2"), row("w2"), "above"), null, "its own row");
  assert.equal(placementAt(doc, lists, ws("w3"), row("w1"), null), undefined, "the middle of a row merges");
  assert.deepEqual(placementAt(doc, lists, ws("w3"), folder(r), null), { kind: "place", folderId: r, before: "w1" }, "own folder: to the top");
  assert.equal(placementAt(doc, lists, ws("w1"), folder(r), null), null, "already at the top");
  assert.equal(placementAt(doc, lists, ws("w1"), folder(c), null), undefined, "another folder files it");
  assert.deepEqual(placementAt(doc, lists, ws("w1"), row("c1"), "above"), { kind: "place", folderId: c, before: "c1" });
});
