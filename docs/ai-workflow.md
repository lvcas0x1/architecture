# AI workflow

1. Collect an inventory or run `npm run sample`.
2. Generate a prompt.
3. Save the AI response as `*.arch.json`.
4. Validate it, open it in the editor, and review the results.
5. Save the diagram or export HTML.

```bash
npm run prompt -- --service EC2 --service RDS --region ap-northeast-1 --limit 200 --out workspace/ai-prompt.md
npm run validate -- workspace/diagrams/draft.arch.json
```

## Input

The prompt includes the diagram input schema, available icon keys, and matching resources.
Resource relations are included only when detail JSON has been fetched.

## Output

- Use camelCase fields and listed icon keys.
- Reference only supplied resource ARNs.
- Put resources inside groups or shapes.
- Define hierarchy with `parentId` and connections with `edges`.
- Set `layout.mode` to `"auto"` and omit node positions.
- Mark generated nodes and edges with `origin: "ai"`.
- Give text and shapes explicit positions; auto layout excludes them.

Relations describe resource associations, not verified traffic paths. Review inferred connections manually.
The `origin` field records authorship; selective regeneration and merging are not implemented.

## Validation and layout

The CLI checks schema, hierarchy, references, icon keys, and unlinked resources.
An empty inventory skips ARN existence checks. Use `--strict` to fail on warnings.

Opening an auto-layout diagram runs ELK. **Auto layout** reruns it in the selected direction as one undoable operation.
Containers with fixed children retain their size and internal positions.

See [schema reference](schema.md) for placement rules and validation limits.
