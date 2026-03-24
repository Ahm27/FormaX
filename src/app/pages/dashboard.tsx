import { useEffect, useMemo, useState } from "react";
import { Users, TrendingDown, TrendingUp, Calendar, Activity } from "lucide-react";
import { Link } from "react-router";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { api, getErrorMessage } from "../lib/api";
import { useAppSettings } from "../lib/app-settings";
import type { DashboardAnalytics } from "../lib/types";

function formatRelativeTime(timestamp: string, language: "en" | "ar") {
  const value = new Date(timestamp).getTime();
  const differenceMinutes = Math.max(1, Math.round((Date.now() - value) / 60000));

  if (differenceMinutes < 60) {
    return language === "ar" ? `منذ ${differenceMinutes} دقيقة` : `${differenceMinutes} min ago`;
  }

  const differenceHours = Math.round(differenceMinutes / 60);
  if (differenceHours < 24) {
    return language === "ar" ? `منذ ${differenceHours} ساعة` : `${differenceHours} hour${differenceHours === 1 ? "" : "s"} ago`;
  }

  const differenceDays = Math.round(differenceHours / 24);
  return language === "ar" ? `منذ ${differenceDays} يوم` : `${differenceDays} day${differenceDays === 1 ? "" : "s"} ago`;
}

