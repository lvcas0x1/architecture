import { groupStyleLabel, type GroupNodeData } from "@architecture/schema";
import type { ArchNode } from "../lib/types.js";
import { GROUP_STYLE_ORDER, GROUP_STYLES } from "../lib/defaults.js";
import {
  DEFAULT_FONT_SIZE,
  FILL_OPACITIES,
  FONT_SIZES,
  TEXT_COLORS,
  hasFill,
  labelForColor,
  labelForFontSize,
  labelForOpacity,
} from "../lib/palette.js";
import {
  ContextMenuSurface,
  type ActionItem,
  type ContextMenuState,
  type MenuItem,
} from "./menu.js";

export type { ContextMenuState } from "./menu.js";

/** Resource actions and node styling. */
export function NodeContextMenu({
  state,
  node,
  onClose,
  onConfigure,
  onRefresh,
  onShowParameters,
  onUnbind,
  onRename,
  onSetTextColor,
  onSetFontSize,
  onSetFillColor,
  onSetFillOpacity,
  onChangeGroupStyle,
  onDelete,
}: {
  state: ContextMenuState;
  node: ArchNode | undefined;
  onClose: () => void;
  onConfigure: () => void;
  onRefresh: () => void;
  onShowParameters: () => void;
  onUnbind: () => void;
  onRename: () => void;
  /** null resets to the default (preset colour for a box, black for text). */
  onSetTextColor: (color: string | null) => void;
  onSetFontSize: (size: number) => void;
  /** null resets to the default (the preset colour). */
  onSetFillColor: (color: string | null) => void;
  /** null resets to the default opacity. */
  onSetFillOpacity: (opacity: number | null) => void;
  /** Change a box's style. The store refuses when the nesting rules do not allow it. */
  onChangeGroupStyle: (style: GroupNodeData["style"]) => void;
  onDelete: () => void;
}) {
  if (!node) return null;

  const isResource = node.type === "resource";
  const isGroup = node.type === "group";
  const isShape = node.type === "shape";
  const isText = node.type === "text";
  const bound = isResource && node.data.resourceRef !== null;
  const fillable = hasFill(node.type);

  // A shape holds no text (overlay a text node for a caption)
  const hasText = isGroup || isText;
  const currentColor = isGroup ? node.data.labelColor : isText ? node.data.color : null;
  const currentSize = isText ? node.data.fontSize : DEFAULT_FONT_SIZE;
  const currentFill = isGroup || isShape ? node.data.fillColor : null;
  const currentOpacity = isGroup || isShape ? node.data.fillOpacity : null;

  const buildColorItems = (
    current: string | null,
    onPick: (color: string | null) => void,
  ): MenuItem[] => [
    ...TEXT_COLORS.map(
      (color): ActionItem => ({
        kind: "action",
        label: color.label,
        swatch: color.value,
        checked: current === color.value,
        onSelect: () => onPick(color.value),
      }),
    ),
    { kind: "separator" },
    {
      kind: "action",
      label: "Reset to default",
      checked: current === null,
      onSelect: () => onPick(null),
    },
  ];

  const opacityItems: MenuItem[] = [
    ...FILL_OPACITIES.map(
      (opacity): ActionItem => ({
        kind: "action",
        label: labelForOpacity(opacity),
        checked: currentOpacity === opacity,
        onSelect: () => onSetFillOpacity(opacity),
      }),
    ),
    { kind: "separator" },
    {
      kind: "action",
      label: "Reset to default",
      checked: currentOpacity === null,
      onSelect: () => onSetFillOpacity(null),
    },
  ];

  const sizeItems: MenuItem[] = FONT_SIZES.map(
    (size): ActionItem => ({
      kind: "action",
      // The largest is the default size, so the last item is the default
      label: labelForFontSize(size),
      previewFontSize: size,
      checked: currentSize === size,
      onSelect: () => onSetFontSize(size),
    }),
  );

  const items: MenuItem[] = [];

  if (isResource) {
    items.push(
      {
        kind: "action",
        label: "Configure",
        hint: bound ? "Change the linked resource" : "Pick a resource JSON",
        onSelect: onConfigure,
      },
      {
        kind: "action",
        label: "Refresh",
        hint: bound ? "Re-run Describe" : "Configure it first",
        onSelect: onRefresh,
        disabled: !bound,
      },
      { kind: "separator" },
      { kind: "action", label: "Show parameters", onSelect: onShowParameters, disabled: !bound },
      { kind: "action", label: "Unlink resource", onSelect: onUnbind, disabled: !bound },
      { kind: "separator" },
    );
  }

  if (hasText || fillable) {
    if (hasText) {
      items.push({
        kind: "action",
        label: isText ? "Edit text" : "Rename",
        hint: "Or double-click",
        onSelect: onRename,
      });
      items.push({
        kind: "submenu",
        label: "Text color",
        hint: labelForColor(currentColor),
        items: buildColorItems(currentColor, onSetTextColor),
      });
    }

    if (isGroup) {
      const currentStyle = node.data.style;
      items.push({
        kind: "submenu",
        label: "Type",
        hint: groupStyleLabel(currentStyle),
        items: GROUP_STYLE_ORDER.map(
          (style): ActionItem => ({
            kind: "action",
            label: groupStyleLabel(style),
            swatch: GROUP_STYLES[style].stroke,
            checked: currentStyle === style,
            onSelect: () => onChangeGroupStyle(style),
          }),
        ),
      });
    }
    if (isText) {
      items.push({
        kind: "submenu",
        label: "Text size",
        hint: labelForFontSize(currentSize),
        items: sizeItems,
      });
    }
    if (fillable) {
      items.push(
        {
          kind: "submenu",
          label: "Fill color",
          hint: labelForColor(currentFill),
          items: buildColorItems(currentFill, onSetFillColor),
        },
        {
          kind: "submenu",
          label: "Opacity",
          hint: labelForOpacity(currentOpacity),
          items: opacityItems,
        },
      );
    }
    items.push({ kind: "separator" });
  }

  items.push({ kind: "action", label: "Delete", onSelect: onDelete, danger: true });

  return (
    <ContextMenuSurface
      anchor={state}
      label="Node actions"
      items={items}
      onClose={onClose}
    />
  );
}
