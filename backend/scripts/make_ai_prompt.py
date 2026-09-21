#!/usr/bin/env python3
"""Build the prompt that makes an AI draw an architecture diagram."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "backend"))

from app.config import get_settings  # noqa: E402
from app.icons import load_icon_catalog  # noqa: E402
from app.models import Diagram, ResourceScope  # noqa: E402
from app.store import Store  # noqa: E402
from app.validation import load_icon_scopes  # noqa: E402

INSTRUCTIONS = """\
You are assembling an AWS architecture diagram.
Read the resource list below and produce the diagram in `*.arch.json` form.

## Rules you must follow

1. **Do not write coordinates (position).** Set `layout.mode` to `"auto"` and omit
   `position` on every node. The tool decides coordinates with ELK.
2. Produce only the hierarchy and the connections.
   - Hierarchy: account -> VPC -> availability zone -> subnet -> resource,
     expressed by nesting `group` nodes through `parentId`.
   - Connections: relationships between resources, as `edges`. Start from each
     resource's `relations` and put that relation's name in `data.relationType`.
     Nothing checks edges against `relations`, so traffic paths are your judgement.
3. A node standing for a resource must set `data.resourceRef` to an `arn` from the list.
   Never invent an ARN that is not in the list.
4. `data.iconKey` must be a key from the "Usable icons" list.
5. Mark the nodes and edges you create with `"origin": "ai"`.
6. **Every AWS resource node must have a `parentId`.**
   A resource can only sit inside a box (`group`) or a shape (`shape`).
7. **Each box style has its own allowed parents.** Stack them as shown below.

   ```
   global (AWS Cloud)
   └ account
     └ region
       └ vpc
         └ az
           └ subnet-public / subnet-private
             └ security-group / auto-scaling-group
   ```

   - Only `global` / `on-premises` / `generic` may sit directly on the canvas.
   - You may skip `az` and put a `subnet` straight inside a `vpc`.
   - When several VPCs span the same AZ, you may put both `vpc` and `az` directly
     inside `region` so they cross (only this pair may overlap).
   - Use `generic` for anything that does not fit.
8. **Put resources in a place that matches their layer.**
   Each icon has an "attribute" that decides where it can go.
   The attribute is noted in the "Usable icons" list below; follow it.
   - `global` (IAM, Route 53, CloudFront) -> inside `global` / `account`
   - `region` (S3, DynamoDB, Lambda) -> anywhere under `region`
   - `vpc` (internet gateways) -> under `vpc`
   - `zone` (EC2, NAT gateways, RDS instances) -> inside `az` / `subnet` /
     `security-group` / `auto-scaling-group`
   - `subnet` -> inside `subnet` / `security-group` / `auto-scaling-group`
   - An icon with no attribute may go anywhere.
9. A line always joins two nodes. Only `resource` / `group` / `shape` nodes can be
   endpoints; a line that connects to nothing cannot exist.
10. Output JSON only, with no prose before or after.

## Skeleton of the output

```json
{
  "schemaVersion": "1.0",
  "meta": { "title": "...", "generator": "ai", "accountIds": ["..."], "regions": ["..."] },
  "layout": { "mode": "auto", "algorithm": "layered", "direction": "RIGHT" },
  "nodes": [
    { "id": "g-global", "type": "group",
      "data": { "label": "AWS Cloud", "style": "global", "origin": "ai" } },
    { "id": "g-account", "type": "group", "parentId": "g-global",
      "data": { "label": "123456789012 (prod)", "style": "account", "origin": "ai" } },
    { "id": "g-region", "type": "group", "parentId": "g-account",
      "data": { "label": "ap-northeast-1", "style": "region", "origin": "ai" } },
    { "id": "g-vpc", "type": "group", "parentId": "g-region",
      "data": { "label": "vpc-prod (10.0.0.0/16)", "style": "vpc",
                "resourceRef": "arn:...:vpc/vpc-01", "origin": "ai" } },
    { "id": "g-subnet", "type": "group", "parentId": "g-vpc",
      "data": { "label": "subnet-a", "style": "subnet-private", "origin": "ai" } },
    { "id": "n-alb", "type": "resource", "parentId": "g-vpc",
      "data": { "iconKey": "Architecture/Networking-Content-Delivery/Elastic-Load-Balancing",
                "resourceRef": "arn:...:loadbalancer/app/alb/1", "origin": "ai" } },
    { "id": "n-ec2", "type": "resource", "parentId": "g-subnet",
      "data": { "iconKey": "Architecture/Compute/Amazon-EC2",
                "resourceRef": "arn:...:instance/i-01", "origin": "ai" } }
  ],
  "edges": [
    { "id": "e-1", "source": "n-alb", "target": "n-ec2",
      "data": { "line": "solid", "arrow": "end", "router": "smoothstep",
                "label": "HTTP/80", "relationType": "targets", "origin": "ai" } }
  ]
}
```

