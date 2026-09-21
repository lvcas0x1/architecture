import { useEffect, useRef, useState } from "react";
import { type Project, parseResourceGraphInput } from "@architecture/schema";
import { diagramFingerprint, humanSave, pickProject, projectRequest } from "../lib/project.js";
import { parseDiagram } from "../lib/file.js";
import { useEditorStore } from "../store/editor.js";

export function ProjectPanel({ project, onUpdate }: { project: Project; onUpdate: (project: Project) => Promise<void> }) {
  const [report, setReport] = useState<string>("");
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const active = useRef(true);
  const latestProject = useRef(project);
  latestProject.current = project;
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const incomplete = project.graph.coverage.filter((c) => c.status !== "complete");
  const regenerate = async (mode: "regenerate" | "inventory" | "proposal", view = project.view) => {
    // Reserve the picker while the click still grants browser activation.
    const selection = mode === "regenerate" ? null : pickProject();
    setBusy(true);
    try {
      const file = selection ? await selection : null;
      if (selection && !file) return;
      const current = humanSave(project, useEditorStore.getState().toDiagram());
      const snapshot = diagramFingerprint(current.diagram);
      current.view = view;
      const updated = await projectRequest<Project>("regenerate", {
        project: current,
        ...(mode === "inventory" ? { graph: parseResourceGraphInput(file!.value) } : {}),
        ...(mode === "proposal" ? { proposal: parseDiagram(JSON.stringify(file!.value)).diagram } : {}),
      });
      if (!active.current) return;
      if (latestProject.current !== project || diagramFingerprint(useEditorStore.getState().toDiagram()) !== snapshot)
        throw new Error("The diagram changed during regeneration. Retry with the latest edits.");
      await onUpdate(updated);
      setReport("Regenerated. Human overrides and deletions were preserved. Save to update the file.");
      setExpanded(true);
    } catch (error) { setReport(String(error)); setExpanded(true); }
    finally { setBusy(false); }
  };
  return <div className="border-b border-border-subtle bg-panel px-3 py-2 text-xs">
    <button onClick={() => setExpanded(!expanded)} className="mr-3 text-accent">
      Inventory: {project.graph.resources.length} · Collection findings: {incomplete.length}
    </button>
    <span>Human overrides: {Object.keys(project.authority.protected).length}</span>
    <select aria-label="Architecture view" value={project.view} disabled={busy}
      className="ml-3 border border-border-subtle" onChange={(e) =>
        void regenerate("regenerate", e.target.value as Project["view"])}>
      <option value="overview">Overview</option><option value="network">Network</option>
      <option value="application">Application</option><option value="security">Security</option>
    </select>
    <button disabled={busy} className="ml-3 text-accent" onClick={() => void regenerate("regenerate")}>Regenerate</button>
    <button disabled={busy} className="ml-3 text-accent" onClick={() => void regenerate("inventory")}>Update inventory</button>
    <button disabled={busy} className="ml-3 text-accent" onClick={() => void regenerate("proposal")}>Apply AI proposal</button>
    <button className="ml-3 text-accent" onClick={async () => {
      try {
        const result = await projectRequest("validate", {
          ...project, diagram: useEditorStore.getState().toDiagram(),
        });
        setReport(JSON.stringify(result, null, 2));
        setExpanded(true);
      } catch (error) { setReport(String(error)); setExpanded(true); }
    }}>Check facts</button>
    {expanded && <div className="mt-2 max-h-56 overflow-auto">
      {incomplete.map((c, i) => <p key={i}>{c.source} · {c.accountId} · {c.region}: {c.message}</p>)}
      <details><summary>Relationship evidence</summary>
        {project.graph.relations.map((r, i) => <p key={i}>
          {r.sourceArn} → {r.targetArn} · {r.type} · {r.category}<br />
          {r.evidence.map((e) => `${e.source}: ${e.locator} (${e.observedAt})`).join("; ")}
        </p>)}
      </details>
      <details><summary>Resource parameters</summary>
        {project.graph.resources.map((r) => <details key={r.arn}>
          <summary>{r.name || r.resourceId} · {r.resourceType}</summary>
          <p>{r.arn}</p>
          <pre className="whitespace-pre-wrap">{JSON.stringify(r.parameters, null, 2)}</pre>
        </details>)}
      </details>
      {report && <pre className="whitespace-pre-wrap">{report}</pre>}
    </div>}
  </div>;
}
