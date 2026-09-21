/** Placement rules generated from Pydantic models. */
import rulesJson from "../generated/rules.json" with { type: "json" };
import type { GroupStyle, ResourceScope } from "./generated/models.js";

interface PlacementRules {
  patterns: Record<"arn" | "iconKey" | "relationType" | "accountId", string>;
  connectableNodeTypes: string[];
  containerNodeTypes: string[];
  topLevelGroupStyles: string[];
  groupStyleLabels: Record<string, string>;
  overlappableGroupStyles: string[][];
  groupNesting: Record<string, string[]>;
  resourceScopeContainers: Record<string, string[]>;
}

export const RULES = rulesJson as PlacementRules;

/** Field formats, shared with the server so a loaded file is judged the same way. */
export const matchesPattern = (name: keyof PlacementRules["patterns"], value: unknown): boolean =>
  typeof value === "string" && new RegExp(RULES.patterns[name]).test(value);

/** Display names for the box styles. Used in error messages and pickers. */
export const groupStyleLabel = (style: string): string =>
  RULES.groupStyleLabels[style] ?? style;

/** The box styles that can be the parent of a given style. */
export const allowedParentsOf = (style: string): string[] =>
  RULES.groupNesting[style] ?? [];

/** Whether two boxes with the same parent may overlap (a VPC and an AZ cross). */
export function canOverlapGroups(a: string, b: string): boolean {
  // The same style never overlaps itself (VPC with VPC, AZ with AZ)
  if (a === b) return false;
  return RULES.overlappableGroupStyles.some(
    (pair) => pair.includes(a) && pair.includes(b),
  );
}

/** Whether the box may sit directly on the canvas. */
export const canBeTopLevel = (style: string): boolean =>
  RULES.topLevelGroupStyles.includes(style);

/** parent=null means canvas; parent="shape" means a shape container. */
export function canNestGroup(child: string, parent: string | null): boolean {
  // The generic box is unconstrained on either side (the escape hatch)
  if (child === "generic" || parent === "generic") return true;
  if (parent === null) return canBeTopLevel(child);
  return allowedParentsOf(child).includes(parent);
}

/** containerStyle=null means an unrestricted shape container. */
export function canPlaceResource(
  scope: ResourceScope | undefined,
  containerStyle: string | null,
): boolean {
  if (!scope || scope === "any" || containerStyle === null) return true;
  if (containerStyle === "generic") return true;
  return (RULES.resourceScopeContainers[scope] ?? []).includes(containerStyle);
}

/** Scope labels ordered from outermost to innermost. */
export const RESOURCE_SCOPE_ORDER: ResourceScope[] = [
  "global",
  "region",
  "vpc",
  "zone",
  "subnet",
  "any",
];

const RESOURCE_SCOPE_LABELS: Record<ResourceScope, string> = {
  global: "Global",
  region: "Region",
  vpc: "VPC",
  zone: "Availability Zone",
  subnet: "Subnet",
  any: "No attribute",
};

export function resourceScopeLabel(scope: ResourceScope): string {
  return RESOURCE_SCOPE_LABELS[scope] ?? scope;
}

/** What setting this attribute makes the icon placeable in. */
export function explainScopeContainers(scope: ResourceScope): string {
  if (scope === "any") return "anywhere";
  const allowed = (RULES.resourceScopeContainers[scope] ?? []).map(groupStyleLabel);
  return allowed.length > 0 ? `inside ${allowed.join(", ")}` : "nowhere";
}

/** Explain why a box cannot go there. */
export function explainNesting(child: GroupStyle, parent: string | null): string {
  const childLabel = groupStyleLabel(child);
  if (parent === null) {
    const allowed = allowedParentsOf(child).map(groupStyleLabel).join(", ");
    return `“${childLabel}” cannot sit directly on the canvas. Put it inside ${allowed}.`;
  }
  return `“${childLabel}” cannot go inside “${groupStyleLabel(parent)}”.`;
}

/** Explain why a resource cannot go there. */
export function explainScope(scope: ResourceScope, containerStyle: string): string {
  const allowed = (RULES.resourceScopeContainers[scope] ?? [])
    .map(groupStyleLabel)
    .join(", ");
  return (
    `This resource cannot go inside “${groupStyleLabel(containerStyle)}”. ` +
    `Put it inside ${allowed}.`
  );
}
