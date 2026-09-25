"""Psychrometric and unit helpers.

Only the functions the climate service needs are ported. The thermal model's
psychrometrics are deliberately *not* ported: they belong to the physics engine,
which stays in TypeScript where it is verified, and duplicating them here would
create a second implementation that could silently disagree.

Every formula is the same expression the TypeScript module uses, so a value
computed on either side of the wire is identical to floating-point precision.
"""

from __future__ import annotations

import math

# --------------------------------------------------------------------------- #
# Units and constants                                                         #
# --------------------------------------------------------------------------- #

DAYS_IN_MONTH: tuple[int, ...] = (31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31)

STANDARD_PRESSURE = 101_325.0  # Pa

MONTH_LABELS: tuple[str, ...] = (
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
)


def normalize_deg(degrees: float) -> float:
    return ((degrees % 360) + 360) % 360


def pressure_at_elevation(elevation_m: float) -> float:
    """Barometric pressure, Pa (ISA troposphere approximation)."""
    return STANDARD_PRESSURE * (1 - 2.25577e-5 * elevation_m) ** 5.25588


def deg2rad(degrees: float) -> float:
    return degrees * math.pi / 180


def wet_bulb(temp_c: float, relative_humidity_pct: float) -> float:
    """Stull (2011) wet-bulb approximation. Valid over roughly 5–99 % RH."""
    rh = min(100.0, max(1.0, relative_humidity_pct))
    return (
        temp_c * math.atan(0.151977 * math.sqrt(rh + 8.313659))
        + math.atan(temp_c + rh)
        - math.atan(rh - 1.676331)
        + 0.00391838 * rh**1.5 * math.atan(0.023101 * rh)
        - 4.686035
    )


def mean(values: list[float]) -> float:
    if not values:
        return 0.0
    return sum(values) / len(values)
