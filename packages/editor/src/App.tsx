import { ReactFlowProvider } from "@xyflow/react";
import { useCallback, useEffect, useState } from "react";
import { Canvas } from "./components/Canvas.js";
import { ConfirmDialog } from "./components/ConfirmDialog.js";
import { ExportDialog } from "./components/ExportDialog.js";
import { Palette } from "./components/Palette.js";
import { Toolbar } from "./components/Toolbar.js";
import { referencedArns } from "@architecture/schema";
import { downloadDiagram, pickDiagramFile } from "./lib/file.js";
import { useCatalogStore } from "./store/catalog.js";
import { useEditorStore } from "./store/editor.js";
import { useResourceStore } from "./store/resources.js";

export function App() {
  const load = useCatalogStore((s) => s.load);
  const [notice, setNotice] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  /** Dialog that confirms going ahead despite errors. */
  const [confirm, setConfirm] = useState<{
    message: string;
    detail: string[];
    label: string;
    run: () => void;
  } | null>(null);

  useEffect(() => {
    void load();
  }, [load]);

  /** Confirm validation errors before saving or exporting. */
  const withCheck = useCallback((label: string, run: () => void) => {
    const errors = useEditorStore.getState().revalidate();
    if (errors === 0) {
      run();
      return;
    }
    setConfirm({
      message: `The check found ${errors} error${errors > 1 ? "s" : ""}. ${label} anyway?`,
      detail: useEditorStore
        .getState()
        .issues.filter((issue) => issue.level === "error")
        .map((issue) => issue.message),
      label,
      run,
    });
  }, []);

  const handleSave = useCallback(() => {
    withCheck("Save", () => {
      const diagram = useEditorStore.getState().toDiagram();
      downloadDiagram(diagram);
      useEditorStore.setState({ dirty: false });
      setNotice("Saved.");
    });
  }, [withCheck]);

  /** Shared work after loading a diagram: auto-arrange if needed, then check. */
  const settleLoadedDiagram = useCallback(async (needsLayout: boolean) => {
    const store = useEditorStore.getState();
    const messages: string[] = [];

    if (needsLayout) {
      const laidOut = await store.applyAutoLayout();
      if (laidOut > 0) messages.push(`Auto-arranged ${laidOut} element(s)`);
    }

    const errors = useEditorStore.getState().revalidate();
    const issues = useEditorStore.getState().issues.length;
    if (issues > 0) {
      messages.push(errors > 0 ? `${errors} error(s)` : `${issues} to review`);
    }
    return messages;
  }, []);

  const handleAutoLayout = useCallback(async () => {
    const laidOut = await useEditorStore.getState().applyAutoLayout();
    setNotice(
      laidOut > 0 ? `Arranged ${laidOut} element(s).` : "Nothing to arrange.",
    );
  }, []);

  const handleOpen = useCallback(async () => {
    // Like New, do not throw away unsaved changes silently
    if (
      useEditorStore.getState().dirty &&
      !window.confirm(
        "You have unsaved changes. Discard them and open another diagram?",
      )
    ) {
      return;
    }
    try {
      const loaded = await pickDiagramFile();
      if (!loaded) return;
      const { diagram, notes } = loaded;
      useEditorStore.getState().loadDiagram(diagram);

      // The diagram holds only ARN references, so fetch the data needed to display it.
      // With the backend down this only shows "not fetched" badges; the diagram is fine.
      const arns = [...referencedArns(diagram)];
      if (arns.length > 0) void useResourceStore.getState().fetchMissing(arns);

      // An AI draft has no coordinates (layout.mode = "auto"). Settle them here.
      const extra = await settleLoadedDiagram(diagram.layout.mode === "auto");
      setNotice(
        [`Opened “${diagram.meta.title}”`, ...notes, ...extra].join(" · "),
      );
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    }
  }, [settleLoadedDiagram]);

  const handleNew = useCallback(() => {
    const { dirty, newDiagram } = useEditorStore.getState();
    if (
      dirty &&
      !window.confirm(
        "You have unsaved changes. Discard them and start a new diagram?",
      )
    ) {
      return;
    }
    newDiagram();
    useResourceStore.getState().reset();
    setNotice(null);
  }, []);

  // Save on Cmd+S
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        document.querySelector('[role="dialog"], [role="alertdialog"]')
      )
        return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        handleSave();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleSave]);

  // Warn when leaving with unsaved changes
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (useEditorStore.getState().dirty) event.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  // Resource fetch errors are reported in the same place
  const resourceError = useResourceStore((s) => s.lastError);
  useEffect(() => {
    if (resourceError) {
      setNotice(resourceError);
      useResourceStore.getState().clearError();
    }
  }, [resourceError]);

  // Changing an icon attribute re-checks the diagram on the spot.
  // Icons already placed can stop matching the new attribute.
  useEffect(() => {
    return useCatalogStore.subscribe((state, prev) => {
      if (state.scopeOverrides === prev.scopeOverrides) return;

      const store = useEditorStore.getState();
      const before = store.issues.filter((i) => i.level === "error").length;
      const after = store.revalidate();
      if (after > before) {
        setNotice(
          `Attribute changed. ${after} icon(s) are now in a place that does not match.`,
        );
      } else if (before > 0 && after < before) {
        setNotice("Attribute changed. The placement issues are resolved.");
      } else {
        setNotice("Attribute changed.");
      }
    });
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 3200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  return (
    <ReactFlowProvider>
      <div className="flex h-full w-full overflow-hidden">
        <Palette />
        <main className="flex min-w-0 flex-1 flex-col">
          <Toolbar
            onSave={handleSave}
            onOpen={handleOpen}
            onNew={handleNew}
            onExport={() => withCheck("Export", () => setExporting(true))}
            onAutoLayout={() => void handleAutoLayout()}
          />
          <Canvas />
        </main>
        <ExportDialog
          open={exporting}
          onOpenChange={setExporting}
          getDiagram={() => useEditorStore.getState().toDiagram()}
          onNotice={setNotice}
        />
        {confirm && (
          <ConfirmDialog
            open
            title="The check reported errors"
            message={confirm.message}
            detail={confirm.detail}
            confirmLabel={confirm.label}
            onConfirm={confirm.run}
            onOpenChange={(open) => !open && setConfirm(null)}
          />
        )}

        {notice && (
          <div
            role="status"
            className="pointer-events-none absolute bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-md bg-ink px-3 py-1.5 text-xs text-white shadow-lg"
          >
            {notice}
          </div>
        )}
      </div>
    </ReactFlowProvider>
  );
}
