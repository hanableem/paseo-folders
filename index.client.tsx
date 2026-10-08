import type { PluginClientContext } from "@getpaseo/plugin/client";
import { setPluginClient } from "./client/data";
import { FolderScreen } from "./client/folder-screen";
import { OverviewScreen } from "./client/overview-screen";
import { FoldersSidebarItem } from "./client/sidebar";

export default function contribute(client: PluginClientContext) {
  setPluginClient(client);
  client.addScreen({ id: "overview", title: "Folders", Component: OverviewScreen });
  client.addScreen({ id: "folder", title: (params) => params.name || "Folder", Component: FolderScreen });
  client.addSidebarHeaderItem({ id: "folders", title: "Folders", Component: FoldersSidebarItem });
  return () => setPluginClient(null);
}
