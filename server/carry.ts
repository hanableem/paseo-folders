import { settingsRpc } from "@getpaseo/plugin";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { FoldersDocumentSchema, foldersSettings, renameAgent } from "../shared/model";

const PLUGIN_ID = "paseo-folders";
const rpc = settingsRpc(foldersSettings.id);

/**
 * Carries a conversation's folder, hand placement and note over to the agent ID it got
 * when it moved, in the folders saved on the host. Plugin settings have no server-side
 * write, so this goes through the same settings calls the apps use, and tries again
 * when an app saved the folders in between.
 */
export async function carryFolderEntries(client: DaemonClient, from: string, to: string): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const read = rpc.read.output.parse(await client.invokePluginRpc(PLUGIN_ID, rpc.read.name, {}));
    if (read.status !== "ready") throw new Error(`the saved folders are invalid (${read.error})`);
    const doc = FoldersDocumentSchema.parse(read.values);
    const next = renameAgent(doc, from, to);
    if (next === doc) return;
    const written = rpc.write.output.parse(
      await client.invokePluginRpc(PLUGIN_ID, rpc.write.name, { revision: read.revision, values: next }),
    );
    if (written.status === "saved") return;
    if (written.status === "invalid") throw new Error(written.error);
  }
  throw new Error("the folders kept changing while saving");
}
