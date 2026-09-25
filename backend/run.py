"""Development entry point.

`uvicorn app.main:app` works directly. This wrapper exists so that
`python run.py` also works, and so the host, port and reload flag are visible in
one place rather than buried in a shell command in the README.

Run:  cd backend && .venv/Scripts/python run.py
"""

from __future__ import annotations

import os

import uvicorn

if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host=os.environ.get("HOST", "127.0.0.1"),
        port=int(os.environ.get("PORT", "8000")),
        # Reload is off by default: it is useful while editing this service and
        # actively unhelpful during a demo, where a stray file write restarting
        # the server mid-presentation is exactly the kind of thing that ruins one.
        reload=os.environ.get("RELOAD", "0") == "1",
        log_level=os.environ.get("LOG_LEVEL", "info"),
    )
