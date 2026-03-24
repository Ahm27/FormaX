import { useEffect, useState } from "react";
import { TrendingUp, Users, Calendar } from "lucide-react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { api, getErrorMessage } from "../lib/api";
import { useAppSettings } from "../lib/app-settings";
import type { ProgressAnalytics } from "../lib/types";

export function Progress() {
  const { language } = useAppSettings();
  const [data, setData] = useState<ProgressAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadProgress();
  }, []);

  async function loadProgress() {
    setLoading(true);
    setError(null);

    try {
      const response = await api.get<ProgressAnalytics>("/analytics/progress");
      setData(response.data);
    } catch (loadError) {
      setError(getErrorMessage(loadError, language === "ar" ? "تعذر تحميل تحليلات التقدم." : "Unable to load progress analytics."));
    } finally {
      setLoading(false);
    }
  }

  const text =
    language === "ar"
      ? {
          heroTag: "مؤشرات النتائج",
          title: "تحليلات التقدم",
          subtitle: "قارن اتجاه النجاح وإيقاع المتابعات الأسبوعي وحركة الوزن الإجمالية بين البرامج.",
          live: "مباشر من البيانات الحالية",
          successRate: "معدل نجاح البرامج (%)",
          successHint: "ينخفض النجاح عندما تتحرك المتابعة في الاتجاه الخاطئ لذلك البرنامج.",
          weightLoss: "سمنة",
          weightGain: "نحافة",
          distribution: "توزيع البرامج",
          distributionHint: "الخليط الحالي بين برامج الزيادة والنقصان.",
          weekly: "المتابعات الأسبوعية (الشهر الحالي)",
          weeklyHint: "الحمل التشغيلي خلال الشهر الحالي.",
          activeClients: "العملاء النشطون",
          haveHistory: "لديهم سجل متابعات",
          totalLost: "إجمالي الوزن المفقود",
          totalGained: "إجمالي الوزن المكتسب",
          totalFollowups: "إجمالي المتابعات",
          lossMovement: "إجمالي الحركة الإيجابية لبرنامج الإنقاص",
          gainMovement: "إجمالي الحركة الإيجابية لبرنامج الزيادة",
          acrossClients: "عبر جميع العملاء المسجلين",
        }
      : {
          heroTag: "Outcome Signals",
          title: "Progress Analytics",
          subtitle:
            "Compare success direction, weekly follow-up rhythm, and total body-weight movement across programs.",
          live: "Live from current data",
          successRate: "Program Success Rate (%)",
          successHint: "Success drops whenever a follow-up moves in the wrong direction for that program.",
          weightLoss: "Weight Loss",
          weightGain: "Weight Gain",
          distribution: "Program Distribution",
          distributionHint: "Current client mix between gain and loss programs.",
          weekly: "Follow-ups Per Week (Current Month)",
          weeklyHint: "Operational load across the current month.",
          activeClients: "Active Clients",
          haveHistory: "have follow-up history",
          totalLost: "Total Weight Lost",
          totalGained: "Total Weight Gained",
          totalFollowups: "Total Follow-ups",
          lossMovement: "Aggregate positive loss-program movement",
          gainMovement: "Aggregate positive gain-program movement",
          acrossClients: "Across all recorded clients",
        };

  return (
    <div className="p-8" dir={language === "ar" ? "rtl" : "ltr"}>
      <div className="mb-8 rounded-[28px] border border-border bg-[radial-gradient(circle_at_top_left,_rgba(0,191,166,0.16),_transparent_30%),linear-gradient(135deg,_rgba(255,255,255,0.96),_rgba(245,252,250,0.98))] p-8 shadow-sm dark:bg-[radial-gradient(circle_at_top_left,_rgba(0,191,166,0.2),_transparent_30%),linear-gradient(135deg,_rgba(30,41,59,0.98),_rgba(15,23,42,0.96))]">
        <div className="max-w-3xl">
          <div className="text-xs font-semibold uppercase tracking-[0.24em] text-secondary mb-3">
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
        {(loading ? Array.from({ length: 4 }) : data?.performanceMetrics ?? []).map(
          (metric, index) => {
            if (loading) {
              return (
                <div
                  key={index}
                  className="bg-card rounded-xl p-6 border border-border shadow-sm animate-pulse"
                >
                  <div className="h-4 bg-accent rounded w-24 mb-3" />
                  <div className="h-8 bg-accent rounded w-20 mb-3" />
                  <div className="h-4 bg-accent rounded w-28" />
                </div>
              );
            }

            return (
              <div
                key={metric.label}
                className="bg-card rounded-2xl p-6 border border-border shadow-sm relative overflow-hidden"
              >
                <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-secondary via-primary to-blue-400" />
                <div className="text-sm text-muted-foreground mb-2">{metric.label}</div>
                <div className="text-2xl font-semibold mb-2">{metric.value}</div>
                <div className="text-sm flex items-center gap-1 text-secondary">
                  <TrendingUp className="w-4 h-4" />
                  {text.live}
                </div>
              </div>
            );
          }
        )}
      </div>

      <div className="grid grid-cols-2 gap-6 mb-6">
        <div className="bg-card rounded-[26px] p-6 border border-border shadow-sm bg-[linear-gradient(180deg,_rgba(46,125,255,0.05),_transparent_40%)]">
          <div className="mb-6">
            <h2 className="text-xl font-semibold">{text.successRate}</h2>
            <p className="text-sm text-muted-foreground mt-1">
              {text.successHint}
            </p>
          </div>
          {loading ? (
            <div className="h-[300px] rounded-lg bg-accent animate-pulse" />
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={data?.successRateData ?? []}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                <XAxis dataKey="month" stroke="#64748B" />
                <YAxis stroke="#64748B" domain={[0, 100]} />
                <Tooltip />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="weightLoss"
                  stroke="#2E7DFF"
                  strokeWidth={2}
                  name={text.weightLoss}
                />
                <Line
                  type="monotone"
                  dataKey="weightGain"
                  stroke="#00BFA6"
                  strokeWidth={2}
                  name={text.weightGain}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="bg-card rounded-[26px] p-6 border border-border shadow-sm bg-[linear-gradient(180deg,_rgba(0,191,166,0.06),_transparent_45%)]">
          <div className="mb-6">
            <h2 className="text-xl font-semibold">{text.distribution}</h2>
            <p className="text-sm text-muted-foreground mt-1">
              {text.distributionHint}
            </p>
          </div>
          {loading ? (
            <div className="h-[300px] rounded-lg bg-accent animate-pulse" />
          ) : (
            <>
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={data?.programDistribution ?? []}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={(entry) => `${entry.name}: ${entry.value}`}
                    outerRadius={100}
                    dataKey="value"
                  >
                    {(data?.programDistribution ?? []).map((entry) => (
                      <Cell key={entry.id} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex items-center justify-center gap-6 mt-4">
                {(data?.programDistribution ?? []).map((item) => (
                  <div key={item.id} className="flex items-center gap-2">
                    <div
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: item.color }}
                    />
                    <span className="text-sm text-muted-foreground">{item.name}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="bg-card rounded-[26px] p-6 border border-border shadow-sm bg-[linear-gradient(180deg,_rgba(59,130,246,0.05),_transparent_45%)]">
        <div className="mb-6">
            <h2 className="text-xl font-semibold">{text.weekly}</h2>
            <p className="text-sm text-muted-foreground mt-1">
              {text.weeklyHint}
          </p>
        </div>
        {loading ? (
          <div className="h-[300px] rounded-lg bg-accent animate-pulse" />
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={data?.followUpsPerWeek ?? []}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
              <XAxis dataKey="week" stroke="#64748B" />
              <YAxis stroke="#64748B" />
              <Tooltip />
              <Bar dataKey="followUps" fill="#2E7DFF" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="grid grid-cols-4 gap-6 mt-6">
        <div className="bg-card rounded-[24px] p-6 border border-border shadow-sm">
          <div className="flex items-center gap-4 mb-4">
            <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center">
              <Users className="w-6 h-6 text-primary" />
            </div>
            <div>
              <div className="text-2xl font-semibold">{data?.additionalInsights.activeClients ?? 0}</div>
              <div className="text-sm text-muted-foreground">{text.activeClients}</div>
            </div>
          </div>
          <div className="text-sm text-secondary">
            {data?.additionalInsights.clientsWithFollowups ?? 0} {text.haveHistory}
          </div>
        </div>

        <div className="bg-card rounded-[24px] p-6 border border-border shadow-sm">
          <div className="flex items-center gap-4 mb-4">
            <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center">
              <TrendingUp className="w-6 h-6 text-primary" />
            </div>
            <div>
              <div className="text-2xl font-semibold">
                {loading ? "..." : `${data?.additionalInsights.totalWeightLost ?? 0} kg`}
              </div>
              <div className="text-sm text-muted-foreground">{text.totalLost}</div>
            </div>
          </div>
          <div className="text-sm text-primary">
            {text.lossMovement}
          </div>
        </div>

        <div className="bg-card rounded-[24px] p-6 border border-border shadow-sm">
          <div className="flex items-center gap-4 mb-4">
            <div className="w-12 h-12 rounded-lg bg-secondary/10 flex items-center justify-center">
              <TrendingUp className="w-6 h-6 text-secondary" />
            </div>
            <div>
              <div className="text-2xl font-semibold">
                {loading ? "..." : `${data?.additionalInsights.totalWeightGained ?? 0} kg`}
              </div>
              <div className="text-sm text-muted-foreground">{text.totalGained}</div>
            </div>
          </div>
          <div className="text-sm text-secondary">
            {text.gainMovement}
          </div>
        </div>

        <div className="bg-card rounded-[24px] p-6 border border-border shadow-sm">
          <div className="flex items-center gap-4 mb-4">
            <div className="w-12 h-12 rounded-lg bg-blue-100 flex items-center justify-center">
              <Calendar className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <div className="text-2xl font-semibold">{data?.additionalInsights.totalFollowups ?? 0}</div>
              <div className="text-sm text-muted-foreground">{text.totalFollowups}</div>
            </div>
          </div>
          <div className="text-sm text-secondary">{text.acrossClients}</div>
        </div>
      </div>
    </div>
  );
}
