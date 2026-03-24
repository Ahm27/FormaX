import { useEffect, useState } from "react";
import { Database, FileSearch, Table2, ArrowRight, Edit, Trash2, X, Eraser, Sparkles } from "lucide-react";
import { Link, useNavigate } from "react-router";
import { api, getErrorMessage, isRequestCanceled } from "../lib/api";
import { useAppSettings } from "../lib/app-settings";
import { ConfirmDialog } from "../components/confirm-dialog";
import type {
  Client,
  ClientPayload,
  FollowUp,
  FollowUpPayload,
  ProgramType,
} from "../lib/types";

const CLIENTS_PAGE_SIZE = 20;
const FOLLOWUPS_PAGE_SIZE = 30;

const emptyClientForm: ClientPayload = {
  name: "",
  age: "",
  phone: "",
  program_type: "Weight Loss",
  chronic_diseases: "",
  starting_weight: "",
  target_weight: "",
};

const emptyFollowupForm: FollowUpPayload = {
  client_id: "",
  date: "",
  weight: "",
  adherence_status: "Yes",
  notes: "",
};

type ExplorerTab = "clients" | "followups";

export function DatabaseExplorer() {
  const navigate = useNavigate();
  const { language } = useAppSettings();
  const [activeTab, setActiveTab] = useState<ExplorerTab>("clients");

  const [clientRows, setClientRows] = useState<Client[]>([]);
  const [clientTotal, setClientTotal] = useState(0);
  const [clientPage, setClientPage] = useState(1);
  const [clientSearch, setClientSearch] = useState("");
  const [debouncedClientSearch, setDebouncedClientSearch] = useState("");
  const [clientProgram, setClientProgram] = useState<"all" | ProgramType>("all");
  const [clientSort, setClientSort] = useState("id_desc");

  const [followupRows, setFollowupRows] = useState<FollowUp[]>([]);
  const [followupTotal, setFollowupTotal] = useState(0);
  const [followupPage, setFollowupPage] = useState(1);
  const [followupSearch, setFollowupSearch] = useState("");
  const [debouncedFollowupSearch, setDebouncedFollowupSearch] = useState("");
  const [followupProgram, setFollowupProgram] = useState<"all" | ProgramType>("all");
  const [followupAdherence, setFollowupAdherence] = useState("all");
  const [followupSort, setFollowupSort] = useState("id_desc");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [clientForm, setClientForm] = useState<ClientPayload>(emptyClientForm);
  const [showClientModal, setShowClientModal] = useState(false);

  const [editingFollowup, setEditingFollowup] = useState<FollowUp | null>(null);
  const [followupForm, setFollowupForm] = useState<FollowUpPayload>(emptyFollowupForm);
  const [showFollowupModal, setShowFollowupModal] = useState(false);
  const [clientPendingDelete, setClientPendingDelete] = useState<Client | null>(null);
  const [followupPendingDelete, setFollowupPendingDelete] = useState<FollowUp | null>(null);
  const [clearAllPending, setClearAllPending] = useState(false);
  const [dedupePending, setDedupePending] = useState(false);

  const text =
    language === "ar"
      ? {
          title: "مستكشف قاعدة البيانات",
          subtitle: "واجهة واضحة لاستعراض العملاء والمتابعات والبحث والتعديل المباشر داخل البيانات الحقيقية للنظام.",
          clientsTab: "جدول العملاء",
          followupsTab: "جدول المتابعات",
          totalClients: "إجمالي العملاء",
          totalFollowups: "إجمالي المتابعات",
          activeView: "العرض الحالي",
          liveData: "بيانات حية",
          searchClients: "ابحث عن عميل بالاسم أو الهاتف أو رقم العميل...",
          searchFollowups: "ابحث عن متابعة باسم العميل أو رقم العميل أو رقم المتابعة...",
          allPrograms: "كل البرامج",
          weightLoss: "سمنة",
          weightGain: "نحافة",
          allAdherence: "كل حالات الالتزام",
          imported: "مستورد",
          yes: "نعم",
          no: "لا",
          missed: "فاته بعض الجرعات",
          newest: "الأعلى رقمًا",
          oldest: "الأقل رقمًا",
          nameAsc: "الاسم أ-ي",
          nameDesc: "الاسم ي-أ",
          progressHigh: "الأعلى تقدمًا",
          mostFollowups: "الأكثر متابعات",
          newestDate: "الأعلى رقمًا",
          oldestDate: "الأقل رقمًا",
          heaviest: "الأعلى وزنًا",
          clientAsc: "العميل أ-ي",
          clientDesc: "العميل ي-أ",
          loading: "جارٍ تحميل البيانات...",
          emptyClients: "لا يوجد عملاء بهذه الفلاتر.",
          emptyFollowups: "لا توجد متابعات بهذه الفلاتر.",
          client: "العميل",
          program: "البرنامج",
          currentWeight: "الوزن الحالي",
          followups: "المتابعات",
          lastFollowup: "آخر متابعة",
          details: "التفاصيل",
          date: "التاريخ",
          weight: "الوزن",
          change: "التغير",
          adherence: "الالتزام",
          notes: "الملاحظات",
          page: "الصفحة",
          of: "من",
          previous: "السابق",
          next: "التالي",
          notRecorded: "غير مسجل",
          none: "لا يوجد",
          openClient: "فتح العميل",
          actions: "الإجراءات",
          edit: "تعديل",
          delete: "حذف",
          deleteClientConfirm: "هل أنت متأكد من حذف هذا العميل وكل متابعاته؟",
          deleteFollowupConfirm: "هل أنت متأكد من حذف هذه المتابعة؟",
          editClientTitle: "تعديل العميل",
          editFollowupTitle: "تعديل المتابعة",
          fullName: "الاسم الكامل",
          age: "العمر",
          phone: "الهاتف",
          chronicDiseases: "الأمراض المزمنة",
          startingWeight: "وزن البداية",
          targetWeight: "الوزن المستهدف",
          cancel: "إلغاء",
          save: "حفظ",
          saving: "جارٍ الحفظ...",
          confirmDelete: "تأكيد الحذف",
          clearAllRows: "حذف كل البيانات",
          dedupeRows: "إزالة التكرارات",
          clearAllRowsConfirm:
            "هل أنت متأكد من حذف كل صفوف العملاء والمتابعات؟ سيتم الإبقاء على الجداول نفسها.",
          clearAllRowsDone: "تم حذف كل صفوف البيانات.",
          dedupeRowsConfirm:
            "هل تريد تشغيل إزالة التكرارات الآن؟ سيتم الاحتفاظ بأقدم عميل متطابق وحذف النسخ المكررة مع متابعاتها.",
          dedupeRowsDone: "تمت إزالة التكرارات من قاعدة البيانات.",
        }
      : {
          title: "Database Explorer",
          subtitle: "A clear admin workspace to inspect, search, and edit the real system data directly.",
          clientsTab: "Clients Table",
          followupsTab: "Follow-Ups Table",
          totalClients: "Total Clients",
          totalFollowups: "Total Follow-Ups",
          activeView: "Active View",
          liveData: "Live Data",
          searchClients: "Search clients by name, phone, or client id...",
          searchFollowups: "Search follow-ups by client name, client id, or follow-up id...",
          allPrograms: "All Programs",
          weightLoss: "Weight Loss",
          weightGain: "Weight Gain",
          allAdherence: "All Adherence",
          imported: "Imported",
          yes: "Yes",
          no: "No",
          missed: "Missed some doses",
          newest: "Highest ID",
          oldest: "Lowest ID",
          nameAsc: "Name A-Z",
          nameDesc: "Name Z-A",
          progressHigh: "Highest Progress",
          mostFollowups: "Most Follow-ups",
          newestDate: "Highest ID",
          oldestDate: "Lowest ID",
          heaviest: "Heaviest",
          clientAsc: "Client A-Z",
          clientDesc: "Client Z-A",
          loading: "Loading database data...",
          emptyClients: "No clients match these filters.",
          emptyFollowups: "No follow-ups match these filters.",
          client: "Client",
          program: "Program",
          currentWeight: "Current Weight",
          followups: "Follow-ups",
          lastFollowup: "Last Follow-up",
          details: "Details",
          date: "Date",
          weight: "Weight",
          change: "Change",
          adherence: "Adherence",
          notes: "Notes",
          page: "Page",
          of: "of",
          previous: "Previous",
          next: "Next",
          notRecorded: "Not recorded",
          none: "None",
          openClient: "Open Client",
          actions: "Actions",
          edit: "Edit",
          delete: "Delete",
          deleteClientConfirm: "Are you sure you want to delete this client and all follow-ups?",
          deleteFollowupConfirm: "Are you sure you want to delete this follow-up?",
          editClientTitle: "Edit Client",
          editFollowupTitle: "Edit Follow-Up",
          fullName: "Full name",
          age: "Age",
          phone: "Phone",
          chronicDiseases: "Chronic diseases",
          startingWeight: "Starting weight",
          targetWeight: "Target weight",
          cancel: "Cancel",
          save: "Save",
          saving: "Saving...",
          confirmDelete: "Confirm delete",
          clearAllRows: "Delete All Rows",
          dedupeRows: "Remove Duplicates",
          clearAllRowsConfirm:
            "Are you sure you want to delete all client and follow-up rows? The tables themselves will remain.",
          clearAllRowsDone: "All data rows were deleted.",
          dedupeRowsConfirm:
            "Do you want to run duplicate removal now? The oldest exact client record will be kept and duplicate copies with their follow-ups will be deleted.",
          dedupeRowsDone: "Duplicate rows were removed from the database.",
        };

  useEffect(() => {
    if (window.localStorage.getItem("pharmacy-db-access") !== "granted") {
      navigate("/settings");
    }
  }, [navigate]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedClientSearch(clientSearch.trim());
    }, 300);

    return () => window.clearTimeout(timeoutId);
  }, [clientSearch]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedFollowupSearch(followupSearch.trim());
    }, 300);

    return () => window.clearTimeout(timeoutId);
  }, [followupSearch]);

  useEffect(() => {
    setClientPage(1);
  }, [debouncedClientSearch, clientProgram, clientSort]);

  useEffect(() => {
    setFollowupPage(1);
  }, [debouncedFollowupSearch, followupProgram, followupAdherence, followupSort]);

  useEffect(() => {
    const controller = new AbortController();
    void loadClients(controller.signal);

    return () => controller.abort();
  }, [clientPage, debouncedClientSearch, clientProgram, clientSort]);

  useEffect(() => {
    const controller = new AbortController();
    void loadFollowups(controller.signal);

    return () => controller.abort();
  }, [followupPage, debouncedFollowupSearch, followupProgram, followupAdherence, followupSort]);

  async function loadClients(signal?: AbortSignal) {
    try {
      setLoading(true);
      const response = await api.get<Client[]>("/clients", {
        params: {
          search: debouncedClientSearch || undefined,
          program: clientProgram === "all" ? undefined : clientProgram,
          sort: clientSort,
          limit: CLIENTS_PAGE_SIZE,
          offset: (clientPage - 1) * CLIENTS_PAGE_SIZE,
        },
        signal,
      });
      setClientRows(response.data);
      setClientTotal(Number(response.headers["x-total-count"] ?? response.data.length));
    } catch (loadError) {
      if (isRequestCanceled(loadError)) {
        return;
      }
      setStatusMessage(getErrorMessage(loadError, "Unable to load clients."));
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }

  async function loadFollowups(signal?: AbortSignal) {
    try {
      setLoading(true);
      const response = await api.get<FollowUp[]>("/followups", {
        params: {
          search: debouncedFollowupSearch || undefined,
          program: followupProgram === "all" ? undefined : followupProgram,
          adherence: followupAdherence === "all" ? undefined : followupAdherence,
          sort: followupSort,
          limit: FOLLOWUPS_PAGE_SIZE,
          offset: (followupPage - 1) * FOLLOWUPS_PAGE_SIZE,
        },
        signal,
      });
      setFollowupRows(response.data);
      setFollowupTotal(Number(response.headers["x-total-count"] ?? response.data.length));
    } catch (loadError) {
      if (isRequestCanceled(loadError)) {
        return;
      }
      setStatusMessage(getErrorMessage(loadError, "Unable to load follow-ups."));
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }

  function openClientEditor(client: Client) {
    setEditingClient(client);
    setClientForm({
      name: client.name,
      age: String(client.age),
      phone: client.phone ?? "",
      program_type: client.program_type,
      chronic_diseases: client.chronic_diseases === "None" ? "" : client.chronic_diseases ?? "",
      starting_weight: String(client.starting_weight),
      target_weight: client.target_weight ? String(client.target_weight) : "",
    });
    setShowClientModal(true);
  }

  function openFollowupEditor(followup: FollowUp) {
    setEditingFollowup(followup);
    setFollowupForm({
      client_id: String(followup.client_id),
      date: followup.date,
      weight: String(followup.weight),
      adherence_status: followup.adherence_status,
      notes: followup.notes ?? "",
    });
    setShowFollowupModal(true);
  }

  async function handleClientSave() {
    if (!editingClient) {
      return;
    }

    try {
      setSaving(true);
      await api.put(`/clients/${editingClient.id}`, clientForm);
      setStatusMessage(language === "ar" ? "تم تحديث العميل." : "Client updated.");
      setShowClientModal(false);
      setEditingClient(null);
      await Promise.all([loadClients(), loadFollowups()]);
    } catch (saveError) {
      setStatusMessage(getErrorMessage(saveError, language === "ar" ? "تعذر تحديث العميل." : "Unable to update client."));
    } finally {
      setSaving(false);
    }
  }

  async function handleFollowupSave() {
    if (!editingFollowup) {
      return;
    }

    try {
      setSaving(true);
      await api.put(`/followups/${editingFollowup.id}`, followupForm);
      setStatusMessage(language === "ar" ? "تم تحديث المتابعة." : "Follow-up updated.");
      setShowFollowupModal(false);
      setEditingFollowup(null);
      await Promise.all([loadClients(), loadFollowups()]);
    } catch (saveError) {
      setStatusMessage(getErrorMessage(saveError, language === "ar" ? "تعذر تحديث المتابعة." : "Unable to update follow-up."));
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteClient(client: Client) {
    try {
      await api.delete(`/clients/${client.id}`);
      setStatusMessage(language === "ar" ? "تم حذف العميل." : "Client deleted.");
      setClientPendingDelete(null);
      await Promise.all([loadClients(), loadFollowups()]);
    } catch (deleteError) {
      setStatusMessage(getErrorMessage(deleteError, language === "ar" ? "تعذر حذف العميل." : "Unable to delete client."));
    }
  }

  async function handleDeleteFollowup(followup: FollowUp) {
    try {
      await api.delete(`/followups/${followup.id}`);
      setStatusMessage(language === "ar" ? "تم حذف المتابعة." : "Follow-up deleted.");
      setFollowupPendingDelete(null);
      await Promise.all([loadClients(), loadFollowups()]);
    } catch (deleteError) {
      setStatusMessage(getErrorMessage(deleteError, language === "ar" ? "تعذر حذف المتابعة." : "Unable to delete follow-up."));
    }
  }

  async function handleClearAllRows() {
    try {
      setSaving(true);
      await api.delete("/admin/data");
      setStatusMessage(text.clearAllRowsDone);
      setClearAllPending(false);
      setClientPage(1);
      setFollowupPage(1);
      await Promise.all([loadClients(), loadFollowups()]);
    } catch (clearError) {
      setStatusMessage(
        getErrorMessage(
          clearError,
          language === "ar" ? "تعذر حذف كل البيانات." : "Unable to delete all data rows."
        )
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDedupeRows() {
    try {
      setSaving(true);
      const response = await api.post<{
        deletedClients: number;
        deletedFollowups: number;
      }>("/admin/dedupe-db");
      setStatusMessage(
        `${text.dedupeRowsDone} ${response.data.deletedClients} / ${response.data.deletedFollowups}`
      );
      setDedupePending(false);
      setClientPage(1);
      setFollowupPage(1);
      await Promise.all([loadClients(), loadFollowups()]);
    } catch (dedupeError) {
      setStatusMessage(
        getErrorMessage(
          dedupeError,
          language === "ar" ? "تعذر إزالة التكرارات." : "Unable to remove duplicate rows."
        )
      );
    } finally {
      setSaving(false);
    }
  }

  const clientPages = Math.max(1, Math.ceil(clientTotal / CLIENTS_PAGE_SIZE));
  const followupPages = Math.max(1, Math.ceil(followupTotal / FOLLOWUPS_PAGE_SIZE));

  return (
    <div className="p-8" dir={language === "ar" ? "rtl" : "ltr"}>
      <div className="mb-8 rounded-[28px] border border-border bg-[radial-gradient(circle_at_top_left,_rgba(46,125,255,0.18),_transparent_35%),linear-gradient(135deg,_rgba(255,255,255,0.97),_rgba(239,248,255,0.96))] p-8 shadow-sm dark:bg-[radial-gradient(circle_at_top_left,_rgba(46,125,255,0.22),_transparent_35%),linear-gradient(135deg,_rgba(30,41,59,0.98),_rgba(15,23,42,0.96))]">
        <div className="mb-3 text-xs font-semibold uppercase tracking-[0.24em] text-primary">
          {text.liveData}
        </div>
        <h1 className="mb-2 text-4xl font-semibold">{text.title}</h1>
        <p className="max-w-3xl text-muted-foreground">{text.subtitle}</p>
      </div>

      {statusMessage && (
        <div className="mb-6 rounded-2xl border border-border bg-accent/60 px-5 py-4 text-sm text-foreground">
          {statusMessage}
        </div>
      )}

      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <div className="mb-2 flex items-center gap-2 text-muted-foreground">
            <Database className="h-4 w-4" />
            {text.totalClients}
          </div>
          <div className="text-3xl font-semibold">{clientTotal}</div>
        </div>
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <div className="mb-2 flex items-center gap-2 text-muted-foreground">
            <Table2 className="h-4 w-4" />
            {text.totalFollowups}
          </div>
          <div className="text-3xl font-semibold">{followupTotal}</div>
        </div>
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <div className="mb-2 flex items-center gap-2 text-muted-foreground">
            <FileSearch className="h-4 w-4" />
            {text.activeView}
          </div>
          <div className="text-2xl font-semibold">
            {activeTab === "clients" ? text.clientsTab : text.followupsTab}
          </div>
        </div>
      </div>

      <div className="mb-6 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => setActiveTab("clients")}
          className={`rounded-xl px-5 py-3 text-sm font-medium transition-colors ${
            activeTab === "clients" ? "bg-primary text-primary-foreground" : "border border-border bg-card hover:bg-accent"
          }`}
        >
          {text.clientsTab}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("followups")}
          className={`rounded-xl px-5 py-3 text-sm font-medium transition-colors ${
            activeTab === "followups" ? "bg-primary text-primary-foreground" : "border border-border bg-card hover:bg-accent"
          }`}
        >
          {text.followupsTab}
        </button>
        <button
          type="button"
          onClick={() => setClearAllPending(true)}
          className="rounded-xl border border-destructive/30 bg-destructive/5 px-5 py-3 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10"
        >
          <span className="inline-flex items-center gap-2">
            <Eraser className="h-4 w-4" />
            {text.clearAllRows}
          </span>
        </button>
        <button
          type="button"
          onClick={() => setDedupePending(true)}
          className="rounded-xl border border-amber-400/30 bg-amber-500/5 px-5 py-3 text-sm font-medium text-amber-700 transition-colors hover:bg-amber-500/10 dark:text-amber-300"
        >
          <span className="inline-flex items-center gap-2">
            <Sparkles className="h-4 w-4" />
            {text.dedupeRows}
          </span>
        </button>
      </div>

      {activeTab === "clients" ? (
        <div className="space-y-5">
          <div className="grid gap-4 rounded-2xl border border-border bg-card p-5 shadow-sm md:grid-cols-4">
            <input
              type="text"
              value={clientSearch}
              onChange={(event) => setClientSearch(event.target.value)}
              placeholder={text.searchClients}
              className="rounded-xl border border-border bg-background px-4 py-3"
            />
            <select
              value={clientProgram}
              onChange={(event) => setClientProgram(event.target.value as "all" | ProgramType)}
              className="rounded-xl border border-border bg-background px-4 py-3"
            >
              <option value="all">{text.allPrograms}</option>
              <option value="Weight Loss">{text.weightLoss}</option>
              <option value="Weight Gain">{text.weightGain}</option>
            </select>
            <select
              value={clientSort}
              onChange={(event) => setClientSort(event.target.value)}
              className="rounded-xl border border-border bg-background px-4 py-3"
            >
              <option value="id_desc">{text.newest}</option>
              <option value="id_asc">{text.oldest}</option>
              <option value="name_asc">{text.nameAsc}</option>
              <option value="name_desc">{text.nameDesc}</option>
              <option value="progress_desc">{text.progressHigh}</option>
              <option value="followups_desc">{text.mostFollowups}</option>
            </select>
          </div>

          <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
            {loading ? (
              <div className="p-8 text-muted-foreground">{text.loading}</div>
            ) : clientRows.length === 0 ? (
              <div className="p-8 text-muted-foreground">{text.emptyClients}</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-accent/70">
                    <tr>
                      <th className="px-5 py-4 text-left text-sm font-semibold">{text.client}</th>
                      <th className="px-5 py-4 text-left text-sm font-semibold">{text.program}</th>
                      <th className="px-5 py-4 text-left text-sm font-semibold">{text.currentWeight}</th>
                      <th className="px-5 py-4 text-left text-sm font-semibold">{text.followups}</th>
                      <th className="px-5 py-4 text-left text-sm font-semibold">{text.lastFollowup}</th>
                      <th className="px-5 py-4 text-left text-sm font-semibold">{text.actions}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {clientRows.map((client) => (
                      <tr key={client.id} className="hover:bg-accent/40">
                        <td className="px-5 py-4">
                          <div className="font-medium">{client.name}</div>
                          <div className="text-sm text-muted-foreground">{client.phone || text.none}</div>
                        </td>
                        <td className="px-5 py-4">{client.program_type === "Weight Loss" ? text.weightLoss : text.weightGain}</td>
                        <td className="px-5 py-4">{client.current_weight?.toFixed(1) ?? text.notRecorded}</td>
                        <td className="px-5 py-4">{client.followup_count}</td>
                        <td className="px-5 py-4">{client.last_followup_date ?? text.none}</td>
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-2">
                            <Link
                              to={`/clients/${client.id}`}
                              className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent"
                            >
                              {text.openClient}
                              <ArrowRight className="h-4 w-4" />
                            </Link>
                            <button
                              type="button"
                              onClick={() => openClientEditor(client)}
                              className="rounded-lg border border-border p-2 hover:bg-accent"
                              title={text.edit}
                            >
                              <Edit className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setClientPendingDelete(client)}
                              className="rounded-lg border border-destructive/30 p-2 text-destructive hover:bg-destructive/10"
                              title={text.delete}
                            >
                              <Trash2 className="h-4 w-4" />
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

          <PaginationControls
            currentPage={clientPage}
            totalPages={clientPages}
            previousLabel={text.previous}
            nextLabel={text.next}
            pageLabel={text.page}
            ofLabel={text.of}
            onPrevious={() => setClientPage((page) => Math.max(1, page - 1))}
            onNext={() => setClientPage((page) => Math.min(clientPages, page + 1))}
          />
        </div>
      ) : (
        <div className="space-y-5">
          <div className="grid gap-4 rounded-2xl border border-border bg-card p-5 shadow-sm md:grid-cols-4">
            <input
              type="text"
              value={followupSearch}
              onChange={(event) => setFollowupSearch(event.target.value)}
              placeholder={text.searchFollowups}
              className="rounded-xl border border-border bg-background px-4 py-3"
            />
            <select
              value={followupProgram}
              onChange={(event) => setFollowupProgram(event.target.value as "all" | ProgramType)}
              className="rounded-xl border border-border bg-background px-4 py-3"
            >
              <option value="all">{text.allPrograms}</option>
              <option value="Weight Loss">{text.weightLoss}</option>
              <option value="Weight Gain">{text.weightGain}</option>
            </select>
            <select
              value={followupAdherence}
              onChange={(event) => setFollowupAdherence(event.target.value)}
              className="rounded-xl border border-border bg-background px-4 py-3"
            >
              <option value="all">{text.allAdherence}</option>
              <option value="Yes">{text.yes}</option>
              <option value="No">{text.no}</option>
              <option value="Missed some doses">{text.missed}</option>
              <option value="Imported">{text.imported}</option>
            </select>
            <select
              value={followupSort}
              onChange={(event) => setFollowupSort(event.target.value)}
              className="rounded-xl border border-border bg-background px-4 py-3"
            >
              <option value="id_desc">{text.newestDate}</option>
              <option value="id_asc">{text.oldestDate}</option>
              <option value="weight_desc">{text.heaviest}</option>
              <option value="client_asc">{text.clientAsc}</option>
              <option value="client_desc">{text.clientDesc}</option>
            </select>
          </div>

          <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
            {loading ? (
              <div className="p-8 text-muted-foreground">{text.loading}</div>
            ) : followupRows.length === 0 ? (
              <div className="p-8 text-muted-foreground">{text.emptyFollowups}</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-accent/70">
                    <tr>
                      <th className="px-5 py-4 text-left text-sm font-semibold">{text.client}</th>
                      <th className="px-5 py-4 text-left text-sm font-semibold">{text.date}</th>
                      <th className="px-5 py-4 text-left text-sm font-semibold">{text.program}</th>
                      <th className="px-5 py-4 text-left text-sm font-semibold">{text.weight}</th>
                      <th className="px-5 py-4 text-left text-sm font-semibold">{text.change}</th>
                      <th className="px-5 py-4 text-left text-sm font-semibold">{text.adherence}</th>
                      <th className="px-5 py-4 text-left text-sm font-semibold">{text.notes}</th>
                      <th className="px-5 py-4 text-left text-sm font-semibold">{text.actions}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {followupRows.map((followup) => (
                      <tr key={followup.id} className="hover:bg-accent/40">
                        <td className="px-5 py-4 font-medium">{followup.client_name}</td>
                        <td className="px-5 py-4">{followup.date}</td>
                        <td className="px-5 py-4">{followup.program_type === "Weight Loss" ? text.weightLoss : text.weightGain}</td>
                        <td className="px-5 py-4">{followup.weight.toFixed(1)}</td>
                        <td className="px-5 py-4">{followup.weight_change === null ? text.none : followup.weight_change.toFixed(1)}</td>
                        <td className="px-5 py-4">{followup.adherence_status}</td>
                        <td className="max-w-xs truncate px-5 py-4 text-muted-foreground">{followup.notes || text.none}</td>
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => openFollowupEditor(followup)}
                              className="rounded-lg border border-border p-2 hover:bg-accent"
                              title={text.edit}
                            >
                              <Edit className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setFollowupPendingDelete(followup)}
                              className="rounded-lg border border-destructive/30 p-2 text-destructive hover:bg-destructive/10"
                              title={text.delete}
                            >
                              <Trash2 className="h-4 w-4" />
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

          <PaginationControls
            currentPage={followupPage}
            totalPages={followupPages}
            previousLabel={text.previous}
            nextLabel={text.next}
            pageLabel={text.page}
            ofLabel={text.of}
            onPrevious={() => setFollowupPage((page) => Math.max(1, page - 1))}
            onNext={() => setFollowupPage((page) => Math.min(followupPages, page + 1))}
          />
        </div>
      )}

      {showClientModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-xl rounded-2xl border border-border bg-card p-6 shadow-xl">
            <div className="mb-5 flex items-center justify-between">
              <h3 className="text-2xl font-semibold">{text.editClientTitle}</h3>
              <button type="button" onClick={() => setShowClientModal(false)} className="rounded-lg p-2 hover:bg-accent">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <input value={clientForm.name} onChange={(e) => setClientForm({ ...clientForm, name: e.target.value })} placeholder={text.fullName} className="rounded-lg border border-border bg-background px-4 py-3" />
              <input type="number" min="1" value={clientForm.age} onChange={(e) => setClientForm({ ...clientForm, age: e.target.value })} placeholder={text.age} className="rounded-lg border border-border bg-background px-4 py-3" />
              <input value={clientForm.phone} onChange={(e) => setClientForm({ ...clientForm, phone: e.target.value })} placeholder={text.phone} className="rounded-lg border border-border bg-background px-4 py-3" />
              <select value={clientForm.program_type} onChange={(e) => setClientForm({ ...clientForm, program_type: e.target.value as ProgramType })} className="rounded-lg border border-border bg-background px-4 py-3">
                <option value="Weight Loss">{text.weightLoss}</option>
                <option value="Weight Gain">{text.weightGain}</option>
              </select>
              <input value={clientForm.chronic_diseases} onChange={(e) => setClientForm({ ...clientForm, chronic_diseases: e.target.value })} placeholder={text.chronicDiseases} className="col-span-2 rounded-lg border border-border bg-background px-4 py-3" />
              <input type="number" step="0.1" min="0" value={clientForm.starting_weight} onChange={(e) => setClientForm({ ...clientForm, starting_weight: e.target.value })} placeholder={text.startingWeight} className="rounded-lg border border-border bg-background px-4 py-3" />
              <input type="number" step="0.1" min="0" value={clientForm.target_weight} onChange={(e) => setClientForm({ ...clientForm, target_weight: e.target.value })} placeholder={text.targetWeight} className="rounded-lg border border-border bg-background px-4 py-3" />
            </div>
            <div className="mt-5 flex justify-end gap-3">
              <button type="button" onClick={() => setShowClientModal(false)} className="rounded-lg border border-border px-4 py-2 hover:bg-accent">{text.cancel}</button>
              <button type="button" onClick={() => void handleClientSave()} disabled={saving} className="rounded-lg bg-primary px-4 py-2 text-primary-foreground hover:bg-primary/90 disabled:opacity-50">{saving ? text.saving : text.save}</button>
            </div>
          </div>
        </div>
      )}

      {showFollowupModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-xl">
            <div className="mb-5 flex items-center justify-between">
              <h3 className="text-2xl font-semibold">{text.editFollowupTitle}</h3>
              <button type="button" onClick={() => setShowFollowupModal(false)} className="rounded-lg p-2 hover:bg-accent">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="grid gap-4">
              <input value={editingFollowup?.client_name ?? ""} disabled className="rounded-lg border border-border bg-accent px-4 py-3 text-muted-foreground" />
              <input type="date" value={followupForm.date} onChange={(e) => setFollowupForm({ ...followupForm, date: e.target.value })} className="rounded-lg border border-border bg-background px-4 py-3" />
              <input type="number" step="0.1" min="0" value={followupForm.weight} onChange={(e) => setFollowupForm({ ...followupForm, weight: e.target.value })} className="rounded-lg border border-border bg-background px-4 py-3" />
              <select value={followupForm.adherence_status} onChange={(e) => setFollowupForm({ ...followupForm, adherence_status: e.target.value })} className="rounded-lg border border-border bg-background px-4 py-3">
                <option value="Yes">{text.yes}</option>
                <option value="No">{text.no}</option>
                <option value="Missed some doses">{text.missed}</option>
                <option value="Imported">{text.imported}</option>
              </select>
              <textarea value={followupForm.notes} onChange={(e) => setFollowupForm({ ...followupForm, notes: e.target.value })} className="min-h-[110px] rounded-lg border border-border bg-background px-4 py-3" />
            </div>
            <div className="mt-5 flex justify-end gap-3">
              <button type="button" onClick={() => setShowFollowupModal(false)} className="rounded-lg border border-border px-4 py-2 hover:bg-accent">{text.cancel}</button>
              <button type="button" onClick={() => void handleFollowupSave()} disabled={saving} className="rounded-lg bg-primary px-4 py-2 text-primary-foreground hover:bg-primary/90 disabled:opacity-50">{saving ? text.saving : text.save}</button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={clientPendingDelete !== null}
        title={text.delete}
        message={text.deleteClientConfirm}
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

      <ConfirmDialog
        open={followupPendingDelete !== null}
        title={text.delete}
        message={text.deleteFollowupConfirm}
        confirmLabel={text.confirmDelete}
        cancelLabel={text.cancel}
        busy={saving}
        onCancel={() => setFollowupPendingDelete(null)}
        onConfirm={() => {
          if (followupPendingDelete) {
            void handleDeleteFollowup(followupPendingDelete);
          }
        }}
      />

      <ConfirmDialog
        open={clearAllPending}
        title={text.clearAllRows}
        message={text.clearAllRowsConfirm}
        confirmLabel={text.confirmDelete}
        cancelLabel={text.cancel}
        busy={saving}
        onCancel={() => setClearAllPending(false)}
        onConfirm={() => {
          void handleClearAllRows();
        }}
      />

      <ConfirmDialog
        open={dedupePending}
        title={text.dedupeRows}
        message={text.dedupeRowsConfirm}
        confirmLabel={text.confirmDelete}
        cancelLabel={text.cancel}
        busy={saving}
        onCancel={() => setDedupePending(false)}
        onConfirm={() => {
          void handleDedupeRows();
        }}
      />
    </div>
  );
}

function PaginationControls({
  currentPage,
  totalPages,
  previousLabel,
  nextLabel,
  pageLabel,
  ofLabel,
  onPrevious,
  onNext,
}: {
  currentPage: number;
  totalPages: number;
  previousLabel: string;
  nextLabel: string;
  pageLabel: string;
  ofLabel: string;
  onPrevious: () => void;
  onNext: () => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-2xl border border-border bg-card px-5 py-4 shadow-sm">
      <div className="text-sm text-muted-foreground">
        {pageLabel} {currentPage} {ofLabel} {totalPages}
      </div>
      <div className="flex gap-3">
        <button type="button" onClick={onPrevious} disabled={currentPage === 1} className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-accent disabled:opacity-50">
          {previousLabel}
        </button>
        <button type="button" onClick={onNext} disabled={currentPage >= totalPages} className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-accent disabled:opacity-50">
          {nextLabel}
        </button>
      </div>
    </div>
  );
}