export function Dashboard() {
  const { language } = useAppSettings();
  const [data, setData] = useState<DashboardAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadDashboard();
  }, []);

  async function loadDashboard() {
    setLoading(true);
    setError(null);

    try {
      const response = await api.get<DashboardAnalytics>("/analytics/dashboard");
      setData(response.data);
    } catch (loadError) {
      setError(getErrorMessage(loadError, language === "ar" ? "تعذر تحميل تحليلات لوحة التحكم." : "Unable to load dashboard analytics."));
    } finally {
      setLoading(false);
    }
  }

  const text =
    language === "ar"
      ? {
          addClient: "إضافة عميل جديد",
          addFollowup: "إضافة متابعة",
          totalClients: "إجمالي العملاء",
          weightLossClients: "عملاء إنقاص الوزن",
          weightGainClients: "عملاء زيادة الوزن",
          followupsToday: "متابعات اليوم",
          heroTag: "رؤية تشغيلية مباشرة",
          title: "لوحة التحكم",
          subtitle: "نظرة لحظية على العملاء النشطين، حركة المتابعات، وأداء برامج الوزن.",
          trends: "اتجاهات تقدم الوزن",
          trendsHint: "متوسط الحركة الشهرية لكل برنامج.",
          view6Months: "آخر 6 أشهر",
          avgLoss: "متوسط النزول",
          avgGain: "متوسط الزيادة",
          quickActions: "إجراءات سريعة",
          quickActionsHint: "اختصارات لأكثر العمليات استخدامًا يوميًا.",
          recentActivity: "آخر النشاطات",
          recentActivityHint: "اضغط على أي صف للانتقال مباشرة إلى ملف العميل.",
          noRecentActivity: "لا يوجد نشاط حديث بعد.",
        }
      : {
          addClient: "Add New Client",
          addFollowup: "Add Follow-up",
          totalClients: "Total Clients",
          weightLossClients: "Weight Loss Clients",
          weightGainClients: "Weight Gain Clients",
          followupsToday: "Follow-ups Today",
          heroTag: "Live Pharmacy Intelligence",
          title: "Dashboard",
          subtitle:
            "A real-time pulse on active clients, follow-up momentum, and weight-program performance.",
          trends: "Weight Progress Trends",
          trendsHint: "Average monthly movement for both program types.",
          view6Months: "6-month view",
          avgLoss: "Avg Weight Loss",
          avgGain: "Avg Weight Gain",
          quickActions: "Quick Actions",
          quickActionsHint: "Jump directly into the two most common operational flows.",
          recentActivity: "Recent Activity",
          recentActivityHint: "Open any row to jump straight into that client record.",
          noRecentActivity: "No recent activity yet.",
        };

  const quickActions = [
    { label: text.addClient, icon: Users, to: "/clients" },
    { label: text.addFollowup, icon: Calendar, to: "/follow-ups" },
  ];

  const stats = useMemo(() => {
    if (!data) {
      return [];
    }

    return [
      {
        label: text.totalClients,
        value: String(data.stats.totalClients),
        icon: Users,
        color: "bg-blue-500",
      },
      {
        label: text.weightLossClients,
        value: String(data.stats.weightLossClients),
        icon: TrendingDown,
        color: "bg-primary",
      },
      {
        label: text.weightGainClients,
        value: String(data.stats.weightGainClients),
        icon: TrendingUp,
        color: "bg-secondary",
      },
      {
        label: text.followupsToday,
        value: String(data.stats.followUpsToday),
        icon: Calendar,
        color: "bg-orange-500",
      },
    ];
  }, [data, text]);

  return (
    <div className="p-8" dir={language === "ar" ? "rtl" : "ltr"}>
      <div className="mb-8 rounded-[28px] border border-border bg-[radial-gradient(circle_at_top_left,_rgba(46,125,255,0.14),_transparent_35%),linear-gradient(135deg,_rgba(255,255,255,0.92),_rgba(247,250,255,0.98))] p-8 shadow-sm dark:bg-[radial-gradient(circle_at_top_left,_rgba(46,125,255,0.2),_transparent_35%),linear-gradient(135deg,_rgba(30,41,59,0.98),_rgba(15,23,42,0.96))]">
        <div className="max-w-3xl">
          <div className="text-xs font-semibold uppercase tracking-[0.24em] text-primary mb-3">
            {text.heroTag}
          </div>
          <h1 className="text-4xl font-semibold mb-3">{text.title}</h1>
          <p className="text-muted-foreground text-base leading-7">
            {text.subtitle}
          </p>
        </div>
      </div>

      {error && <div className="mb-6 text-sm text-destructive">{error}</div>}

      <div className="grid grid-cols-4 gap-6 mb-8">
        {(loading ? Array.from({ length: 4 }) : stats).map((stat, index) => {
          if (loading) {
            return (
              <div
                key={index}
                className="bg-card rounded-xl p-6 border border-border shadow-sm animate-pulse"
              >
                <div className="w-12 h-12 rounded-lg bg-accent mb-4" />
                <div className="h-8 bg-accent rounded w-16 mb-2" />
                <div className="h-4 bg-accent rounded w-28" />
              </div>
            );
          }

          const Icon = stat.icon;
          return (
            <div
              key={stat.label}
              className="bg-card rounded-2xl p-6 border border-border shadow-sm relative overflow-hidden"
            >
              <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-primary via-secondary to-orange-400" />
              <div className="flex items-center justify-between mb-4">
                <div className={`w-12 h-12 rounded-lg ${stat.color} flex items-center justify-center`}>
                  <Icon className="w-6 h-6 text-white" />
                </div>
              </div>
              <div className="text-3xl font-semibold mb-1">{stat.value}</div>
              <div className="text-sm text-muted-foreground">{stat.label}</div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 bg-card rounded-[26px] p-6 border border-border shadow-sm bg-[linear-gradient(180deg,_rgba(46,125,255,0.05),_transparent_38%)]">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-xl font-semibold">{text.trends}</h2>
              <p className="text-sm text-muted-foreground mt-1">
                {text.trendsHint}
              </p>
            </div>
            <div className="px-3 py-1 rounded-full bg-primary/10 text-primary text-sm">
              {text.view6Months}
            </div>
          </div>
          {loading ? (
            <div className="h-[300px] rounded-lg bg-accent animate-pulse" />
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={data?.weightTrends ?? []}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                <XAxis dataKey="month" stroke="#64748B" />
                <YAxis stroke="#64748B" label={{ value: "kg", angle: -90, position: "insideLeft" }} />
                <Tooltip />
                <Line
                  type="monotone"
                  dataKey="avgLoss"
                  stroke="#2E7DFF"
                  strokeWidth={2}
                  name={text.avgLoss}
                />
                <Line
                  type="monotone"
                  dataKey="avgGain"
                  stroke="#00BFA6"
                  strokeWidth={2}
                  name={text.avgGain}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="bg-card rounded-[26px] p-6 border border-border shadow-sm bg-[linear-gradient(180deg,_rgba(0,191,166,0.06),_transparent_45%)]">
          <h2 className="text-xl font-semibold mb-2">{text.quickActions}</h2>
          <p className="text-sm text-muted-foreground mb-6">
            {text.quickActionsHint}
          </p>
          <div className="space-y-3">
            {quickActions.map((action) => {
              const Icon = action.icon;
              return (
                <Link
                  key={action.label}
                  to={action.to}
                  className="w-full flex items-center gap-3 px-4 py-4 rounded-2xl bg-accent hover:bg-primary hover:text-primary-foreground transition-colors text-left group"
                >
                  <div className="w-10 h-10 rounded-xl bg-background/80 group-hover:bg-white/20 flex items-center justify-center transition-colors">
                    <Icon className="w-5 h-5" />
                  </div>
                  <span>{action.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      </div>

      <div className="mt-6 bg-card rounded-[26px] p-6 border border-border shadow-sm">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-semibold">{text.recentActivity}</h2>
            <p className="text-sm text-muted-foreground mt-1">
              {text.recentActivityHint}
            </p>
          </div>
        </div>
        <div className="space-y-4">
          {loading ? (
            Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="h-16 rounded-lg bg-accent animate-pulse" />
            ))
          ) : (data?.recentActivity.length ?? 0) === 0 ? (
            <div className="text-muted-foreground">{text.noRecentActivity}</div>
          ) : (
            data?.recentActivity.map((activity) => (
              <Link
                key={activity.id}
                to={`/clients/${activity.client_id}`}
                className="flex items-center justify-between py-3 px-4 rounded-2xl hover:bg-accent transition-colors border border-transparent hover:border-border"
              >
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                    <Activity className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <div className="font-medium">{activity.client}</div>
                    <div className="text-sm text-muted-foreground">{activity.action}</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-medium">{activity.weight}</div>
                  <div className="text-sm text-muted-foreground">
                    {formatRelativeTime(activity.timestamp, language)}
                  </div>
                </div>
              </Link>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