Values allowed for a `group`'s `style`:
global / account / region / vpc / az / subnet-public / subnet-private /
security-group / auto-scaling-group / on-premises / generic
"""


def build_prompt(
    schema: dict, icon_keys: list[str], resources: list[dict], instructions: str
) -> str:
    sections = [
        instructions,
        "## The diagram's JSON Schema",
        "```json",
        json.dumps(schema, ensure_ascii=False, indent=2),
        "```",
        "",
        f"## Usable icons ({len(icon_keys)})",
        "```",
        "\n".join(icon_keys),
        "```",
        "",
        f"## Resources in question ({len(resources)})",
        "```json",
        json.dumps(resources, ensure_ascii=False, indent=2),
        "```",
    ]
    return "\n".join(sections) + "\n"


def load_icon_keys(store: Store | None = None) -> list[str]:
    """Usable icon keys, with the attribute noted where one is set.

    Attributes are user-editable, so this uses the values in effect right now.
    """
    catalog = load_icon_catalog()
    if catalog is None:
        return []
    scopes = load_icon_scopes(store)
    return sorted(
        key
        if (scope := scopes.get(icon.key, ResourceScope.ANY)) is ResourceScope.ANY
        else f"{key}\t[{scope.value}]"
        for icon in catalog.icons
        for key in (icon.key,)
    )


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--out", type=Path, default=None, help="where to write (default: stdout)")
    parser.add_argument(
        "--service", action="append", default=None, help="limit to these services (repeatable)"
    )
    parser.add_argument("--account", default=None, help="limit to one account")
    parser.add_argument("--region", default=None, help="limit to one region")
    parser.add_argument("--limit", type=int, default=300, help="maximum resources to include")
    args = parser.parse_args()

    settings = get_settings()
    store = Store(settings)
    inventory = store.read_inventory()

    entries = inventory.entries
    if args.service:
        wanted = {s.upper() for s in args.service}
        entries = [e for e in entries if e.service.upper() in wanted]
    if args.account:
        entries = [e for e in entries if e.account_id == args.account]
    if args.region:
        entries = [e for e in entries if e.region == args.region]

    if not entries:
        print(
            "No resources. Run `npm run collect` or `npm run sample` first.",
            file=sys.stderr,
        )
        return 1

    truncated = len(entries) > args.limit
    entries = entries[: args.limit]

    # Pass relations too when the detail is already fetched (the AI's basis for edges)
    resources: list[dict] = []
    for entry in entries:
        record: dict = {
            "arn": entry.arn,
            "resourceType": entry.resource_type,
            "service": entry.service,
            "name": entry.name,
            "accountId": entry.account_id,
            "region": entry.region,
            "tags": {t.key: t.value for t in entry.tags},
        }
        detail = store.read_resource(entry.arn)
        if detail and detail.relations:
            record["relations"] = [
                {"type": r.type, "targetArn": r.target_arn} for r in detail.relations
            ]
        resources.append(record)

    prompt = build_prompt(
        # The input schema (fields with defaults may be omitted). The output schema
        # would contradict the "you may omit position" instruction.
        schema=Diagram.model_json_schema(by_alias=True, mode="validation"),
        icon_keys=load_icon_keys(store),
        resources=resources,
        instructions=INSTRUCTIONS,
    )

    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(prompt, encoding="utf-8")
        print(f"Wrote a prompt covering {len(resources)} resources to {args.out}.")
        if truncated:
            print("Note: truncated by --limit. Narrow the selection or raise the limit.")
    else:
        print(prompt)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
