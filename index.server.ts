import type { PluginServerContext } from "@getpaseo/plugin/server";
import { debugLogRpc, FoldersDocumentSchema, foldersSettings, readFoldersRpc, readSuggestionsRpc } from "./shared/model";
import { readSuggestions } from "./server/suggestions";

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(foldersSettings);
  server.handle(readSuggestionsRpc, readSuggestions);
  // Client entry code has no settings hook; composer pills read folders through this.
  server.handle(readFoldersRpc, async () => {
    const state = await settings.read();
    return state.status === "ready" ? state.values : FoldersDocumentSchema.parse({});
  });
  server.handle(debugLogRpc, ({ event, data }) => {
    console.log(`[folders-debug] ${event} ${JSON.stringify(data)}`);
    return { ok: true };
  });
  return () => {};
}
