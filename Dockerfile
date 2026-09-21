FROM docker.io/library/node:24.21.0-bookworm-slim AS frontend
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/editor/package.json packages/editor/package.json
COPY packages/schema/package.json packages/schema/package.json
COPY packages/viewer/package.json packages/viewer/package.json
RUN npm ci --no-audit --no-fund
COPY packages packages
RUN npm run build

FROM ghcr.io/astral-sh/uv:0.12.16 AS uv

FROM docker.io/library/python:3.14.7-slim-bookworm AS dependencies
COPY --from=uv /uv /usr/local/bin/uv
ENV UV_PROJECT_ENVIRONMENT=/opt/venv \
    UV_PYTHON_DOWNLOADS=never \
    UV_LINK_MODE=copy
WORKDIR /app/backend
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --locked --no-dev --no-install-project --no-cache

FROM docker.io/library/python:3.14.7-slim-bookworm AS runtime
ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONPATH=/app/backend \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    ARCH_WORKSPACE=/data/workspace \
    ARCH_ACCOUNTS=/config/accounts.yaml
WORKDIR /app
RUN groupadd --gid 10001 architecture \
    && useradd --uid 10001 --gid 10001 --create-home architecture \
    && mkdir -p /data/workspace /config \
    && chown architecture:architecture /data/workspace
COPY --from=dependencies /opt/venv /opt/venv
COPY backend/app backend/app
COPY backend/scripts backend/scripts
COPY scripts scripts
COPY config/icon-overrides.json config/icon-overrides.json
COPY config/accounts.example.yaml config/accounts.example.yaml
COPY packages/schema/generated packages/schema/generated
COPY --from=frontend /app/packages/editor/dist packages/editor/dist
COPY --from=frontend /app/packages/editor/public packages/editor/public
COPY --from=frontend /app/packages/viewer/dist packages/viewer/dist
USER 10001:10001
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
