# Containers

Requires Docker with Compose or Podman with a Compose provider. Both use the same Dockerfile and Compose file.
Node.js and Python are only needed inside the build.

## Start

```bash
docker compose up -d --build
```

Or:

```bash
podman compose up -d --build
```

Open http://localhost:8000. The image includes the editor, API, HTML viewer, and AWS icons.
The workspace starts empty and persists in a named volume.

Copy `.env.example` to `.env` to change the port or bind address.
For remote access, use an authenticated TLS reverse proxy or an SSH tunnel:

```bash
ssh -L 8000:127.0.0.1:8000 user@server
```

The application has no built-in authentication. The default port binding is loopback-only.

## AWS access

Copy `config/accounts.example.yaml` to `config/accounts.yaml` and configure your accounts.
This directory is mounted read-only. Account settings and credentials are not included in the image.

Compose forwards `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and `AWS_SESSION_TOKEN` from the environment.
Instance credentials can also be used when the container can reach the instance metadata service.

For AWS profiles, create `compose.override.yaml`:

```yaml
services:
  architecture:
    volumes:
      - ${AWS_CONFIG_DIR}:/home/architecture/.aws:ro,Z
```

Set `AWS_CONFIG_DIR` to a dedicated AWS configuration directory and set `AWS_PROFILE` in `.env`.
The container runs as UID/GID 10001; mounted files must be readable by that user.
For rootless Podman, add this service option to map your host user to the container user:

```yaml
    userns_mode: "keep-id:uid=10001,gid=10001"
```

Keep that option out of Docker deployments. Run SSO login on the host and renew expired tokens there; the mounted directory is read-only.
On SELinux hosts, use a dedicated configuration copy because `:Z` relabels the mounted directory.

## Data and commands

`/data/workspace` contains inventory, resource details, icon scopes, saved diagrams, and exports.
Browser Open/Save still use local files. `config/` remains on the host.
Back up the workspace volume and account configuration before moving servers.
`compose down` retains the volume; `compose down -v` deletes it.

Run backend tools without installing Python on the host:

```bash
docker compose exec architecture python backend/scripts/collect_inventory.py --help
docker compose exec architecture python backend/scripts/make_ai_prompt.py --out /data/workspace/ai-prompt.md
docker compose exec architecture python backend/scripts/validate_diagram.py /data/workspace/diagrams/draft.arch.json
```

Use `podman compose` for the same commands with Podman.
For demo inventory in an empty workspace:

```bash
docker compose exec architecture python scripts/make_sample_workspace.py
```

Open the repository's `workspace/diagrams/sample.arch.json` in the browser.

## Update and inspect

```bash
git pull
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 architecture
curl --fail http://localhost:8000/api/health
```

Podman requires an external provider such as `podman-compose` or `docker-compose`.
Set `PODMAN_COMPOSE_PROVIDER` to select one. On macOS and Windows, start the Podman machine first.

References: [Compose services](https://docs.docker.com/reference/compose-file/services/), [Podman Compose](https://docs.podman.io/en/latest/markdown/podman-compose.1.html).
