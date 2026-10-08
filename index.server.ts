import type { PluginServerContext } from "@getpaseo/plugin/server";
import { foldersSettings, readSuggestionsRpc } from "./shared/model";
import { readSuggestions } from "./server/suggestions";

export default function contribute(server: PluginServerContext) {
  server.registerSettings(foldersSettings);
  server.handle(readSuggestionsRpc, readSuggestions);
  return () => {};
}
