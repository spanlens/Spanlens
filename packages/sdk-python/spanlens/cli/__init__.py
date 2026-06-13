"""Spanlens onboarding CLI.

Installed as the ``spanlens`` console command via ``[project.scripts]``::

    pip install spanlens
    spanlens init

Walks a Python developer through connecting their app to Spanlens:

    1. Detect the project type (poetry / pipenv / uv / pip) and LLM libraries
    2. Validate the pasted Spanlens key against the API and introspect which
       provider keys are registered
    3. Write ``SPANLENS_API_KEY`` into ``.env`` (idempotent, comment-preserving)
    4. Install the ``spanlens`` provider extras into the project
    5. Patch ``OpenAI(...)`` / ``Anthropic(...)`` / ``genai.configure(...)`` to
       route through the Spanlens proxy

The CLI uses only the standard library plus ``httpx`` (already a runtime
dependency of the SDK), so ``pip install spanlens`` makes ``spanlens init``
work out of the box with no extra weight.
"""

from __future__ import annotations

__all__ = ["main"]


def main() -> int:
    """Console-script entry point. Imported lazily so importing the package
    does not pull the whole CLI graph for SDK-only users."""
    from .main import main as _main

    return _main()
