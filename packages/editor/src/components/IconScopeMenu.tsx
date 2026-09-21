/** Icon scopes apply across diagrams. */
import {
  RESOURCE_SCOPE_ORDER,
  explainScopeContainers,
  resourceScopeLabel,
  type IconEntry,
} from "@architecture/schema";
import { useCatalogStore } from "../store/catalog.js";
import { ContextMenuSurface, type ActionItem, type MenuItem } from "./menu.js";

export interface IconMenuState {
  x: number;
  y: number;
  iconKey: string;
}

export function IconScopeMenu({
  state,
  icon,
  onClose,
}: {
  state: IconMenuState;
  icon: IconEntry | undefined;
  onClose: () => void;
}) {
  const scopeFor = useCatalogStore((s) => s.scopeFor);
  const setScope = useCatalogStore((s) => s.setScope);

  if (!icon) return null;

  const current = scopeFor(icon.key);

  // "No attribute" comes last. Everything, including whether to set one, is picked here.
  const items: MenuItem[] = RESOURCE_SCOPE_ORDER.map(
    (scope): ActionItem => ({
      kind: "action",
      label: resourceScopeLabel(scope),
      // Show what it would become placeable in, right there.
      // The attribute name alone does not convey the difference between Zone and Subnet.
      hint: explainScopeContainers(scope),
      checked: current === scope,
      onSelect: () => void setScope(icon.key, scope),
    }),
  );

  return (
    <ContextMenuSurface
      anchor={state}
      label={`${icon.label} attribute`}
      header={`${icon.label} — attribute`}
      className="min-w-56"
      items={items}
      onClose={onClose}
    />
  );
}
