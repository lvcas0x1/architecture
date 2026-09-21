"""The CLI must honor its empty-inventory skip message."""

import json
import runpy
from pathlib import Path


def test_empty_inventory_skips_arn_lookup(store, tmp_path, capsys):
    script = Path(__file__).resolve().parents[1] / "scripts" / "validate_diagram.py"
    check = runpy.run_path(str(script))["check"]
    path = tmp_path / "diagram.arch.json"
    path.write_text(
        json.dumps(
            {
                "nodes": [
                    {"id": "box", "type": "group", "position": {"x": 0, "y": 0}, "data": {}},
                    {
                        "id": "resource",
                        "type": "resource",
                        "parentId": "box",
                        "position": {"x": 50, "y": 70},
                        "data": {
                            "iconKey": "Architecture/Compute/Amazon-EC2",
                            "resourceRef": "arn:aws:ec2:ap-northeast-1:123456789012:instance/i-0abc",
                        },
                    },
                ],
            }
        ),
        encoding="utf-8",
    )
    errors, _ = check(path, store, strict=False)
    assert "skipped the ARN existence check" in capsys.readouterr().out
    assert errors == 0
