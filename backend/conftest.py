"""Pytest configuration.

Puts the backend root on `sys.path` so `app` imports as a package, and points
pytest at the test directory. Without this, running `pytest` from `backend/`
works only because of pytest's implicit rootdir insertion, which is easy to break
by adding an `__init__.py` somewhere.
"""

from __future__ import annotations

import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))
