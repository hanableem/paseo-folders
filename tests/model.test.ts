import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addFolder,
  countByFolder,
  deleteFolder,
  folderOf,
  FoldersDocumentSchema,
  type ListedAgent,
  matchesQuery,
  mergeSuggestions,
  moveAgent,
  moveFolder,
  renameFolder,
  SuggestionsSchema,
  UNSORTED_ID,
} from "../shared/model.ts";

const empty = () => FoldersDocumentSchema.parse({});
const agent = (id: string, title = id, activityAt = "2026-01-01T00:00:00Z"): ListedAgent => ({
  id,
  title,
  provider: "claude",
  workspaceId: "w1",
  workspaceName: "",
  archived: false,
  activityAt,
});

test("an empty document parses with defaults", () => {
  const doc = empty();
  assert.deepEqual(doc.folders, []);
  assert.equal(doc.suggestionsPath, "");
});

test("adding folders ignores blanks and duplicates", () => {
  let doc = addFolder(empty(), "  Reading ");
  doc = addFolder(doc, "Reading");
  doc = addFolder(doc, "   ");
  assert.deepEqual(doc.folders.map((f) => f.name), ["Reading"]);
});

test("moving an agent marks it as placed by hand; Unsorted clears the assignment", () => {
  let doc = addFolder(empty(), "Work");
  const id = doc.folders[0].id;
  doc = moveAgent(doc, "a1", id);
  assert.equal(folderOf(doc, "a1"), id);
  assert.equal(doc.manual.a1, true);
  doc = moveAgent(doc, "a1", UNSORTED_ID);
  assert.equal(folderOf(doc, "a1"), UNSORTED_ID);
});

test("deleting a folder returns its agents to Unsorted and lets imports place them again", () => {
  let doc = addFolder(addFolder(empty(), "A"), "B");
  const [a, b] = doc.folders;
  doc = moveAgent(moveAgent(doc, "x", a.id), "y", b.id);
  doc = deleteFolder(doc, a.id);
  assert.equal(folderOf(doc, "x"), UNSORTED_ID);
  assert.equal(doc.manual.x, undefined);
  assert.equal(folderOf(doc, "y"), b.id);
});

test("renaming refuses a name another folder already uses; reordering stays in bounds", () => {
  let doc = addFolder(addFolder(empty(), "A"), "B");
  const [a, b] = doc.folders;
  assert.equal(renameFolder(doc, b.id, "A"), doc);
  doc = renameFolder(doc, b.id, "C");
  assert.deepEqual(doc.folders.map((f) => f.name), ["A", "C"]);
  assert.equal(moveFolder(doc, a.id, -1), doc);
  doc = moveFolder(doc, a.id, 1);
  assert.deepEqual(doc.folders.map((f) => f.name), ["C", "A"]);
});

test("imports create missing folders by name and never move hand-placed agents", () => {
  let doc = addFolder(empty(), "Health");
  const health = doc.folders[0].id;
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
  const daily = result.doc.folders.find((f) => f.name === "Daily")!.id;
  assert.equal(folderOf(result.doc, "fresh"), daily);
  assert.equal(result.doc.notes.fresh, "Asked about a router");
  assert.equal(result.doc.lastImportAt, "2026-01-02T00:00:00Z");
  const again = mergeSuggestions(result.doc, suggestions, "2026-01-03T00:00:00Z");
  assert.equal(again.placed, 0);
  assert.equal(again.createdFolders, 0);
  assert.equal(again.doc, result.doc, "an unchanged import must not produce a new document to save");
});

test("counts include Unsorted and agents whose folder no longer exists", () => {
  let doc = addFolder(empty(), "A");
  doc = { ...moveAgent(doc, "a", doc.folders[0].id), assignments: { a: doc.folders[0].id, b: "gone" } };
  const counts = countByFolder(doc, [agent("a"), agent("b"), agent("c")]);
  assert.equal(counts[doc.folders[0].id], 1);
  assert.equal(counts[UNSORTED_ID], 2);
});

test("search matches title, workspace name and note, ignoring case", () => {
  const a = { ...agent("a", "Router Setup"), workspaceName: "Home" };
  assert.ok(matchesQuery(a, "", "router"));
  assert.ok(matchesQuery(a, "", "home"));
  assert.ok(matchesQuery(a, "about Wi-Fi", "wi-fi"));
  assert.ok(!matchesQuery(a, "", "printer"));
  assert.ok(matchesQuery(a, "", "  "));
});

test("suggestions files must declare version 1", () => {
  assert.ok(!SuggestionsSchema.safeParse({ folders: [] }).success);
  assert.ok(SuggestionsSchema.safeParse({ version: 1 }).success);
});

test("a forced suggestion re-files a hand-placed agent and keeps it marked as placed by hand", () => {
  let doc = addFolder(addFolder(empty(), "A"), "B");
  const [a, b] = doc.folders;
  doc = moveAgent(doc, "x", a.id);
  const s = SuggestionsSchema.parse({ version: 1, assignments: { x: "B" }, force: ["x"] });
  const result = mergeSuggestions(doc, s, "2026-01-04T00:00:00Z");
  assert.equal(folderOf(result.doc, "x"), b.id);
  assert.equal(result.doc.manual.x, true);
  assert.equal(result.keptManual, 0);
});
