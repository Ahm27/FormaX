import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { useParams, Link } from "react-router";
import { ArrowLeft, Phone, Plus, X, Edit, Trash2 } from "lucide-react";
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
import { toDisplayId } from "../lib/id-format";
import { ConfirmDialog } from "../components/confirm-dialog";
import type { ClientDetail, FollowUpPayload } from "../lib/types";

const emptyFollowupForm: FollowUpPayload = {
  client_id: "",
  date: new Date().toISOString().split("T")[0],
  weight: "",
  adherence_status: "Yes",
  notes: "",
};

function formatWeight(weight: number | null | undefined, language: "en" | "ar") {
  return weight ? `${weight.toFixed(1)} kg` : language === "ar" ? "غير محدد" : "Not set";
}

export function ClientProfile() {
  const { language } = useAppSettings();
  const { id } = useParams();
  const [client, setClient] = useState<ClientDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState<FollowUpPayload>(emptyFollowupForm);
  const [editingFollowupId, setEditingFollowupId] = useState<number | null>(null);
  const [followupPendingDeleteId, setFollowupPendingDeleteId] = useState<number | null>(null);

  useEffect(() => {
    if (!id) {
      setError(language === "ar" ? "معرف العميل مفقود." : "Client id is missing.");
      setLoading(false);
      return;
    }

    void loadClient(id);
  }, [id, language]);

  const text =
    language === "ar"
      ? {
          loading: "جارٍ تحميل ملف العميل...",
          notFound: "العميل غير موجود.",
          back: "العودة إلى العملاء",
          title: "ملف العميل",
          yearsOld: "سنة",
          chronicDiseases: "الأمراض المزمنة",
          startingWeight: "وزن البداية",
          currentWeight: "الوزن الحالي",
          targetWeight: "الوزن المستهدف",
          noneListed: "لا يوجد",
          chartTitle: "رسم تقدم الوزن",
          chartWeight: "الوزن",
          historyTitle: "سجل المتابعات",
          addFollowup: "إضافة متابعة",
          clientId: "معرف العميل",
          date: "التاريخ",
          weight: "الوزن",
          change: "التغير",
          adherence: "الالتزام",
          notes: "ملاحظات",
          noFollowups: "لا توجد متابعات مسجلة بعد.",
          firstRecord: "أول تسجيل",
          addFollowupTitle: "إضافة متابعة",
          bodyWeight: "وزن الجسم (كجم)",
          yes: "نعم",
          no: "لا",
          missed: "فاته بعض الجرعات",
          notesPlaceholder: "ملاحظات أو توصيات",
          save: "حفظ المتابعة",
          saving: "جارٍ الحفظ...",
          cancel: "إلغاء",
          editFollowup: "تعديل المتابعة",
          updateFollowup: "تحديث المتابعة",
          deleteFollowup: "حذف المتابعة",
          deleteConfirm: "هل أنت متأكد من حذف هذه المتابعة؟",
          confirmDelete: "تأكيد الحذف",
        }
      : {
          loading: "Loading client profile...",
          notFound: "Client not found.",
          back: "Back to Clients",
          title: "Client Profile",
          yearsOld: "years old",
          chronicDiseases: "Chronic Diseases",
          startingWeight: "Starting Weight",
          currentWeight: "Current Weight",
          targetWeight: "Target Weight",
          noneListed: "None listed",
          chartTitle: "Weight Progress Chart",
          chartWeight: "Weight",
          historyTitle: "Follow-Up History",
          addFollowup: "Add Follow-up",
          clientId: "Client ID",
          date: "Date",
          weight: "Weight",
          change: "Change",
          adherence: "Adherence",
          notes: "Notes",
          noFollowups: "No follow-ups recorded yet.",
          firstRecord: "First record",
          addFollowupTitle: "Add Follow-up",
          bodyWeight: "Body Weight (kg)",
          yes: "Yes",
          no: "No",
          missed: "Missed some doses",
          notesPlaceholder: "Observations or recommendations",
          save: "Save Follow-up",
          saving: "Saving...",
          cancel: "Cancel",
          editFollowup: "Edit follow-up",
          updateFollowup: "Update follow-up",
          deleteFollowup: "Delete follow-up",
          deleteConfirm: "Are you sure you want to delete this follow-up?",
          confirmDelete: "Confirm delete",
        };

  async function loadClient(clientId: string) {
    setLoading(true);
    setError(null);

    try {
      const response = await api.get<ClientDetail>(`/clients/${clientId}`);
      setClient(response.data);
      setFormData((current) => ({
        ...current,
        client_id: String(response.data.id),
      }));
    } catch (loadError) {
      setError(getErrorMessage(loadError, language === "ar" ? "تعذر تحميل ملف العميل." : "Unable to load client profile."));
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!client) {
      return;
    }

    setSaving(true);
    setError(null);

    try {
      if (editingFollowupId) {
        await api.put(`/followups/${editingFollowupId}`, {
          ...formData,
          client_id: String(client.id),
        });
      } else {
        await api.post(`/clients/${client.id}/followups`, {
          ...formData,
          client_id: String(client.id),
        });
      }

      setShowModal(false);
      setEditingFollowupId(null);
      setFormData({
        ...emptyFollowupForm,
        client_id: String(client.id),
      });
      await loadClient(String(client.id));
    } catch (saveError) {
      setError(getErrorMessage(saveError, language === "ar" ? "تعذر حفظ المتابعة." : "Unable to save follow-up."));
    } finally {
      setSaving(false);
    }
  }

  function openCreateFollowupModal() {
    if (!client) {
      return;
    }

    setEditingFollowupId(null);
    setFormData({
      ...emptyFollowupForm,
      client_id: String(client.id),
      date: new Date().toISOString().split("T")[0],
    });
    setShowModal(true);
  }

  function openEditFollowupModal(followupId: number) {
    if (!client) {
      return;
    }

    const followup = client.followups.find((item) => item.id === followupId);
    if (!followup) {
      return;
    }

    setEditingFollowupId(followup.id);
    setFormData({
      client_id: String(client.id),
      date: followup.date,
      weight: String(followup.weight),
      adherence_status: followup.adherence_status || "Yes",
      notes: followup.notes || "",
    });
    setShowModal(true);
  }

  async function handleDeleteFollowup(followupId: number) {
    if (!client) {
      return;
    }

    try {
      setError(null);
      await api.delete(`/followups/${followupId}`);
      setFollowupPendingDeleteId(null);
      await loadClient(String(client.id));
    } catch (deleteError) {
      setError(
        getErrorMessage(
          deleteError,
          language === "ar" ? "تعذر حذف المتابعة." : "Unable to delete follow-up."
        )
      );
    }
  }

  const chartData = useMemo(() => {
    if (!client) {
      return [];
    }

    const startingPoint = {
      id: "start",
      sortKey: `${client.created_at}-000000`,
      date: "Start",
      fullDate: new Date(client.created_at).toLocaleDateString(),
      weight: client.starting_weight,
    };

    const followupPoints = [...client.followups]
      .sort((left, right) => {
        const dateComparison = left.date.localeCompare(right.date);
        return dateComparison !== 0 ? dateComparison : left.id - right.id;
      })
      .map((followup) => ({
        id: followup.id,
        sortKey: `${followup.date}-${String(followup.id).padStart(6, "0")}`,
        date: new Date(followup.date).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        }),
        fullDate: new Date(followup.date).toLocaleDateString(),
        weight: followup.weight,
      }));

    return [startingPoint, ...followupPoints].sort((left, right) =>
      left.sortKey.localeCompare(right.sortKey)
    );
  }, [client]);

  if (loading) {
    return <div className="p-8 text-muted-foreground">{text.loading}</div>;
  }

  if (error && !client) {
    return <div className="p-8 text-destructive">{error}</div>;
  }

  if (!client) {
    return <div className="p-8 text-muted-foreground">{text.notFound}</div>;
  }

  return (
    <div className="p-8" dir={language === "ar" ? "rtl" : "ltr"}>
      <div className="mb-8">
        <Link
          to="/clients"
          className="inline-flex items-center gap-2 text-primary hover:underline mb-4"
        >
          <ArrowLeft className="w-4 h-4" />
          {text.back}
        </Link>
        <h1 className="text-3xl font-semibold mb-2">{text.title}</h1>
      </div>

      <div className="bg-card rounded-xl p-6 border border-border shadow-sm mb-6">
        <div className="flex items-start justify-between mb-6">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
              <span className="text-2xl font-semibold text-primary">
                {client.name
                  .split(" ")
                  .map((part) => part[0])
                  .join("")}
              </span>
            </div>
            <div>
              <h2 className="text-2xl font-semibold">{client.name}</h2>
              <div className="flex items-center gap-4 text-muted-foreground mt-1">
              <span>{client.age} {text.yearsOld}</span>
              <span>•</span>
              <span>{text.clientId}: {toDisplayId(client.id, client.display_id)}</span>
              {client.phone && (
                  <>
                    <span>•</span>
                    <div className="flex items-center gap-1">
                      <Phone className="w-4 h-4" />
                      {client.phone}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
          <span
            className={`px-4 py-2 rounded-full ${
              client.program_type === "Weight Loss"
                ? "bg-primary/10 text-primary"
                : "bg-secondary/10 text-secondary"
            }`}
          >
            {client.program_type}
          </span>
        </div>

        <div className="grid grid-cols-4 gap-6">
          <div>
            <div className="text-sm text-muted-foreground mb-1">{text.chronicDiseases}</div>
            <div className="font-medium">{client.chronic_diseases || text.noneListed}</div>
          </div>
          <div>
            <div className="text-sm text-muted-foreground mb-1">{text.startingWeight}</div>
            <div className="font-medium">{formatWeight(client.starting_weight, language)}</div>
          </div>
          <div>
            <div className="text-sm text-muted-foreground mb-1">{text.currentWeight}</div>
            <div className="font-medium text-primary">{formatWeight(client.current_weight, language)}</div>
          </div>
          <div>
            <div className="text-sm text-muted-foreground mb-1">{text.targetWeight}</div>
            <div className="font-medium text-secondary">{formatWeight(client.target_weight, language)}</div>
          </div>
        </div>
      </div>

      <div className="bg-card rounded-xl p-6 border border-border shadow-sm mb-6">
        <h2 className="text-xl font-semibold mb-6">{text.chartTitle}</h2>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
            <XAxis dataKey="date" stroke="#64748B" />
            <YAxis
              stroke="#64748B"
              label={{ value: "kg", angle: -90, position: "insideLeft" }}
            />
            <Tooltip
              formatter={(value: number) => [`${value.toFixed(1)} kg`, text.chartWeight]}
              labelFormatter={(_label, payload) => payload?.[0]?.payload?.fullDate ?? ""}
            />
            <Line type="monotone" dataKey="weight" stroke="#2E7DFF" strokeWidth={3} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="bg-card rounded-xl p-6 border border-border shadow-sm">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold">{text.historyTitle}</h2>
          <button
            onClick={openCreateFollowupModal}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-5 h-5" />
            {text.addFollowup}
          </button>
        </div>

        {error && <div className="mb-4 text-sm text-destructive">{error}</div>}

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-accent border-b border-border">
              <tr>
                <th className="px-6 py-4 text-left font-semibold">{text.date}</th>
                <th className="px-6 py-4 text-left font-semibold">{text.weight}</th>
                <th className="px-6 py-4 text-left font-semibold">{text.change}</th>
                <th className="px-6 py-4 text-left font-semibold">{text.adherence}</th>
                <th className="px-6 py-4 text-left font-semibold">{text.notes}</th>
                <th className="px-6 py-4 text-left font-semibold">{language === "ar" ? "الإجراءات" : "Actions"}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {client.followups.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-muted-foreground">
                    {text.noFollowups}
                  </td>
                </tr>
              ) : (
                client.followups.map((followUp) => (
                  <tr key={followUp.id} className="hover:bg-accent/50 transition-colors">
                    <td className="px-6 py-4">
                      {new Date(followUp.date).toLocaleDateString(language === "ar" ? "ar-EG" : "en-US")}
                    </td>
                    <td className="px-6 py-4 font-medium">{formatWeight(followUp.weight, language)}</td>
                    <td className="px-6 py-4">
                      {followUp.weight_change === null ? (
                        <span className="text-muted-foreground">{text.firstRecord}</span>
                      ) : (
                        <span className="font-medium">
                          {followUp.weight_change > 0 ? "+" : ""}
                          {followUp.weight_change.toFixed(1)} kg
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <span className="px-3 py-1 rounded-full text-sm bg-secondary/10 text-secondary">
                        {followUp.adherence_status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-muted-foreground">{followUp.notes || "-"}</td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => openEditFollowupModal(followUp.id)}
                          className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent transition-colors"
                        >
                          <Edit className="w-4 h-4" />
                          {text.editFollowup}
                        </button>
                        <button
                          onClick={() => setFollowupPendingDeleteId(followUp.id)}
                          className="inline-flex items-center gap-2 rounded-lg border border-destructive/30 px-3 py-2 text-sm text-destructive hover:bg-destructive/10 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                          {text.deleteFollowup}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-xl p-6 max-w-md w-full border border-border shadow-xl">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-semibold">
                {editingFollowupId ? text.editFollowup : text.addFollowupTitle}
              </h3>
              <button
                onClick={() => {
                  setShowModal(false);
                  setEditingFollowupId(null);
                }}
                className="p-2 hover:bg-accent rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm mb-2">{text.date}</label>
                <input
                  type="date"
                  value={formData.date}
                  onChange={(event) =>
                    setFormData({ ...formData, date: event.target.value })
                  }
                  className="w-full px-4 py-2 rounded-lg border border-border bg-background"
                  required
                />
              </div>

              <div>
                <label className="block text-sm mb-2">{text.bodyWeight}</label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  value={formData.weight}
                  onChange={(event) =>
                    setFormData({ ...formData, weight: event.target.value })
                  }
                  className="w-full px-4 py-2 rounded-lg border border-border bg-background"
                  required
                />
              </div>

              <div>
                <label className="block text-sm mb-2">{text.adherence}</label>
                <select
                  value={formData.adherence_status}
                  onChange={(event) =>
                    setFormData({
                      ...formData,
                      adherence_status: event.target.value,
                    })
                  }
                  className="w-full px-4 py-2 rounded-lg border border-border bg-background"
                >
                  <option value="Yes">{text.yes}</option>
                  <option value="No">{text.no}</option>
                  <option value="Missed some doses">{text.missed}</option>
                </select>
              </div>


              <div>
                <label className="block text-sm mb-2">{text.notes}</label>
                <textarea
                  value={formData.notes}
                  onChange={(event) =>
                    setFormData({ ...formData, notes: event.target.value })
                  }
                  className="w-full px-4 py-2 rounded-lg border border-border bg-background min-h-[100px]"
                  placeholder={text.notesPlaceholder}
                />
              </div>

              <div className="flex items-center gap-3 pt-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  {saving ? text.saving : editingFollowupId ? text.updateFollowup : text.save}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowModal(false);
                    setEditingFollowupId(null);
                  }}
                  className="flex-1 px-4 py-2 border border-border rounded-lg hover:bg-accent transition-colors"
                >
                  {text.cancel}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={followupPendingDeleteId !== null}
        title={text.deleteFollowup}
        description={text.deleteConfirm}
        confirmLabel={text.confirmDelete}
        cancelLabel={text.cancel}
        onCancel={() => setFollowupPendingDeleteId(null)}
        onConfirm={() => {
          if (followupPendingDeleteId !== null) {
            void handleDeleteFollowup(followupPendingDeleteId);
          }
        } } message={""}      />
    </div>
  );
}
