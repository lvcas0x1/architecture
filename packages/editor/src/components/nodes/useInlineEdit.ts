import { useCallback, useEffect, useRef, useState } from "react";
import { useNodeActions } from "./context.js";

export interface InlineEdit<T extends HTMLInputElement | HTMLTextAreaElement> {
  editing: boolean;
  draft: string;
  setDraft: (value: string) => void;
  ref: React.RefObject<T | null>;
  /** Start editing, from a double-click or elsewhere. */
  start: () => void;
  /** Commit if anything changed, then close. */
  commit: () => void;
  cancel: () => void;
  /** Shared handling for Enter and Escape. */
  onKeyDown: (event: React.KeyboardEvent) => void;
}

/** Shared inline-edit state for node and context-menu actions. */
export function useInlineEdit<T extends HTMLInputElement | HTMLTextAreaElement>(
  nodeId: string,
  field: string,
  current: string,
  options: { multiline?: boolean; selectOnFocus?: boolean } = {},
): InlineEdit<T> {
  const { updateNodeData, editable, editingNodeId, setEditingNodeId } = useNodeActions();
  const [draft, setDraft] = useState(current);
  const ref = useRef<T>(null);

  const editing = editable && editingNodeId === nodeId;

  useEffect(() => {
    if (!editing) return;
    setDraft(current);
    // The initial value is a placeholder name like "New box", so it is
    // selected and typing straight away replaces it.
    const element = ref.current;
    if (!element) return;
    element.focus();
    if (options.selectOnFocus !== false) element.select();
    // Depending on current would re-select on every keystroke
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const start = useCallback(() => {
    if (!editable) return;
    setDraft(current);
    setEditingNodeId(nodeId);
  }, [editable, current, nodeId, setEditingNodeId]);

  const commit = useCallback(() => {
    setEditingNodeId(null);
    if (draft !== current) updateNodeData(nodeId, { [field]: draft });
  }, [draft, current, field, nodeId, setEditingNodeId, updateNodeData]);

  const cancel = useCallback(() => {
    setDraft(current);
    setEditingNodeId(null);
  }, [current, setEditingNodeId]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      // Keep the canvas shortcuts (delete and friends) from taking it
      event.stopPropagation();
      if (event.key === "Escape") {
        event.preventDefault();
        cancel();
        return;
      }
      if (event.key !== "Enter") return;
      // Multi-line commits on Cmd/Ctrl+Enter, single-line on Enter
      if (options.multiline ? event.metaKey || event.ctrlKey : true) {
        event.preventDefault();
        commit();
      }
    },
    [cancel, commit, options.multiline],
  );

  return { editing, draft, setDraft, ref, start, commit, cancel, onKeyDown };
}
