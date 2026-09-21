"""FastAPI dependency injection. Tests swap these out."""

from __future__ import annotations

from functools import lru_cache
from typing import Annotated

from fastapi import Depends

from app.aws.session import Boto3ClientFactory, ClientFactory
from app.config import Settings, get_settings
from app.store import Store


@lru_cache(maxsize=1)
def get_store() -> Store:
    return Store(get_settings())


@lru_cache(maxsize=1)
def get_client_factory() -> ClientFactory:
    return Boto3ClientFactory(get_settings())


SettingsDep = Annotated[Settings, Depends(get_settings)]
StoreDep = Annotated[Store, Depends(get_store)]
ClientsDep = Annotated[ClientFactory, Depends(get_client_factory)]
