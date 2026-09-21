import { nanoid } from "nanoid";

/** An id unique within the diagram. The prefix says what kind of node it is. */
export const newId = (prefix: string): string => `${prefix}-${nanoid(8)}`;

export const ID_PREFIX = {
  resource: "n",
  group: "g",
  text: "t",
  shape: "s",
  edge: "e",
} as const;
