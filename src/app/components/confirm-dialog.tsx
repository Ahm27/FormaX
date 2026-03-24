import { AlertTriangle } from "lucide-react";

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  description?: string; 
  cancelLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,

  cancelLabel,
  danger = true,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-xl">
        <div className="mb-4 flex items-start gap-3">
          <div
            className={`rounded-xl p-3 ${
              danger ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary"
            }`}
          >
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-xl font-semibold">{title}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{message}</p>
          </div>
        </div>

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-xl border border-border px-4 py-2 transition-colors hover:bg-accent disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`rounded-xl px-4 py-2 text-primary-foreground transition-colors disabled:opacity-50 ${
              danger ? "bg-destructive hover:bg-destructive/90" : "bg-primary hover:bg-primary/90"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
