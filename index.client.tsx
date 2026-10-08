import type { PluginClientContext } from "@getpaseo/plugin/client";
import { setPluginClient } from "./client/data";
import { OpenScreen } from "./client/open-screen";
import { OverviewScreen } from "./client/overview-screen";
import { FoldersSidebarItem } from "./client/sidebar";

export default function contribute(client: PluginClientContext) {
  setPluginClient(client);
  client.addScreen({ id: "overview", title: "Folders", Component: OverviewScreen });
  client.addScreen({ id: "open", title: (params) => params.name || "Opening", Component: OpenScreen });
  client.addSidebarHeaderItem({ id: "folders", title: "Folders", Component: FoldersSidebarItem });
  return () => setPluginClient(null);
}
