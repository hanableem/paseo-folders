import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addFolder,
  applyForcedToWorkspaces,
  countWorkspacesByFolder,
  deleteFolder,
  folderOf,
  FoldersDocumentSchema,
  groupWorkspaces,
  type ListedAgent,
  markAutoTitle,
  matchesWorkspace,
  mergeSuggestions,
  mostCommon,
  moveAgent,
  moveFolder,
  moveWorkspace,
  parseRoute,
  renameFolder,
  SuggestionsSchema,
  agentBucket,
  resumeCommand,
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

test("renaming refuses a name another folder already uses; reordering stays in bounds", () => {
  let doc = withFolders("A", "B");
  const [a, b] = doc.folders;
  assert.equal(renameFolder(doc, b.id, "A"), doc);
  doc = renameFolder(doc, b.id, "C");
  assert.deepEqual(doc.folders.map((f) => f.name), ["A", "C"]);
  assert.equal(moveFolder(doc, a.id, -1), doc);
  doc = moveFolder(doc, a.id, 1);
  assert.deepEqual(doc.folders.map((f) => f.name), ["C", "A"]);
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
