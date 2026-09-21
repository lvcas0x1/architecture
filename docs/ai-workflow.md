# AI workflow

1. [Collect and import an inventory](collection.md).
2. Generate a project or select a view in the editor.
3. Give the AI the project context.
4. Apply its diagram proposal through regeneration and check the report.
5. Make human corrections and save the project.

```bash
npm run architecture -- generate inventory.json --out production.architecture.json
npm run architecture -- context production.architecture.json --out context.json
npm run architecture -- regenerate production.architecture.json --proposal draft.arch.json
npm run architecture -- validate production.architecture.json
```

The AI returns diagram JSON. `regenerate` merges the proposal, preserves human corrections, and rejects validation errors before replacing the same project file. It returns structured findings and a nonzero exit status on failure. Feed findings back to the AI and repeat until `ok` is true.
The calling AI drives the loop; the tool requires no model provider or API key.

Without `--proposal`, regeneration builds structure from inventory facts:

```bash
npm run architecture -- regenerate production.architecture.json --inventory inventory.json
```

## Views and detail

Use `--view overview|network|application|security`, repeated `--arn`, or repeated `--tag KEY=VALUE` when generating.
`--chunk-size 100` writes separate files with up to 100 seed resources each. Required ancestors and adjacent dependencies are added, so the total node count can be larger.
Context includes visible resources and their relationships. Retrieve full parameters separately:

```bash
npm run architecture -- inspect production.architecture.json --arn 'arn:aws:...'
```

Membership is separate from display nesting. Multi-subnet resources are not placed arbitrarily in one subnet.
Public/private subnet classification requires route-table evidence; unknown subnets use a generic container.
Relations distinguish containment, association, permission, traffic, and inference. Config associations do not prove traffic.

## Human authority

Save writes an `architecture-project` file containing the diagram, inventory, evidence, and human overrides.
Open accepts both project files and legacy `*.arch.json` diagrams.
Changed fields and added elements are protected. Deleted resources and connections stay deleted across regeneration, including proposals with renamed IDs.
Human edits can replace earlier human edits or explicitly restore a deleted element. AI proposals cannot reset protection through the merge operation.

Browsers with File System Access support overwrite the opened file after granting write permission. Other browsers download a project file; replace the prior file manually. An externally changed file must be reopened before saving.
Protection is enforced by the CLI/API merge workflow. An AI with unrestricted filesystem access can bypass it by rewriting files directly; give such agents proposal output access and invoke regeneration separately.

## Validation and API

Checks cover structural validity, actual placement, resource coverage, evidence-backed connections, stale observations, incomplete collection, and overlapping sibling bounds.
Reports include coverage ratio, unverified edge count, overlap count, and protected-field count. Bounds checks do not measure rendered text or prove network reachability.
Regression tests exercise generation, source normalization, API failures, deletion preservation, and repeated regeneration.

The same operations are available as `POST /api/projects/import`, `/open`, `/context`, `/validate`, `/human`, and `/regenerate`. See `/docs` for request schemas. These endpoints do not call AWS.
In the editor, use **Check facts**, **Apply AI proposal**, **Regenerate**, and **Update inventory**.

Legacy `npm run prompt` and `npm run validate` commands remain available for plain diagrams. Use `npm run architecture` for protected projects.
