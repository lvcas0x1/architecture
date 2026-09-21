#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.collector.bundle import normalize_records
from app.models import Diagram
from app.models.project import Project, ResourceGraph
from app.project import ai_context, assess, new_project, regenerate
from app.project_file import project_file
from app.store import _write_atomic


def _run():
    parser = argparse.ArgumentParser(
        description="Collect, normalize, generate and verify architecture files."
    )
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("profiles")
    collect = sub.add_parser("collect")
    collect.add_argument(
        "--profile", action="append", help="Repeat; defaults to all local profiles"
    )
    collect.add_argument("--region", action="append", help="Repeat; defaults to enabled regions")
    collect.add_argument("--out", type=Path, required=True)
    collect.add_argument("--raw-out", type=Path)
    normalize = sub.add_parser("normalize")
    normalize.add_argument("input", type=Path)
    normalize.add_argument("--out", type=Path, required=True)
    generate = sub.add_parser("generate")
    generate.add_argument("input", type=Path)
    generate.add_argument("--out", type=Path, required=True)
    generate.add_argument(
        "--view", choices=["overview", "network", "application", "security"], default="overview"
    )
    generate.add_argument("--arn", action="append")
    generate.add_argument("--tag", action="append", help="Select resources by KEY=VALUE")
    generate.add_argument(
        "--chunk-size", type=int, help="Write bounded views with related boundary resources"
    )
    update = sub.add_parser("regenerate")
    update.add_argument("project", type=Path)
    update.add_argument("--inventory", type=Path)
    update.add_argument("--proposal", type=Path)
    for command in ("validate", "context", "inspect"):
        command_parser = sub.add_parser(command)
        command_parser.add_argument("project", type=Path)
        if command == "inspect":
            command_parser.add_argument("--arn", required=True)
        if command == "context":
            command_parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    if args.command == "profiles":
        import boto3

        print(json.dumps(boto3.Session().available_profiles))
        return 0
    if args.command == "collect":
        from app.collector.standalone import collect

        graph, raw = collect(args.profile, args.region)
        _write_atomic(args.out, graph.model_dump_json(indent=2) + "\n")
        if args.raw_out:
            _write_atomic(args.raw_out, json.dumps(raw, indent=2, default=str) + "\n")
        print(
            json.dumps(
                {
                    "resources": len(graph.resources),
                    "coverage": [c.model_dump(mode="json") for c in graph.coverage],
                }
            )
        )
        return 0 if graph.resources else 2
    if args.command == "normalize":
        graph = normalize_records(json.loads(args.input.read_text()))
        _write_atomic(args.out, graph.model_dump_json(indent=2) + "\n")
        return 0
    if args.command == "generate":
        graph = ResourceGraph.model_validate_json(args.input.read_text())
        if args.tag:
            tags = dict(tag.split("=", 1) for tag in args.tag)
            args.arn = [
                r.arn
                for r in graph.resources
                if all(r.tags.get(k) == v for k, v in tags.items())
                and (args.arn is None or r.arn in args.arn)
            ]
            if not args.arn:
                raise ValueError("No resources match the selection")
        if args.chunk_size is not None:
            if args.chunk_size < 1:
                parser.error("--chunk-size must be positive")
            arns = args.arn or [r.arn for r in graph.resources]
            for offset in range(0, len(arns), args.chunk_size):
                project = new_project(graph, args.view, arns[offset : offset + args.chunk_size])
                path = args.out.with_name(f"{args.out.stem}-{offset // args.chunk_size + 1}.json")
                _write_atomic(path, project.model_dump_json(indent=2) + "\n")
        else:
            project = new_project(graph, args.view, args.arn)
            _write_atomic(args.out, project.model_dump_json(indent=2) + "\n")
        return 0
    if args.command == "regenerate":
        graph = (
            ResourceGraph.model_validate_json(args.inventory.read_text())
            if args.inventory
            else None
        )
        proposal = Diagram.model_validate_json(args.proposal.read_text()) if args.proposal else None
        with project_file(args.project) as (project, save):
            project = regenerate(project, graph, proposal)
            report = assess(project)
            if report.ok:
                save(project)
            print(report.model_dump_json(indent=2))
            return 0 if report.ok else 1
    project = Project.model_validate_json(args.project.read_text())
    if args.command == "inspect":
        resource = next((r for r in project.graph.resources if r.arn == args.arn), None)
        if resource is None:
            raise ValueError("ARN is outside the project inventory")
        print(resource.model_dump_json(indent=2))
        return 0
    if args.command == "context":
        context = json.dumps(ai_context(project))
        if args.out:
            _write_atomic(args.out, context + "\n")
        else:
            print(context)
        return 0
    report = assess(project)
    print(report.model_dump_json(indent=2))
    return 0 if report.ok else 1


def main():
    from pydantic import ValidationError

    try:
        return _run()
    except ValidationError as exc:
        print(
            json.dumps(
                {
                    "ok": False,
                    "findings": [
                        {
                            "code": "SCHEMA_ERROR",
                            "severity": "error",
                            "path": list(e["loc"]),
                            "message": e["msg"],
                        }
                        for e in exc.errors()
                    ],
                }
            )
        )
        return 1
    except (ValueError, OSError) as exc:
        print(
            json.dumps(
                {
                    "ok": False,
                    "findings": [
                        {"code": "INVALID_INPUT", "severity": "error", "message": str(exc)}
                    ],
                }
            )
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
