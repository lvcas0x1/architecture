"""Per-service normalization profiles."""

import importlib
import pkgutil

from .base import (
    BotoClient,
    Profile,
    ResourceContext,
    ResourceNotFoundError,
    all_profiles,
    profile_for_arn_key,
    profile_for_type,
    register,
    supported_resource_types,
)


def _load_profiles() -> None:
    """Import every module in the package so ``@register`` runs, rather than relying
    on someone remembering to add an import.
    """
    for module in pkgutil.iter_modules(__path__):
        if module.name == "base" or module.name.startswith("_"):
            continue
        importlib.import_module(f"{__name__}.{module.name}")


_load_profiles()


__all__ = [
    "BotoClient",
    "Profile",
    "ResourceContext",
    "ResourceNotFoundError",
    "all_profiles",
    "profile_for_arn_key",
    "profile_for_type",
    "register",
    "supported_resource_types",
]
