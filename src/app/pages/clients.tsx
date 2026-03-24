import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Search, Plus, Edit, Eye, Trash2, RefreshCw } from "lucide-react";
import { Link } from "react-router";
import { api, getErrorMessage, isRequestCanceled } from "../lib/api";
import { useAppSettings } from "../lib/app-settings";
import { toDisplayId } from "../lib/id-format";
import { ConfirmDialog } from "../components/confirm-dialog";
import type { Client, ClientPayload, ProgramType } from "../lib/types";

const CLIENTS_PAGE_SIZE = 25;
const emptyClientForm: ClientPayload = {
  name: "",
  age: "",
  phone: "",
  program_type: "Weight Loss",
  chronic_diseases: "",
  starting_weight: "",
  target_weight: "",
};

function formatWeight(weight: number | null | undefined, language: "en" | "ar") {
  return weight ? `${weight.toFixed(1)} kg` : language === "ar" ? "غير مسجل" : "Not recorded";
}

function formatDate(date: string | null, language: "en" | "ar") {
  return date
    ? new Date(date).toLocaleDateString(language === "ar" ? "ar-EG" : "en-US")
    : language === "ar"
    ? "لا توجد متابعة بعد"
    : "No follow-up yet";
}

export function Clients() {
  const { language } = useAppSettings();
  const [clients, setClients] = useState<Client[]>([]);
  const [totalClients, setTotalClients] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filterProgram, setFilterProgram] = useState<"all" | ProgramType>("all");
  const [sortBy, setSortBy] = useState("id_desc");
  const [currentPage, setCurrentPage] = useState(1);
  const [showModal, setShowModal] = useState(false);
  const [editingClientId, setEditingClientId] = useState<number | null>(null);
  const [formData, setFormData] = useState<ClientPayload>(emptyClientForm);
  const [clientPendingDelete, setClientPendingDelete] = useState<Client | null>(null);
  const [cleaningData, setCleaningData] = useState(false);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedSearch(searchQuery.trim());
    }, 300);

    return () => window.clearTimeout(timeoutId);
  }, [searchQuery]);

  useEffect(() => {
    setCurrentPage(1);
  }, [debouncedSearch, filterProgram, sortBy]);

  useEffect(() => {
    const controller = new AbortController();
    void loadClients(currentPage, controller.signal);

    return () => controller.abort();
  }, [currentPage, debouncedSearch, filterProgram, sortBy]);

  const text =
    language === "ar"
      ? {
          title: "إدارة العملاء",
          subtitle: "إنشاء وتحديث ومتابعة ملفات العملاء النشطين.",
          addClient: "إضافة عميل",
          searchPlaceholder: "ابحث بالاسم أو الهاتف أو رقم العميل...",
          allPrograms: "كل البرامج",
          weightLoss: "سمنة",
          weightGain: "نحافة",
          loading: "جارٍ تحميل العملاء...",
          noClients: "لا يوجد عملاء مطابقون للفلاتر الحالية.",
          client: "العميل",
          clientId: "معرف العميل",
          program: "البرنامج",
          weights: "الأوزان",
          followups: "المتابعات",
          lastFollowup: "آخر متابعة",
          actions: "الإجراءات",
          yearsOld: "سنة",
          start: "البداية",
          current: "الحالي",
          target: "الهدف",
          progress: "التقدم",
          viewClient: "عرض العميل",
          editClient: "تعديل العميل",
          editTitle: "تعديل العميل",
          addTitle: "إضافة عميل",
          fullName: "الاسم الكامل",
          age: "العمر",
          phone: "الهاتف",
          chronicDiseases: "الأمراض المزمنة",
          startingWeight: "وزن البداية (كجم)",
          targetWeight: "الوزن المستهدف (كجم)",
          cancel: "إلغاء",
          saving: "جارٍ الحفظ...",
          updateClient: "تحديث العميل",
          saveClient: "حفظ العميل",
          previous: "السابق",
          next: "التالي",
          page: "الصفحة",
          of: "من",
          showing: "عرض",
          results: "عميل",
          sortBy: "الترتيب",
          newest: "الأعلى رقمًا",
          oldest: "الأقل رقمًا",
          newestDate: "الأحدث تاريخًا",
          oldestDate: "الأقدم تاريخًا",
          sameName: "نفس الاسم",
          nameAsc: "الاسم أ-ي",
          nameDesc: "الاسم ي-أ",
          progressHigh: "الأعلى تقدمًا",
          progressLow: "الأقل تقدمًا",
          mostFollowups: "الأكثر متابعات",
          leastFollowups: "الأقل متابعات",
          deleteClient: "حذف العميل",
          deleteConfirm: "هل أنت متأكد من حذف هذا العميل وكل متابعاته؟",
          confirmDelete: "تأكيد الحذف",
          cleanData: "تنظيف البيانات",
          cleaningData: "جارٍ التنظيف...",
          cleanDone: "تم تنظيف بيانات العملاء والمتابعات.",
        }
      : {
          title: "Clients Management",
          subtitle: "Create, update, and monitor active client records.",
          addClient: "Add Client",
          searchPlaceholder: "Search by name, phone, or client id...",
          allPrograms: "All Programs",
          weightLoss: "Weight Loss",
          weightGain: "Weight Gain",
          loading: "Loading clients...",
          noClients: "No clients found for the current filters.",
          client: "Client",
          clientId: "Client ID",
          program: "Program",
          weights: "Weights",
          followups: "Follow-ups",
          lastFollowup: "Last Follow-up",
          actions: "Actions",
          yearsOld: "years old",
          start: "Start",
          current: "Current",
          target: "Target",
          progress: "Progress",
          viewClient: "View client",
          editClient: "Edit client",
          editTitle: "Edit Client",
          addTitle: "Add Client",
          fullName: "Full name",
          age: "Age",
          phone: "Phone",
          chronicDiseases: "Chronic diseases",
          startingWeight: "Starting weight (kg)",
          targetWeight: "Target weight (kg)",
          cancel: "Cancel",
          saving: "Saving...",
          updateClient: "Update Client",
          saveClient: "Save Client",
          previous: "Previous",
          next: "Next",
          page: "Page",
          of: "of",
          showing: "Showing",
          results: "clients",
          sortBy: "Sort By",
          newest: "Highest ID",
          oldest: "Lowest ID",
          newestDate: "Newest Date",
          oldestDate: "Oldest Date",
          sameName: "Same Name",
          nameAsc: "Name A-Z",
          nameDesc: "Name Z-A",
          progressHigh: "Highest Progress",
          progressLow: "Lowest Progress",
          mostFollowups: "Most Follow-ups",
          leastFollowups: "Least Follow-ups",
          deleteClient: "Delete client",
          deleteConfirm: "Are you sure you want to delete this client and all follow-ups?",
          confirmDelete: "Confirm delete",
          cleanData: "Clean Data",
          cleaningData: "Cleaning...",
          cleanDone: "Clients and follow-ups data were cleaned.",
        };

  async function loadClients(page = currentPage, signal?: AbortSignal) {
    setLoading(true);
    setError(null);

    try {
      const response = await api.get<Client[]>("/clients", {
        params: {
          search: debouncedSearch || undefined,
          program: filterProgram === "all" ? undefined : filterProgram,
          sort: sortBy,
          limit: CLIENTS_PAGE_SIZE,
          offset: (page - 1) * CLIENTS_PAGE_SIZE,
        },
        signal,
      });

      setClients(response.data);
      setTotalClients(Number(response.headers["x-total-count"] ?? response.data.length));
    } catch (loadError) {
      if (isRequestCanceled(loadError)) {
        return;
      }
      setError(getErrorMessage(loadError, language === "ar" ? "تعذر تحميل العملاء." : "Unable to load clients."));
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }

  function openCreateModal() {
    setEditingClientId(null);
    setFormData(emptyClientForm);
    setShowModal(true);
    setError(null);
  }

  function openEditModal(client: Client) {
    setEditingClientId(client.id);
    setFormData({
      name: client.name,
      age: String(client.age),
      phone: client.phone ?? "",
      program_type: client.program_type,
      chronic_diseases: client.chronic_diseases ?? "",
      starting_weight: String(client.starting_weight),
      target_weight: client.target_weight ? String(client.target_weight) : "",
    });
    setShowModal(true);
    setError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);

    try {
      if (editingClientId) {
        await api.put(`/clients/${editingClientId}`, formData);
      } else {
        await api.post("/clients", formData);
        setCurrentPage(1);
      }

      setShowModal(false);
      setFormData(emptyClientForm);
      setEditingClientId(null);
      await loadClients(editingClientId ? currentPage : 1);
    } catch (saveError) {
      setError(getErrorMessage(saveError, language === "ar" ? "تعذر حفظ العميل." : "Unable to save client."));
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteClient(client: Client) {
    setError(null);
    try {
      await api.delete(`/clients/${client.id}`);
      await loadClients(1);
      setCurrentPage(1);
      setClientPendingDelete(null);
    } catch (deleteError) {
      setError(
        getErrorMessage(
          deleteError,
          language === "ar" ? "تعذر حذف العميل." : "Unable to delete client."
        )
      );
    }
  }

  async function handleCleanData() {
    setCleaningData(true);
    setError(null);

    try {
      await api.post("/admin/clean-data");
      await loadClients(1);
      setCurrentPage(1);
      setError(text.cleanDone);
    } catch (cleanError) {
      setError(
        getErrorMessage(
          cleanError,
          language === "ar" ? "تعذر تنظيف البيانات." : "Unable to clean data."
        )
      );
    } finally {
      setCleaningData(false);
    }
  }

  const totalPages = Math.max(1, Math.ceil(totalClients / CLIENTS_PAGE_SIZE));
  const pageStart = totalClients === 0 ? 0 : (currentPage - 1) * CLIENTS_PAGE_SIZE + 1;
  const pageEnd = totalClients === 0 ? 0 : pageStart + clients.length - 1;

  return (
    <div className="p-8" dir={language === "ar" ? "rtl" : "ltr"}>
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold mb-2">{text.title}</h1>
          <p className="text-muted-foreground">{text.subtitle}</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void handleCleanData()}
            disabled={cleaningData}
            className="flex items-center gap-2 rounded-lg border border-border bg-card px-5 py-3 transition-colors hover:bg-accent disabled:opacity-60"
          >
            <RefreshCw className={`w-5 h-5 ${cleaningData ? "animate-spin" : ""}`} />
            {cleaningData ? text.cleaningData : text.cleanData}
          </button>
          <button
            onClick={openCreateModal}
            className="flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-5 h-5" />
            {text.addClient}
          </button>
        </div>
      </div>

      <div className="bg-card rounded-xl p-6 border border-border shadow-sm mb-6">
        <div className="flex gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <input
              type="text"
              placeholder={text.searchPlaceholder}
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              className="w-full pl-10 pr-4 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <select
            value={filterProgram}
            onChange={(event) =>
              setFilterProgram(event.target.value as "all" | ProgramType)
            }
            className="px-4 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option value="all">{text.allPrograms}</option>
            <option value="Weight Loss">{text.weightLoss}</option>
            <option value="Weight Gain">{text.weightGain}</option>
          </select>

          <select
            value={sortBy}
            onChange={(event) => setSortBy(event.target.value)}
            className="px-4 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary"
            aria-label={text.sortBy}
          >
            <option value="id_desc">{text.newest}</option>
            <option value="id_asc">{text.oldest}</option>
            <option value="created_desc">{text.newestDate}</option>
            <option value="created_asc">{text.oldestDate}</option>
            <option value="same_name">{text.sameName}</option>
            <option value="name_asc">{text.nameAsc}</option>
            <option value="name_desc">{text.nameDesc}</option>
            <option value="progress_desc">{text.progressHigh}</option>
            <option value="progress_asc">{text.progressLow}</option>
            <option value="followups_desc">{text.mostFollowups}</option>
            <option value="followups_asc">{text.leastFollowups}</option>
          </select>
        </div>
      </div>

      <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-8 text-muted-foreground">{text.loading}</div>
        ) : clients.length === 0 ? (
          <div className="p-8 text-muted-foreground">{text.noClients}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-accent border-b border-border">
                <tr>
                  <th className="px-6 py-4 text-left font-semibold">{text.client}</th>
                  <th className="px-6 py-4 text-left font-semibold">{text.program}</th>
                  <th className="px-6 py-4 text-left font-semibold">{text.weights}</th>
                  <th className="px-6 py-4 text-left font-semibold">{text.followups}</th>
                  <th className="px-6 py-4 text-left font-semibold">{text.lastFollowup}</th>
                  <th className="px-6 py-4 text-left font-semibold">{text.actions}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {clients.map((client) => (
                  <tr key={client.id} className="hover:bg-accent/50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="font-medium">{client.name}</div>
                      <div className="text-sm text-muted-foreground">
                        {text.clientId}: {toDisplayId(client.id, client.display_id)}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {client.age} {text.yearsOld}
                        {client.phone ? ` • ${client.phone}` : ""}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`px-3 py-1 rounded-full text-sm ${
                          client.program_type === "Weight Loss"
                            ? "bg-primary/10 text-primary"
                            : "bg-secondary/10 text-secondary"
                        }`}
                      >
                        {client.program_type === "Weight Loss" ? text.weightLoss : text.weightGain}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm">
                      <div>{text.start}: {formatWeight(client.starting_weight, language)}</div>
                      <div className="text-primary">{text.current}: {formatWeight(client.current_weight, language)}</div>
                      <div className="text-muted-foreground">
                        {text.target}: {formatWeight(client.target_weight, language)}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="font-medium">{client.followup_count}</div>
                      <div className="text-sm text-muted-foreground">
                        {text.progress} {client.progress >= 0 ? "+" : ""}
                        {client.progress.toFixed(1)} kg
                      </div>
                    </td>
                    <td className="px-6 py-4 text-muted-foreground">
                      {formatDate(client.last_followup_date, language)}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <Link
                          to={`/clients/${client.id}`}
                          className="p-2 hover:bg-accent rounded-lg transition-colors"
                          title={text.viewClient}
                        >
                          <Eye className="w-4 h-4" />
                        </Link>
                        <button
                          onClick={() => openEditModal(client)}
                          className="p-2 hover:bg-accent rounded-lg transition-colors"
                          title={text.editClient}
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setClientPendingDelete(client)}
                          className="p-2 rounded-lg text-destructive transition-colors hover:bg-destructive/10"
                          title={text.deleteClient}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="mt-5 flex flex-col gap-3 rounded-xl border border-border bg-card px-5 py-4 shadow-sm md:flex-row md:items-center md:justify-between">
        <div className="text-sm text-muted-foreground">
          {text.showing} {pageStart}-{pageEnd} {text.of} {totalClients} {text.results}
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
            disabled={currentPage === 1 || loading}
            className="rounded-lg border border-border px-4 py-2 text-sm transition-colors hover:bg-accent disabled:opacity-50"
          >
            {text.previous}
          </button>
          <div className="text-sm text-muted-foreground">
            {text.page} {currentPage} {text.of} {totalPages}
          </div>
          <button
            type="button"
            onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
            disabled={currentPage >= totalPages || loading}
            className="rounded-lg border border-border px-4 py-2 text-sm transition-colors hover:bg-accent disabled:opacity-50"
          >
            {text.next}
          </button>
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-xl p-6 w-full max-w-xl border border-border shadow-xl">
            <h2 className="text-2xl font-semibold mb-6">
              {editingClientId ? text.editTitle : text.addTitle}
            </h2>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <input
                  placeholder={text.fullName}
                  value={formData.name}
                  onChange={(event) =>
                    setFormData({ ...formData, name: event.target.value })
                  }
                  className="border border-border bg-background px-4 py-2 rounded-lg"
                  required
                />
                <input
                  type="number"
                  min="1"
                  placeholder={text.age}
                  value={formData.age}
                  onChange={(event) =>
                    setFormData({ ...formData, age: event.target.value })
                  }
                  className="border border-border bg-background px-4 py-2 rounded-lg"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <input
                  placeholder={text.phone}
                  value={formData.phone}
                  onChange={(event) =>
                    setFormData({ ...formData, phone: event.target.value })
                  }
                  className="border border-border bg-background px-4 py-2 rounded-lg"
                />
                <select
                  value={formData.program_type}
                  onChange={(event) =>
                    setFormData({
                      ...formData,
                      program_type: event.target.value as ProgramType,
                    })
                  }
                  className="border border-border bg-background px-4 py-2 rounded-lg"
                >
                  <option value="Weight Loss">{text.weightLoss}</option>
                  <option value="Weight Gain">{text.weightGain}</option>
                </select>
              </div>

              <input
                placeholder={text.chronicDiseases}
                value={formData.chronic_diseases}
                onChange={(event) =>
                  setFormData({ ...formData, chronic_diseases: event.target.value })
                }
                className="border border-border bg-background px-4 py-2 rounded-lg w-full"
              />

              <div className="grid grid-cols-2 gap-4">
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  placeholder={text.startingWeight}
                  value={formData.starting_weight}
                  onChange={(event) =>
                    setFormData({ ...formData, starting_weight: event.target.value })
                  }
                  className="border border-border bg-background px-4 py-2 rounded-lg"
                  required
                />
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  placeholder={text.targetWeight}
                  value={formData.target_weight}
                  onChange={(event) =>
                    setFormData({ ...formData, target_weight: event.target.value })
                  }
                  className="border border-border bg-background px-4 py-2 rounded-lg"
                />
              </div>

              {error && <div className="text-sm text-destructive">{error}</div>}

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowModal(false);
                    setEditingClientId(null);
                    setFormData(emptyClientForm);
                    setError(null);
                  }}
                  className="px-4 py-2 border border-border rounded-lg hover:bg-accent transition-colors"
                >
                  {text.cancel}
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  {saving ? text.saving : editingClientId ? text.updateClient : text.saveClient}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={clientPendingDelete !== null}
        title={text.deleteClient}
        message={text.deleteConfirm}
        confirmLabel={text.confirmDelete}
        cancelLabel={text.cancel}
        busy={saving}
        onCancel={() => setClientPendingDelete(null)}
        onConfirm={() => {
          if (clientPendingDelete) {
            void handleDeleteClient(clientPendingDelete);
          }
        }}
      />
    </div>
  );
}
