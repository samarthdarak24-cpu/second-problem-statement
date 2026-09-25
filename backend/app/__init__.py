"""SIH Thermal Shelter backend.

A deliberately narrow service: climate caching, catalogue access, persistence and
surrogate model serving. The thermal physics lives in the verified TypeScript
engine in the frontend — see `main.py` for why that is a design decision rather
than an omission.
"""

__version__ = "1.0.0"
