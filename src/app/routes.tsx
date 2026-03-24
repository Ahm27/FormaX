import { createBrowserRouter } from "react-router";
import { Layout } from "./components/layout";
import { Dashboard } from "./pages/dashboard";
import { Clients } from "./pages/clients";
import { ClientProfile } from "./pages/client-profile";
import { FollowUps } from "./pages/follow-ups";
import { Progress } from "./pages/progress";
import { DatabaseExplorer } from "./pages/database-explorer";
import { ImportData } from "./pages/import-data";
import { Sync } from "./pages/sync";
import { Settings } from "./pages/settings";

export const router = createBrowserRouter([
  {
    path: "/",
    Component: Layout,
    children: [
      { index: true, Component: Dashboard },
      { path: "clients", Component: Clients },
      { path: "clients/:id", Component: ClientProfile },
      { path: "follow-ups", Component: FollowUps },
      { path: "progress", Component: Progress },
      { path: "db", Component: DatabaseExplorer },
      { path: "import-data", Component: ImportData },
      { path: "sync", Component: Sync },
      { path: "settings", Component: Settings },
    ],
  },
]);
