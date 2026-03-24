import { RouterProvider } from "react-router";
import { router } from "./routes";
import { AppSettingsProvider } from "./lib/app-settings";

export default function App() {
  return (
    <AppSettingsProvider>
      <RouterProvider router={router} />
    </AppSettingsProvider>
  );
}
