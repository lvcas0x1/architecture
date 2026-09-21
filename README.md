# Architecture

Create AWS diagrams from AI-generated JSON or edit them manually. Link resource details and export an interactive, self-contained HTML file.

## Containers

```bash
docker compose up -d --build
# Or: podman compose up -d --build
```

Open http://localhost:8000. Icons are included and workspace data persists in a named volume.
See [container setup](docs/containers.md) for AWS access and server configuration.

## Local development

Requires Node.js 22+, Python 3.12+, and uv.

```bash
npm ci
uv sync --project backend --extra dev
npm run gen
npm run build
npm run sample
```

Run in separate terminals:

```bash
npm run api
npm run dev
```

Open http://localhost:5173 and load `workspace/diagrams/sample.arch.json`.
The API runs at http://127.0.0.1:8000.

## Usage

- Drag icons into boxes or shapes.
- Right-click an icon to configure its resource link or refresh its AWS data.
- Click a linked icon to view parameters.
- Save diagrams as `*.arch.json` or export a single HTML file.
- Use **Auto layout** to arrange resources and groups. Undo restores the previous layout.

## AWS configuration

Copy `config/accounts.example.yaml` to your account configuration. Use SSO or AssumeRole credentials.

```bash
export ARCH_WORKSPACE=~/architecture-workspace
export ARCH_ACCOUNTS=~/architecture-workspace/accounts.yaml
```

Use a policy limited to the required Describe/List/Get calls. An omitted or empty `regions` list allows all regions. Raw Describe responses are stored only when `defaults.keep_raw_describe` is enabled.

```bash
npm run collect -- --source resource-explorer --account 111111111111 --view-arn <view-arn>
npm run collect -- --source config-aggregator --account 111111111111 --aggregator org-aggregator
```

Keep real account data outside this repository.

## AWS icons

Official icons and their catalog are included. No import is needed after cloning.
To update them, download and extract the [AWS icon package](https://aws.amazon.com/architecture/icons/), then run:

```bash
npm run icons -- ~/Downloads/Asset-Package_<release>
npm run validate -- workspace/diagrams/*.arch.json
```

The importer uses light-theme SVGs and prefers sizes 64, 48, 32, then 16. Output goes to `packages/editor/public/icons/` and `icons.json`; invalid or empty catalogs fall back to placeholders.

Diagrams store logical keys such as `Architecture/Compute/Amazon-EC2`. Service renames require updating keys in diagrams, resource profiles, inventory, and `config/icon-overrides.json`. Overrides add search aliases and resource-type mappings.

Right-click a palette icon to set its placement scope. Scopes default to `any` and are stored in `workspace/icon-scopes.json`. Backend failures leave changes local to the session.

Follow the AWS icon usage guidelines. Use `npm run icons:placeholder` to regenerate development placeholders.

## AI workflow

```bash
npm run prompt -- --out workspace/ai-prompt.md
npm run validate -- workspace/diagrams/draft.arch.json
```

Ask the AI for hierarchy and connections with `layout.mode: "auto"`, then open the result in the editor.

See [AI workflow](docs/ai-workflow.md) and [schema reference](docs/schema.md).

## Development

```bash
npm test
npm run typecheck
npm run lint:py
npm run build
```

Run `npm run gen` after changing Pydantic models.

| Directory | Purpose |
| --- | --- |
| `backend/` | FastAPI, AWS collection, resource normalization, schema models |
| `packages/schema/` | Generated types, input validation, shared rules |
| `packages/editor/` | React Flow editor |
| `packages/viewer/` | Offline HTML viewer |
| `scripts/` | Icon import and sample generation |
| `config/` | Account example and icon overrides |
| `workspace/` | Sample diagrams and resource data |
