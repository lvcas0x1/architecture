import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import schema from "../generated/input.schema.json";
import type {
  Diagram,
  IconCatalog,
  NormalizedResource,
} from "./generated/models.js";

type Schema = {
  $ref?: string;
  type?: string;
  anyOf?: Schema[];
  oneOf?: Schema[];
  discriminator?: { propertyName: string; mapping: Record<string, string> };
  properties?: Record<string, Schema>;
  items?: Schema;
};
const definitions = schema.$defs as Record<string, Schema>;

// CamelModel strips strings, but arbitrary values in raw must stay untouched.
function stripStrings(value: unknown, definition: Schema): unknown {
  if (definition.$ref)
    return stripStrings(
      value,
      definitions[definition.$ref.split("/").at(-1)!]!,
    );
  if (definition.discriminator && value && typeof value === "object") {
    const { propertyName, mapping } = definition.discriminator;
    const tag = (value as Record<string, unknown>)[propertyName];
    if (typeof tag === "string" && mapping[tag])
      return stripStrings(value, { $ref: mapping[tag] });
  }
  if (definition.anyOf) {
    const branch = definition.anyOf.find(
      (part) =>
        part.type === typeof value ||
        (Array.isArray(value) && part.type === "array") ||
        part.$ref,
    );
    if (branch) return stripStrings(value, branch);
  }
  if (typeof value === "string" && definition.type === "string")
    return value.trim();
  if (Array.isArray(value) && definition.items)
    return value.map((item) => stripStrings(item, definition.items!));
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    definition.properties
  ) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        definition.properties![key]
          ? stripStrings(item, definition.properties![key]!)
          : item,
      ]),
    );
  }
  return value;
}

// Ajv supports defaults in discriminated unions, but not Pydantic's mapping keyword.
const ajvSchema = JSON.parse(
  JSON.stringify(schema, (key, value) =>
    key === "mapping" ? undefined : value,
  ),
);
for (const definition of Object.values(ajvSchema.$defs) as {
  properties?: { type?: { const?: string } };
  required?: string[];
}[]) {
  if (definition.properties?.type?.const) {
    definition.required = [
      ...new Set([...(definition.required ?? []), "type"]),
    ];
  }
}
const ajv = new Ajv2020({
  allErrors: true,
  strict: false,
  useDefaults: true,
  discriminator: true,
});
addFormats(ajv);
const validators = Object.fromEntries(
  ["Diagram", "NormalizedResource", "IconCatalog"].map((name) => [
    name,
    ajv.compile({ $defs: ajvSchema.$defs, $ref: `#/$defs/${name}` }),
  ]),
);

function parse<T>(value: unknown, name: string): T {
  const result = stripStrings(structuredClone(value), definitions[name]!);
  const validate = validators[name]!;
  if (!validate(result)) {
    throw new Error(
      validate.errors
        ?.map(
          (error) =>
            `${error.instancePath || "/"} ${error.message} ${JSON.stringify(error.params)}`,
        )
        .join("; ") ?? "Invalid JSON",
    );
  }
  return result as T;
}

export const parseDiagramInput = (value: unknown): Diagram =>
  parse(value, "Diagram");
export const parseIconCatalogInput = (value: unknown): IconCatalog =>
  parse(value, "IconCatalog");
export function parseResourceInput(value: unknown): NormalizedResource {
  const resource = parse<NormalizedResource>(value, "NormalizedResource");
  const keys = resource.tags.map((tag) => tag.key);
  if (new Set(keys).size !== keys.length) throw new Error("Duplicate tag keys");
  return resource;
}
