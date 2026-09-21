import * as Dialog from "@radix-ui/react-dialog";

/** "Go ahead anyway?", for saving or exporting a diagram with errors. */
export function ConfirmDialog({
  open,
  title,
  message,
  detail,
  confirmLabel,
  onConfirm,
  onOpenChange,
}: {
  open: boolean;
  title: string;
  message: string;
  /** Supporting detail, such as the breakdown, that makes the choice obvious. */
  detail?: string[];
  confirmLabel: string;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/25" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed top-1/2 left-1/2 z-50 w-[min(420px,92vw)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-lg border border-border-subtle bg-panel shadow-xl"
        >
          <header className="flex items-center border-b border-border-subtle px-4 py-3">
            <Dialog.Title className="text-sm font-semibold">{title}</Dialog.Title>
          </header>

          <div className="px-4 py-3">
            <p className="text-xs leading-relaxed text-ink">{message}</p>
            {detail && detail.length > 0 && (
              <ul className="mt-2 max-h-40 list-disc overflow-y-auto pl-4 text-[11px] leading-relaxed text-ink-muted">
                {detail.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            )}
          </div>

          <footer className="flex justify-end gap-2 border-t border-border-subtle px-4 py-3">
            <Dialog.Close className="rounded border border-border-subtle px-3 py-1.5 text-xs hover:bg-ink/6">
              Cancel
            </Dialog.Close>
            <button
              type="button"
              onClick={() => {
                onOpenChange(false);
                onConfirm();
              }}
              className="rounded bg-accent px-3 py-1.5 text-xs text-white hover:opacity-90"
            >
              {confirmLabel}
            </button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
