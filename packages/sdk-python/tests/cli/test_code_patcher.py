"""AST patcher — the riskiest module, so it gets the deepest coverage.

Every patched output is re-parsed to guarantee we never emit broken Python.
"""

import ast
from pathlib import Path

from spanlens.cli.code_patcher import _patch_source, apply_patches, plan_patches


def _patch(src: str, provider: str) -> str:
    new_src, changes = _patch_source(src, provider)
    assert new_src is not None, "expected a patch"
    assert changes, "expected human-readable changes"
    ast.parse(new_src)  # must stay valid Python
    return new_src


def test_openai_single_import_clean_swap() -> None:
    src = (
        "import os\n"
        "from openai import OpenAI\n"
        'client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])\n'
    )
    out = _patch(src, "openai")
    assert "from spanlens.integrations.openai import create_openai" in out
    assert "from openai import OpenAI" not in out  # only-name import replaced
    assert "client = create_openai()" in out
    assert "api_key" not in out


def test_openai_preserves_other_kwargs() -> None:
    src = (
        "from openai import OpenAI\n"
        'client = OpenAI(api_key="k", base_url="x", timeout=30, max_retries=2)\n'
    )
    out = _patch(src, "openai")
    assert "timeout=30" in out
    assert "max_retries=2" in out
    assert "base_url" not in out
    assert "api_key" not in out


def test_async_openai() -> None:
    src = "from openai import AsyncOpenAI\nc = AsyncOpenAI()\n"
    out = _patch(src, "openai")
    assert "from spanlens.integrations.openai import create_async_openai" in out
    assert "c = create_async_openai()" in out


def test_openai_module_import_style() -> None:
    src = "import openai\nc = openai.OpenAI(api_key='k')\n"
    out = _patch(src, "openai")
    # module import is kept (it may be used elsewhere); spanlens import added.
    assert "import openai" in out
    assert "from spanlens.integrations.openai import create_openai" in out
    assert "c = create_openai()" in out


def test_aliased_named_import() -> None:
    src = "from openai import OpenAI as Client\nc = Client(api_key='k')\n"
    out = _patch(src, "openai")
    assert "c = create_openai()" in out


def test_multi_name_import_keeps_original_and_adds() -> None:
    src = (
        "from openai import OpenAI, OpenAIError\n"
        "c = OpenAI()\n"
        "err = OpenAIError\n"
    )
    out = _patch(src, "openai")
    # OpenAIError still needed → original import stays, spanlens import appended.
    assert "from openai import OpenAI, OpenAIError" in out
    assert "from spanlens.integrations.openai import create_openai" in out
    assert "c = create_openai()" in out


def test_anthropic_sync_and_async() -> None:
    src = (
        "from anthropic import Anthropic, AsyncAnthropic\n"
        "a = Anthropic(api_key='k')\n"
        "b = AsyncAnthropic()\n"
    )
    out = _patch(src, "anthropic")
    assert "create_anthropic" in out
    assert "create_async_anthropic" in out
    assert "a = create_anthropic()" in out
    assert "b = create_async_anthropic()" in out


def test_gemini_configure_rewrite() -> None:
    src = (
        "import google.generativeai as genai\n"
        'genai.configure(api_key="k")\n'
        'model = genai.GenerativeModel("gemini-1.5-flash")\n'
    )
    out = _patch(src, "gemini")
    assert "from spanlens.integrations.gemini import configure_gemini" in out
    assert "configure_gemini()" in out
    # GenerativeModel usage and the original import are preserved.
    assert "import google.generativeai as genai" in out
    assert "genai.GenerativeModel" in out


def test_no_op_when_provider_unused() -> None:
    src = "import os\nprint(os.getcwd())\n"
    new_src, changes = _patch_source(src, "openai")
    assert new_src is None
    assert changes == []


def test_no_op_on_syntax_error() -> None:
    new_src, _ = _patch_source("def (:\n", "openai")
    assert new_src is None


def test_unicode_before_node_is_safe() -> None:
    # A non-ASCII comment shifts byte offsets vs char offsets — patcher must
    # use byte offsets so the splice lands correctly.
    src = (
        "# 한국어 주석 comment\n"
        "from openai import OpenAI\n"
        "c = OpenAI(api_key='k')  # 키\n"
    )
    out = _patch(src, "openai")
    assert "# 한국어 주석 comment" in out
    assert "c = create_openai()" in out
    assert "# 키" in out


def test_multiple_calls_same_file() -> None:
    src = (
        "from openai import OpenAI\n"
        "a = OpenAI(api_key='1')\n"
        "b = OpenAI(api_key='2', timeout=5)\n"
    )
    out = _patch(src, "openai")
    assert "a = create_openai()" in out
    assert "b = create_openai(timeout=5)" in out


def test_plan_and_apply_end_to_end(tmp_path: Path) -> None:
    f = tmp_path / "agent.py"
    f.write_text("from openai import OpenAI\nc = OpenAI(api_key='k')\n", encoding="utf-8")
    # exclude dirs should be skipped
    (tmp_path / ".venv").mkdir()
    (tmp_path / ".venv" / "junk.py").write_text("from openai import OpenAI\nOpenAI()\n", encoding="utf-8")

    plans = plan_patches(str(tmp_path), ["openai"])
    assert len(plans) == 1
    assert plans[0].filepath == str(f)

    # dry run leaves the file untouched
    apply_patches(plans, dry_run=True)
    assert "OpenAI(api_key='k')" in f.read_text(encoding="utf-8")

    # real apply rewrites it
    results = apply_patches(plans)
    assert results[0].patched is True
    out = f.read_text(encoding="utf-8")
    assert "c = create_openai()" in out
    ast.parse(out)


def test_plan_skips_unsupported_providers(tmp_path: Path) -> None:
    f = tmp_path / "x.py"
    f.write_text("from openai import OpenAI\nOpenAI()\n", encoding="utf-8")
    # mistral/openrouter/azure are not auto-patchable
    assert plan_patches(str(tmp_path), ["mistral", "azure"]) == []
