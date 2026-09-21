# Schema reference

Pydantic models in `backend/app/models/` define the schema. Run `npm run gen` to regenerate JSON Schemas, TypeScript types, input defaults, and shared rules.

## Files

| File | Contents |
| --- | --- |
| `*.architecture.json` | Diagram, resource graph, evidence, collection coverage, human overrides |
| Collected `inventory.json` | Portable resource graph imported independently of the workspace |
| `workspace/diagrams/*.arch.json` | Layout, topology, resource ARN references |
| `workspace/inventory/resources/*.json` | Normalized resource details |
| `workspace/inventory/index.json` | Searchable resource index |
| `workspace/icon-scopes.json` | User-defined icon placement scopes |

Browser inputs use camelCase. Input schemas allow omitted fields with defaults; serialization schemas describe complete output.
Pydantic validators and editor checks enforce constraints that JSON Schema alone does not express.

Project files use `format: "architecture-project"`, `version: 1`; collected graphs use `format: "architecture-inventory"`.
Project `authority` stores protected field paths and deletion records. AI regeneration receives a diagram proposal and merges it against this authority.
`graph.resources` stores actual membership separately from each node's display `parentId`; `graph.relations` stores categories and evidence.
See [AI workflow](ai-workflow.md) for merge and validation commands.

## Nodes

| Type | Purpose | Allowed children | Edge endpoint |
| --- | --- | --- | --- |
| `resource` | AWS resource icon | None | Yes |
| `group` | Container | All node types | Yes |
| `shape` | Decorative container | Resources, text, shapes | Yes |
| `text` | Text label | None | No |

Nodes use parent-relative positions. Parent cycles are invalid.
Resources require a group or shape parent; groups cannot be children of shapes.

### Group hierarchy

| Style | Allowed parents | Allowed at root |
| --- | --- | --- |
| `global`, `on-premises` | None | Yes |
| `account` | global | No |
| `region` | global, account | No |
| `vpc` | region | No |
| `az` | vpc, region | No |
| `subnet-public`, `subnet-private` | az, vpc | No |
| `security-group`, `auto-scaling-group` | subnet, az, vpc | No |
| `generic` | Any group | Yes |

VPC and AZ siblings may overlap as crossing bands. Other constrained group siblings require a gap.
Dragging a group prefers a valid existing parent over adopting a crossing band or generic container.

### Spacing

Editor placement and resizing enforce a 30 px parent inset and 20 px sibling-group gap.
These geometric checks do not validate coordinates in imported files.

| Exemption | Rules skipped |
| --- | --- |
| Text | Insets, sibling gaps, resize limits |
| Generic groups | Insets, sibling gaps, resize limits; a generic parent also exempts its children |
| Border-mounted resources | Parent inset |
| VPC/AZ sibling pair | Sibling gap |

### Icon scopes

Scopes apply across diagrams and default to `any`. Palette edits use `PUT /api/icon-scopes`.
An omitted key means no restriction. Existing invalid placements are reported without moving nodes.

| Scope | Allowed containers |
| --- | --- |
| `global` | global, account |
| `region` | region, vpc, az, subnet, security group, Auto Scaling group |
| `vpc` | vpc, az, subnet, security group, Auto Scaling group |
| `zone` | az, subnet, security group, Auto Scaling group |
| `subnet` | subnet, security group, Auto Scaling group |
| `any` | Any container |

Shapes and generic groups accept every scope.
The maps in `backend/app/models/diagram.py` are exported to `packages/schema/generated/rules.json`.

### Border placement

```json
{
  "id": "n-igw",
  "type": "resource",
  "parentId": "g-vpc",
  "data": {
    "iconKey": "Resource/Networking-Content-Delivery/Amazon-VPC-Internet-Gateway",
    "mount": "border",
    "borderSide": "top"
  }
}
```

Drops within 18 px of a container border snap to the icon center.
Allowed sides are `top`, `right`, `bottom`, and `left`.
Snapping uses the bounding rectangle, including for ellipses and diamonds.

## Edges

