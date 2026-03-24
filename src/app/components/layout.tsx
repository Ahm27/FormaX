import { Outlet, NavLink } from "react-router";
import {
  LayoutDashboard,
  Users,
  Calendar,
  TrendingUp,
  Upload,
  Cloud,
  Settings as SettingsIcon,
  Moon,
  Sun,
  Languages,
} from "lucide-react";
import { useState } from "react";
import { useAppSettings } from "../lib/app-settings";

export function Layout() {
  const [syncStatus, setSyncStatus] = useState<"synced" | "syncing" | "error">("synced");
  const { t, direction, theme, setTheme, language, setLanguage } = useAppSettings();

  const navItems = [
    { path: "/", label: t("dashboard"), icon: LayoutDashboard },
    { path: "/clients", label: t("clients"), icon: Users },
    { path: "/follow-ups", label: t("followUps"), icon: Calendar },
    { path: "/progress", label: t("progress"), icon: TrendingUp },
    { path: "/import-data", label: t("importData"), icon: Upload },
    { path: "/sync", label: t("sync"), icon: Cloud },
    { path: "/settings", label: t("settings"), icon: SettingsIcon },
  ];

  return (
    <div className="flex h-screen bg-background" dir={direction}>
      {/* Sidebar */}
      <aside className="w-64 bg-card border-r border-border flex flex-col">
        <div className="p-6 border-b border-border">
          <div className="flex items-center gap-2">
            <img
              src="/brand-mark.svg"
              alt="Dr. Sherin Pharmacy"
              className="h-11 w-11 rounded-xl border border-border bg-white object-contain p-1 shadow-sm"
            />
            <div>
              <h1 className="text-lg font-semibold">Dr. Sherin</h1>
              <p className="text-xs text-muted-foreground">{t("followUpSystem")}</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 p-4 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.path === "/"}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "text-foreground hover:bg-accent"
                  }`
                }
              >
                <Icon className="w-5 h-5" />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>

        <div className="p-4 border-t border-border">
          <div className="flex items-center justify-between px-4 py-2">
            <div className="flex items-center gap-2">
              <div
                className={`w-2 h-2 rounded-full ${
                  syncStatus === "synced"
                    ? "bg-secondary"
                    : syncStatus === "syncing"
                    ? "bg-primary animate-pulse"
                    : "bg-destructive"
                }`}
              />
              <span className="text-sm text-muted-foreground">
                {syncStatus === "synced"
                  ? t("synced")
                  : syncStatus === "syncing"
                  ? t("syncing")
                  : t("syncError")}
              </span>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Top Header */}
        <header className="bg-card border-b border-border px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div
                className={`w-2 h-2 rounded-full ${
                  syncStatus === "synced" ? "bg-secondary" : "bg-primary animate-pulse"
                }`}
              />
              <span className="text-sm text-muted-foreground">
                {syncStatus === "synced" ? t("allChangesSaved") : t("syncing")}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setLanguage(language === "en" ? "ar" : "en")}
              className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm transition-colors hover:bg-accent"
            >
              <Languages className="w-4 h-4" />
              <span>{language === "en" ? "AR" : "EN"}</span>
            </button>
            <button
              type="button"
              onClick={() => setTheme(theme === "light" ? "dark" : "light")}
              className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm transition-colors hover:bg-accent"
            >
              {theme === "light" ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
              <span>{theme === "light" ? t("dark") : t("light")}</span>
            </button>
          </div>
        </header>

        {/* Page Content */}
        <div className="flex-1 overflow-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
