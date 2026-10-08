import type { PluginClientContext } from "@getpaseo/plugin/client";
import { setPluginClient } from "./client/data";
import { FolderScreen } from "./client/folder-screen";
import { OpenScreen } from "./client/open-screen";
import { OverviewScreen } from "./client/overview-screen";
import { startFolderPills } from "./client/pills";
import { FoldersSidebarItem } from "./client/sidebar";

export default function contribute(client: PluginClientContext) {
  setPluginClient(client);
  client.addScreen({ id: "overview", title: "Folders", Component: OverviewScreen });
  client.addScreen({ id: "folder", title: (params) => params.name || "Folder", Component: FolderScreen });
  client.addScreen({ id: "open", title: (params) => params.name || "Opening", Component: OpenScreen });
  client.addSidebarHeaderItem({ id: "folders", title: "Folders", Component: FoldersSidebarItem });
  const stopPills = startFolderPills(client);
  return () => {
    stopPills();
    setPluginClient(null);
  };
}