Endpoints must reference resources, groups, or shapes. Free-floating lines are unsupported.
Legacy `anchor` nodes and their edges are removed on import with a notice.

```json
{
  "id": "e-1",
  "source": "n-alb",
  "target": "n-ec2",
  "data": {
    "line": "solid",
    "arrow": "end",
    "router": "smoothstep",
    "label": "HTTP/80",
    "relationType": "targets",
    "origin": "user"
  }
}
```

| Field | Values |
| --- | --- |
| `line` | solid, dashed, dotted |
| `arrow` | none, start, end, both |
| `router` | straight, smoothstep, step, bezier |
| `origin` | ai, user |

## Layout and viewport

- `layout.mode: "auto"` allows omitted positions and runs ELK on load.
- Successful layout switches the mode to `manual` and creates one undo entry.
- Text, shapes, hidden nodes, locked nodes, border-mounted icons, and descendants of excluded nodes are not independently arranged.
- Containers with visible fixed children retain dimensions and all child-relative positions; the container may move as a whole.
- Border icons are re-snapped after container resizing.
- ELK runs in a lazily loaded, locally served Web Worker.
- Zoom ranges from 0.1 to 2.0, with 1.0 at the slider midpoint.
- The viewer preserves the saved viewport unless no visible node intersects it.

## Resource details

Profiles in `backend/app/aws/profiles/` normalize AWS responses.
The UI renders `sections` in order. Register a new profile with `@register` and add its icon mapping to `config/icon-overrides.json`.

Row kinds: `text`, `code`, `badge`, `link`, `list`.
A `row.ref` ARN links to the corresponding node when present, including rows with array values.

| Lifecycle | Meaning |
| --- | --- |
| `active` | Fetch succeeded |
| `deleted` | AWS returned a NotFound error; the diagram retains the node |
| `error` | Fetch failed, including permissions, throttling, or malformed identifiers |
| `unknown` | Details not fetched |

Subnet details show public IPv4 auto-assignment, not route-based public/private classification.
Raw Describe data is opt-in through `defaults.keep_raw_describe`.

Resource and inventory writes share a file lock. Concurrent writes are serialized; crash-atomic updates across both files are not guaranteed.
Resource Explorer warns on incomplete results; automatic query splitting is unsupported.

## Validation

Editor checks run on load, auto layout, scope changes, resource placement, reparenting, Save, and Export.
Errors require confirmation before Save or Export. Warnings identify unlinked or disconnected resources, duplicate references, and empty groups.
Selecting a finding focuses its node.

`PUT /api/diagrams/{id}` applies Pydantic validation but does not run inventory or catalog checks.
The editor uses local files for Open and Save.

```bash
npm run validate -- workspace/diagrams/draft.arch.json
```

The CLI adds inventory ARN checks. Empty inventories skip those checks; missing catalogs skip icon-key checks.
Use `--strict` to fail on warnings.

## Export

HTML exports embed the viewer, referenced resources, and icons without a CDN.
Local resource details override stored details. Raw responses are excluded unless selected.
Account masking covers embedded data and reference keys; the title and download filename remain unchanged.

## Fields without editor controls

| Field | Behavior |
| --- | --- |
| `group.data.iconKey`, `collapsed`, `resourceRef` | Preserved; not rendered or linkable |
| `resource.size` | Fixed icon dimensions; saved as null |
| `resource.labelOverride`, `showFields`, `maxTags` | Rendered |
| `shape.shape`, `stroke` | Rendered; new shapes are rounded rectangles |
| `text.bold`, `italic`, `align` | Rendered |
| `text.fontSize` | Schema: 6–96; menu: 7–14 |
| Edge `label`, `color`, `width`, `relationType` | Rendered; existing edges have no restyling control |
| `locked`, `hidden`, `zIndex` | Applied on load |
| `meta.accountIds`, `regions` | Preserved; no filtering |
| Layout `algorithm`, `nodeSpacing`, `layerSpacing`, `padding` | Applied; only direction has a UI control |
| Bulk refresh, diagram list/save APIs | Available through API only |

See [AI workflow](ai-workflow.md) for prompt generation.
