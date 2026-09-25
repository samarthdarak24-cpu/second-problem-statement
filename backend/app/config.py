"""Service configuration.

Everything the service needs is read from the environment so that the same image
runs against a local SQLite file in a test and against PostgreSQL in a
deployment, with no code change.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = BACKEND_ROOT / "data"


class Settings(BaseSettings):
    """Runtime settings, overridable by environment variables."""

    model_config = SettingsConfigDict(
        env_file=".env",
        extra="ignore",
        # `model_dir` is the natural name for where model artefacts live, but
        # pydantic reserves the `model_` prefix for its own namespace. Opting out
        # of the protection is the right trade here: renaming the setting to
        # satisfy a warning would make it *less* clear.
        protected_namespaces=(),
    )

    # --- Service ---
    app_name: str = "SIH Thermal Shelter API"
    version: str = "1.0.0"
    debug: bool = False

    # --- Persistence ---
    #
    # Defaults to SQLite so the service runs with no infrastructure at all. Point
    # DATABASE_URL at PostgreSQL to get the deployment topology the architecture
    # diagram claims; the repository layer is identical either way.
    database_url: str = f"sqlite:///{(BACKEND_ROOT / 'thermal_shelter.db').as_posix()}"
    sql_echo: bool = False

    # --- CORS ---
    #
    # The dashboard runs on a different origin in development, so the browser
    # needs an explicit allow. A comma-separated list keeps this configurable
    # without a code change.
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"

    # --- Climate provider ---
    open_meteo_base: str = "https://archive-api.open-meteo.com/v1/archive"
    open_meteo_timeout_s: float = 20.0
    # The live archive is an upgrade over the offline catalogue, not a
    # prerequisite — the frontend applies the same logic with a shorter budget.
    live_probe_timeout_s: float = 4.0
    enable_live_climate: bool = True

    # --- ML surrogate ---
    model_dir: str = str(BACKEND_ROOT / "models")
    # The accuracy gate a surrogate must clear before it may serve predictions is
    # *not* configured here. It is part of the model contract and lives beside
    # `FEATURE_NAMES` in `ml.py`, mirroring `ml/surrogate.ts` — a deployer must
    # not be able to relax it into usefulness by setting an environment variable.
    # Only the minimum dataset size is tunable.
    min_train_rows: int = 200

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
