"""Provider integrations — pre-configured clients pointed at the Spanlens proxy.

Each helper requires its provider SDK as an *optional* dependency. Install
with the matching extra::

    pip install "spanlens[openai]"
    pip install "spanlens[anthropic]"
    pip install "spanlens[gemini]"
    pip install "spanlens[all]"

If the provider SDK is missing, the helper raises ``ImportError`` with the
exact pip command needed.
"""

from .anthropic import (
    DEFAULT_SPANLENS_ANTHROPIC_PROXY,
    create_anthropic,
)
from .anthropic import (
    with_prompt_version as with_anthropic_prompt_version,
)
from .gemini import DEFAULT_SPANLENS_GEMINI_PROXY, create_gemini
from .openai import (
    DEFAULT_SPANLENS_OPENAI_PROXY,
    create_openai,
)
from .openai import (
    with_prompt_version as with_openai_prompt_version,
)

__all__ = [
    "DEFAULT_SPANLENS_ANTHROPIC_PROXY",
    "DEFAULT_SPANLENS_GEMINI_PROXY",
    "DEFAULT_SPANLENS_OPENAI_PROXY",
    "create_anthropic",
    "create_gemini",
    "create_openai",
    "with_anthropic_prompt_version",
    "with_openai_prompt_version",
]
