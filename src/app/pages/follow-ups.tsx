import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import {
  Search,
  Plus,
  TrendingUp,
  TrendingDown,
  Edit,
  Trash2,
  X,
  ChevronDown,
  RefreshCw,
} from "lucide-react";
import { api, getErrorMessage, isRequestCanceled } from "../lib/api";
import { useAppSettings } from "../lib/app-settings";
import { toDisplayId } from "../lib/id-format";
import { ConfirmDialog } from "../components/confirm-dialog";
import type { Client, FollowUp, FollowUpPayload, ProgramType } from "../lib/types";

const FOLLOWUPS_PAGE_SIZE = 50;
const CLIENT_OPTIONS_LIMIT = 25;
const emptyFollowupForm: FollowUpPayload = {
  client_id: "",
  date: new Date().toISOString().split("T")[0],
  weight: "",
  adherence_status: "Yes",
  notes: "",
};

function formatWeight(weight: number | null | undefined) {
  return weight ? `${weight.toFixed(1)} kg` : "-";
}

export function FollowUps() {
  const { language } = useAppSettings();
  const [clientOptions, setClientOptions] = useState<Client[]>([]);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [followups, setFollowups] = useState<FollowUp[]>([]);
  const [totalFollowups, setTotalFollowups] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadingClientOptions, setLoadingClientOptions] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filterProgram, setFilterProgram] = useState<"all" | ProgramType>("all");
  const [sortBy, setSortBy] = useState("id_desc");
  const [currentPage, setCurrentPage] = useState(1);
  const [showModal, setShowModal] = useState(false);
  const [clientSearch, setClientSearch] = useState("");
  const [debouncedClientSearch, setDebouncedClientSearch] = useState("");
  const [showClientDropdown, setShowClientDropdown] = useState(false);
  const [formData, setFormData] = useState<FollowUpPayload>(emptyFollowupForm);
  const [selectedProgram, setSelectedProgram] = useState<ProgramType>("Weight Loss");
  const [editingFollowupId, setEditingFollowupId] = useState<number | null>(null);
  const [followupPendingDelete, setFollowupPendingDelete] = useState<FollowUp | null>(null);
  const [cleaningData, setCleaningData] = useState(false);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedSearch(searchQuery.trim());
    }, 300);

    return () => window.clearTimeout(timeoutId);
  }, [searchQuery]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedClientSearch(clientSearch.trim());
    }, 250);

    return () => window.clearTimeout(timeoutId);
  }, [clientSearch]);

  useEffect(() => {
    setCurrentPage(1);
  }, [debouncedSearch, filterProgram, sortBy]);

  useEffect(() => {
    const controller = new AbortController();
    void loadFollowups(currentPage, controller.signal);

    return () => controller.abort();
  }, [currentPage, debouncedSearch, filterProgram, sortBy]);

  useEffect(() => {
    if (!showModal) {
      return;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      void loadClientOptions(controller.signal);
    }, 200);

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [showModal, selectedProgram, debouncedClientSearch]);

  const text =
    language === "ar"
      ? {
          title: "المتابعات",
          subtitle: "سجل كل زيارة وتحديث وزن وملاحظة التزام.",
          addFollowup: "إضافة متابعة",
          searchPlaceholder: "ابحث باسم العميل أو رقم العميل أو رقم المتابعة...",
          loading: "جارٍ تحميل المتابعات...",
          empty: "لا توجد متابعات.",
          clientName: "اسم العميل",
          clientId: "معرف العميل",
          date: "التاريخ",
          program: "البرنامج",
          currentWeight: "الوزن الحالي",
          weightChange: "تغير الوزن",
          adherence: "الالتزام",
          notes: "ملاحظات",
          firstRecord: "أول تسجيل",
          weightLoss: "سمنة",
          weightGain: "نحافة",
          addTitle: "إضافة متابعة",
          programType: "نوع البرنامج",
          selectClient: "اختيار العميل",
          searchSelectClient: "ابحث واختر العميل...",
          noClientsIn: "لا يوجد عملاء في",
          age: "العمر",
          years: "سنة",
          phone: "الهاتف",
          notProvided: "غير متوفر",
          targetWeight: "الوزن المستهدف",
          chronicDiseases: "الأمراض المزمنة",
          noneListed: "لا يوجد",
          currentWeightInput: "الوزن الحالي (كجم)",
          yes: "نعم",
          no: "لا",
          missed: "فاته بعض الجرعات",
          notesPlaceholder: "أضف ملاحظات أو مشاهدات...",
          saving: "جارٍ الحفظ...",
          save: "حفظ المتابعة",
          cancel: "إلغاء",
          previous: "السابق",
          next: "التالي",
          page: "الصفحة",
          of: "من",
          showing: "عرض",
          results: "متابعة",
          loadingClients: "جارٍ تحميل العملاء...",
          sortBy: "الترتيب",
          newestDate: "الأحدث تاريخًا",
          oldestDate: "الأقدم تاريخًا",
          sameName: "نفس الاسم",
          heaviest: "الأعلى وزنًا",
          lightest: "الأقل وزنًا",
          clientAsc: "العميل أ-ي",
          clientDesc: "العميل ي-أ",
          actions: "الإجراءات",
          editFollowup: "تعديل المتابعة",
          deleteFollowup: "حذف المتابعة",
          deleteConfirm: "هل أنت متأكد من حذف هذه المتابعة؟",
          confirmDelete: "تأكيد الحذف",
          cleanData: "تنظيف البيانات",
          cleaningData: "جارٍ التنظيف...",
          cleanDone: "تم تنظيف بيانات العملاء والمتابعات.",
        }
      : {
          title: "Follow-Ups",
          subtitle: "Track every visit, weight update, and adherence note.",
          addFollowup: "Add Follow-up",
          searchPlaceholder: "Search by client name, client id, or follow-up id...",
          loading: "Loading follow-ups...",
          empty: "No follow-ups found.",
          clientName: "Client Name",
          clientId: "Client ID",
          date: "Date",
          program: "Program",
          currentWeight: "Current Weight",
          weightChange: "Weight Change",
          adherence: "Adherence",
          notes: "Notes",
          firstRecord: "First record",
          weightLoss: "Weight Loss",
          weightGain: "Weight Gain",
          addTitle: "Add Follow-up",
          programType: "Program Type",
          selectClient: "Select Client",
          searchSelectClient: "Search and select client...",
          noClientsIn: "No clients found in",
          age: "Age",
          years: "years",
          phone: "Phone",
          notProvided: "Not provided",
          targetWeight: "Target Weight",
          chronicDiseases: "Chronic Diseases",
          noneListed: "None listed",
          currentWeightInput: "Current Weight (kg)",
          yes: "Yes",
          no: "No",
          missed: "Missed some doses",
          notesPlaceholder: "Add observations or notes...",
          saving: "Saving...",
          save: "Save Follow-up",
          cancel: "Cancel",
          previous: "Previous",
          next: "Next",
          page: "Page",
          of: "of",
          showing: "Showing",
          results: "follow-ups",
          loadingClients: "Loading clients...",
          sortBy: "Sort By",
          newestDate: "Newest Date",
          oldestDate: "Oldest Date",
          sameName: "Same Name",
          heaviest: "Heaviest",
          lightest: "Lightest",
          clientAsc: "Client A-Z",
          clientDesc: "Client Z-A",
          actions: "Actions",
          editFollowup: "Edit follow-up",
          deleteFollowup: "Delete follow-up",
          deleteConfirm: "Are you sure you want to delete this follow-up?",
          confirmDelete: "Confirm delete",
          cleanData: "Clean Data",
          cleaningData: "Cleaning...",
          cleanDone: "Clients and follow-ups data were cleaned.",
        };

  async function loadFollowups(page = currentPage, signal?: AbortSignal) {
    setLoading(true);
    setError(null);

    try {
      const followupsResponse = await api.get<FollowUp[]>("/followups", {
        params: {
          search: debouncedSearch || undefined,
          program: filterProgram === "all" ? undefined : filterProgram,
          sort: sortBy,
          limit: FOLLOWUPS_PAGE_SIZE,
          offset: (page - 1) * FOLLOWUPS_PAGE_SIZE,
        },
        signal,
      });

      setFollowups(followupsResponse.data);
      setTotalFollowups(Number(followupsResponse.headers["x-total-count"] ?? followupsResponse.data.length));
    } catch (loadError) {
      if (isRequestCanceled(loadError)) {
        return;
      }
      setError(getErrorMessage(loadError, language === "ar" ? "تعذر تحميل بيانات المتابعات." : "Unable to load follow-up data."));
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }

  async function loadClientOptions(signal?: AbortSignal) {
    setLoadingClientOptions(true);

    try {
      const response = await api.get<Client[]>("/clients", {
        params: {
          search: debouncedClientSearch || undefined,
          program: selectedProgram,
          limit: CLIENT_OPTIONS_LIMIT,
          offset: 0,
        },
        signal,
      });

      setClientOptions(response.data);

      if (formData.client_id) {
        const matchedClient = response.data.find((client) => String(client.id) === formData.client_id);
        if (matchedClient) {
          setSelectedClient(matchedClient);
        }
      }
    } catch (loadError) {
      if (isRequestCanceled(loadError)) {
        return;
      }
      setError(getErrorMessage(loadError, language === "ar" ? "تعذر تحميل العملاء." : "Unable to load clients."));
    } finally {
      if (!signal?.aborted) {
        setLoadingClientOptions(false);
      }
    }
  }

  function handleClientSelect(client: Client) {
    setFormData({
      ...formData,
      client_id: String(client.id),
    });
    setSelectedClient(client);
    setClientSearch(client.name);
    setShowClientDropdown(false);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);

    try {
      if (editingFollowupId) {
        await api.put(`/followups/${editingFollowupId}`, formData);
      } else {
        await api.post("/followups", formData);
      }
      setShowModal(false);
      setFormData(emptyFollowupForm);
      setClientSearch("");
      setSelectedClient(null);
      setEditingFollowupId(null);
      setCurrentPage(1);
      await loadFollowups(1);
    } catch (saveError) {
      setError(getErrorMessage(saveError, language === "ar" ? "تعذر حفظ المتابعة." : "Unable to save follow-up."));
    } finally {
      setSaving(false);
    }
  }

  async function openEditModal(followUp: FollowUp) {
    setError(null);
    setEditingFollowupId(followUp.id);
    setSelectedProgram(followUp.program_type);
    setClientSearch(followUp.client_name);
    setShowClientDropdown(false);
    setClientOptions([]);
    setShowModal(true);

    try {
      const response = await api.get<Client>(`/clients/${followUp.client_id}`);
      setSelectedClient(response.data);
      setClientOptions([response.data]);
      setFormData({
        client_id: String(followUp.client_id),
        date: followUp.date,
        weight: String(followUp.weight),
        adherence_status: followUp.adherence_status,
        notes: followUp.notes ?? "",
      });
    } catch (loadError) {
      setError(getErrorMessage(loadError, language === "ar" ? "تعذر تحميل بيانات العميل." : "Unable to load client details."));
    }
  }

  async function handleDeleteFollowup(followUp: FollowUp) {
    setError(null);
    try {
      await api.delete(`/followups/${followUp.id}`);
      await loadFollowups(1);
      setCurrentPage(1);
      setFollowupPendingDelete(null);
    } catch (deleteError) {
      setError(
        getErrorMessage(
          deleteError,
          language === "ar" ? "تعذر حذف المتابعة." : "Unable to delete follow-up."
        )
      );
    }
  }

  async function handleCleanData() {
    setCleaningData(true);
    setError(null);

    try {
      await api.post("/admin/clean-data");
      await loadFollowups(1);
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

  function getWeightChangeState(followUp: FollowUp) {
    if (followUp.weight_change === null) {
      return { label: text.firstRecord, positive: true, value: null };
    }

    const positive =
      followUp.program_type === "Weight Gain"
        ? followUp.weight_change > 0
        : followUp.weight_change < 0;

    return {
      label: `${followUp.weight_change > 0 ? "+" : ""}${followUp.weight_change.toFixed(1)} kg`,
      positive,
      value: followUp.weight_change,
    };
  }

  const totalPages = Math.max(1, Math.ceil(totalFollowups / FOLLOWUPS_PAGE_SIZE));
  const pageStart = totalFollowups === 0 ? 0 : (currentPage - 1) * FOLLOWUPS_PAGE_SIZE + 1;
  const pageEnd = totalFollowups === 0 ? 0 : pageStart + followups.length - 1;

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
            onClick={() => {
              setShowModal(true);
              setError(null);
              setEditingFollowupId(null);
              setSelectedProgram("Weight Loss");
              setClientSearch("");
              setSelectedClient(null);
              setClientOptions([]);
              setShowClientDropdown(false);
              setFormData({
                ...emptyFollowupForm,
                date: new Date().toISOString().split("T")[0],
              });
            }}
            className="flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-5 h-5" />
            {text.addFollowup}
          </button>
        </div>
      </div>

      <div className="bg-card rounded-xl p-6 border border-border shadow-sm mb-6">
        <div className="flex gap-4">
          <div className="relative flex-1">
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
            onChange={(event) => setFilterProgram(event.target.value as "all" | ProgramType)}
            className="px-4 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option value="all">{language === "ar" ? "كل البرامج" : "All Programs"}</option>
            <option value="Weight Loss">{text.weightLoss}</option>
            <option value="Weight Gain">{text.weightGain}</option>
          </select>

          <select
            value={sortBy}
            onChange={(event) => setSortBy(event.target.value)}
            className="px-4 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary"
            aria-label={text.sortBy}
          >
            <option value="date_desc">{text.newestDate}</option>
            <option value="date_asc">{text.oldestDate}</option>
            <option value="same_name">{text.sameName}</option>
            <option value="weight_desc">{text.heaviest}</option>
            <option value="weight_asc">{text.lightest}</option>
            <option value="client_asc">{text.clientAsc}</option>
            <option value="client_desc">{text.clientDesc}</option>
          </select>
        </div>
      </div>

      <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-8 text-muted-foreground">{text.loading}</div>
        ) : followups.length === 0 ? (
          <div className="p-8 text-muted-foreground">{text.empty}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-accent border-b border-border">
                <tr>
                  <th className="px-6 py-4 text-left font-semibold">{text.clientName}</th>
                  <th className="px-6 py-4 text-left font-semibold">{text.date}</th>
                  <th className="px-6 py-4 text-left font-semibold">{text.program}</th>
                  <th className="px-6 py-4 text-left font-semibold">{text.currentWeight}</th>
                  <th className="px-6 py-4 text-left font-semibold">{text.weightChange}</th>
                  <th className="px-6 py-4 text-left font-semibold">{text.adherence}</th>
                  <th className="px-6 py-4 text-left font-semibold">{text.notes}</th>
                  <th className="px-6 py-4 text-left font-semibold">{text.actions}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {followups.map((followUp) => {
                  const changeState = getWeightChangeState(followUp);

                  return (
                    <tr key={followUp.id} className="hover:bg-accent/50 transition-colors">
                      <td className="px-6 py-4">
                        <div className="font-medium">{followUp.client_name}</div>
                        <div className="text-xs text-muted-foreground">
                          {text.clientId}: {toDisplayId(
                            followUp.client_id,
                            followUp.client_display_id
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        {new Date(followUp.date).toLocaleDateString(language === "ar" ? "ar-EG" : "en-US")}
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`px-3 py-1 rounded-full text-sm ${
                            followUp.program_type === "Weight Loss"
                              ? "bg-primary/10 text-primary"
                              : "bg-secondary/10 text-secondary"
                          }`}
                        >
                          {followUp.program_type === "Weight Loss" ? text.weightLoss : text.weightGain}
                        </span>
                      </td>
                      <td className="px-6 py-4 font-medium">{formatWeight(followUp.weight)}</td>
                      <td className="px-6 py-4">
                        <div
                          className={`inline-flex items-center gap-1 ${
                            changeState.positive ? "text-secondary" : "text-destructive"
                          }`}
                        >
                          {changeState.value === null ? (
                            <span className="text-muted-foreground">{changeState.label}</span>
                          ) : changeState.positive ? (
                            <>
                              {followUp.program_type === "Weight Loss" ? (
                                <TrendingDown className="w-4 h-4" />
                              ) : (
                                <TrendingUp className="w-4 h-4" />
                              )}
                              <span className="font-medium">{changeState.label}</span>
                            </>
                          ) : (
                            <>
                              {followUp.program_type === "Weight Loss" ? (
                                <TrendingUp className="w-4 h-4" />
                              ) : (
                                <TrendingDown className="w-4 h-4" />
                              )}
                              <span className="font-medium">{changeState.label}</span>
                            </>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className="px-3 py-1 rounded-full text-sm bg-secondary/10 text-secondary">
                          {followUp.adherence_status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-muted-foreground max-w-xs truncate">
                        {followUp.notes || "-"}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => void openEditModal(followUp)}
                            className="p-2 hover:bg-accent rounded-lg transition-colors"
                            title={text.editFollowup}
                          >
                            <Edit className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setFollowupPendingDelete(followUp)}
                            className="p-2 rounded-lg text-destructive transition-colors hover:bg-destructive/10"
                            title={text.deleteFollowup}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="mt-5 flex flex-col gap-3 rounded-xl border border-border bg-card px-5 py-4 shadow-sm md:flex-row md:items-center md:justify-between">
        <div className="text-sm text-muted-foreground">
          {text.showing} {pageStart}-{pageEnd} {text.of} {totalFollowups} {text.results}
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
          <div className="bg-card rounded-xl p-6 max-w-2xl w-full border border-border shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-2xl font-semibold">
                {editingFollowupId ? text.editFollowup : text.addTitle}
              </h3>
              <button
                onClick={() => {
                  setShowModal(false);
                  setClientSearch("");
                  setSelectedClient(null);
                  setClientOptions([]);
                  setShowClientDropdown(false);
                  setFormData(emptyFollowupForm);
                  setEditingFollowupId(null);
                }}
                className="p-2 hover:bg-accent rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="block text-sm font-medium mb-2">{text.programType}</label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedProgram("Weight Loss");
                      setClientSearch("");
                      setShowClientDropdown(false);
                      setSelectedClient(null);
                      setClientOptions([]);
                      setEditingFollowupId(null);
                      setFormData({ ...formData, client_id: "" });
                    }}
                    className={`px-4 py-3 rounded-lg border-2 transition-all ${
                      selectedProgram === "Weight Loss"
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border hover:border-primary/50"
                    }`}
                  >
                    <div className="flex items-center justify-center gap-2">
                      <TrendingDown className="w-5 h-5" />
                      <span className="font-medium">{text.weightLoss}</span>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedProgram("Weight Gain");
                      setClientSearch("");
                      setShowClientDropdown(false);
                      setSelectedClient(null);
                      setClientOptions([]);
                      setEditingFollowupId(null);
                      setFormData({ ...formData, client_id: "" });
                    }}
                    className={`px-4 py-3 rounded-lg border-2 transition-all ${
                      selectedProgram === "Weight Gain"
                        ? "border-secondary bg-secondary/10 text-secondary"
                        : "border-border hover:border-secondary/50"
                    }`}
                  >
                    <div className="flex items-center justify-center gap-2">
                      <TrendingUp className="w-5 h-5" />
                      <span className="font-medium">{text.weightGain}</span>
                    </div>
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">{text.selectClient}</label>
                <div className="relative">
                  <input
                    type="text"
                    value={clientSearch}
                    onChange={(event) => {
                      setClientSearch(event.target.value);
                      setShowClientDropdown(true);
                      setSelectedClient(null);
                      setFormData({ ...formData, client_id: "" });
                    }}
                    onFocus={() => setShowClientDropdown(true)}
                    placeholder={text.searchSelectClient}
                    className="w-full px-4 py-2 pr-10 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                    required
                  />
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground pointer-events-none" />

                  {showClientDropdown && (
                    <div className="absolute top-full left-0 right-0 mt-2 bg-card border border-border rounded-lg shadow-lg max-h-60 overflow-y-auto z-10">
                      {loadingClientOptions ? (
                        <div className="px-4 py-3 text-muted-foreground text-sm">
                          {text.loadingClients}
                        </div>
                      ) : clientOptions.length > 0 ? (
                        clientOptions.map((client) => (
                          <button
                            key={client.id}
                            type="button"
                            onClick={() => handleClientSelect(client)}
                            className="w-full px-4 py-3 text-left hover:bg-accent transition-colors flex items-center justify-between border-b border-border last:border-b-0"
                          >
                            <div>
                              <div className="font-medium">{client.name}</div>
                              <div className="text-xs text-muted-foreground">
                                {text.clientId}: {toDisplayId(client.id, client.display_id)}
                              </div>
                            </div>
                            <span
                              className={`text-xs px-2 py-1 rounded-full ${
                                client.program_type === "Weight Loss"
                                  ? "bg-primary/10 text-primary"
                                  : "bg-secondary/10 text-secondary"
                              }`}
                            >
                              {client.program_type}
                            </span>
                          </button>
                        ))
                      ) : (
                        <div className="px-4 py-3 text-muted-foreground text-sm">
                          {language === "ar"
                            ? `${text.noClientsIn} ${selectedProgram === "Weight Loss" ? text.weightLoss : text.weightGain}`
                            : `${text.noClientsIn} ${selectedProgram}`}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {selectedClient && (
                <div className="rounded-xl border border-border bg-accent/50 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <div className="font-semibold">{selectedClient.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {text.clientId}: {toDisplayId(
                          selectedClient.id,
                          selectedClient.display_id
                        )}
                      </div>
                    </div>
                    <span
                      className={`px-3 py-1 rounded-full text-sm ${
                        selectedClient.program_type === "Weight Loss"
                          ? "bg-primary/10 text-primary"
                          : "bg-secondary/10 text-secondary"
                      }`}
                    >
                      {selectedClient.program_type}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <div className="text-muted-foreground">{text.age}</div>
                      <div className="font-medium">{selectedClient.age} {text.years}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">{text.phone}</div>
                      <div className="font-medium">{selectedClient.phone || text.notProvided}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">{text.currentWeight}</div>
                      <div className="font-medium">{formatWeight(selectedClient.current_weight)}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">{text.targetWeight}</div>
                      <div className="font-medium">{formatWeight(selectedClient.target_weight)}</div>
                    </div>
                    <div className="col-span-2">
                      <div className="text-muted-foreground">{text.chronicDiseases}</div>
                      <div className="font-medium">
                        {selectedClient.chronic_diseases || text.noneListed}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-2">{text.date}</label>
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
                  <label className="block text-sm font-medium mb-2">{text.currentWeightInput}</label>
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
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-2">{text.adherence}</label>
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
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">{text.notes}</label>
                <textarea
                  value={formData.notes}
                  onChange={(event) =>
                    setFormData({ ...formData, notes: event.target.value })
                  }
                  className="w-full px-4 py-2 rounded-lg border border-border bg-background min-h-[100px]"
                  placeholder={text.notesPlaceholder}
                />
              </div>


              {error && <div className="text-sm text-destructive">{error}</div>}

              <div className="flex items-center gap-3 pt-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 px-6 py-3 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  {saving ? text.saving : text.save}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowModal(false);
                    setClientSearch("");
                    setSelectedClient(null);
                    setClientOptions([]);
                    setShowClientDropdown(false);
                    setFormData(emptyFollowupForm);
                    setSelectedProgram("Weight Loss");
                    setEditingFollowupId(null);
                  }}
                  className="flex-1 px-6 py-3 border border-border rounded-lg hover:bg-accent transition-colors"
                >
                  {text.cancel}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={followupPendingDelete !== null}
        title={text.deleteFollowup}
        message={text.deleteConfirm}
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
    </div>
  );
}
