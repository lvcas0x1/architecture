# Collection and import

Collection runs independently of the editor and API. It never writes to AWS.
Requires Python, uv, and authenticated local AWS profiles. Run SSO login before collection when needed.

```bash
npm run architecture -- profiles
npm run architecture -- collect --out inventory.json
```

The collector detects all local profiles, resolves their accounts, and scans enabled Regions.
Use repeated options to restrict profiles and API endpoint Regions:

```bash
npm run architecture -- collect --profile organization --profile production \
  --region ap-northeast-1 --out inventory.json --raw-out observations.json
```

- Resource Explorer: discovers views and paginates `ListResources` with a page size of 100.
- Config: discovers aggregators and queries configuration, relationships, tags, AZs, and capture times.
- Describe: discovers EC2/network resources, load balancers, RDS instances, Lambda functions, and S3 buckets; enriches supported types with the existing adapters.

Aggregator and organization views can return accounts and Regions beyond the selected API endpoints.
Describe uses profiles belonging to each resource's account. Configure local AssumeRole profiles for member accounts; the management account alone does not grant Describe access to them.
Expired profiles and denied APIs are reported without discarding successful results.

Coverage records operation completion, errors, and unsupported adapters. It does not prove that AWS exposed every resource. Config must record the desired types; Resource Explorer views may filter results.
Unknown resource types remain with a generic icon. Relationships without a resolvable ARN produce coverage findings.

Raw observations can be normalized separately:

```bash
npm run architecture -- normalize observations.json --out inventory.json
```

Choose **Import** and select `inventory.json`. The editor generates structure and loads resource details locally without calling AWS.
Choose **Update inventory** to refresh a project while retaining human edits.
Resources absent from a later collection are retained and reported; absence is not treated as deletion.

For containers, collect on the machine holding the profiles, then import the file in the browser. Alternatively run `python backend/scripts/architecture.py` inside a container with [profiles mounted](containers.md).

Inventory and project files contain account identifiers and resource parameters. Raw observations also contain the collected API fields.

References: [Resource Explorer listing](https://docs.aws.amazon.com/resource-explorer/latest/apireference/API_ListResources.html), [Config queries](https://docs.aws.amazon.com/config/latest/developerguide/querying-AWS-resources.html).
