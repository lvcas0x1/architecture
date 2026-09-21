import { createContext, useContext } from "react";

/** Inject editing actions; viewer defaults are no-ops. */
export interface NodeActions {
  updateNodeData: (id: string, patch: Record<string, unknown>) => void;
  /** Whether editing is allowed. False in the viewer. */
  editable: boolean;
  /** The node whose name is being edited, so the right-click menu can start editing too. */
  editingNodeId: string | null;
  setEditingNodeId: (id: string | null) => void;
  /** Reject sizes that violate parent or sibling constraints. */
  canResize: (nodeId: string, next: { x: number; y: number; width: number; height: number }) => boolean;
}

const noop: NodeActions = {
  updateNodeData: () => {},
  editable: false,
  editingNodeId: null,
  setEditingNodeId: () => {},
  canResize: () => true,
};

const NodeActionsContext = createContext<NodeActions>(noop);

export const NodeActionsProvider = NodeActionsContext.Provider;

export const useNodeActions = (): NodeActions => useContext(NodeActionsContext);
