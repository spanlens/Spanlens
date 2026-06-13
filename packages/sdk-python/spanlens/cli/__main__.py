"""Allow ``python -m spanlens.cli`` as an alias for the ``spanlens`` command."""

from __future__ import annotations

import sys

from .main import main

if __name__ == "__main__":
    sys.exit(main())
