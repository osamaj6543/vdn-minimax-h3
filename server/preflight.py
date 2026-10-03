"""GPU preflight: verify the environment BEFORE loading 66 GB of weights.

Every check returns (name, ok, detail); nothing raises. Run standalone:

    python -m server.preflight

Checks, in order of cheapness:
  torch      present + the version the repo pins (2.13.x)
  cuda       torch.cuda.is_available, device name and capability
  diffusers  importable AND the MiniMax-H3 classes present (= the patched
             tree from scripts/setup_diffusers.sh is the one on sys.path)
  fla4       flash_attn.cute importable (FA4; only WARNs on Ampere-class)
  weights    the configured checkpoint / base source exist on disk
"""
import importlib.util
import json
import os
import sys


def check(name, ok, detail):
    return {"check": name, "ok": bool(ok), "detail": detail}


def _torch():
    try:
        import torch
        return torch, None
    except Exception as exc:                    # ImportError or CUDA dll errors
        return None, str(exc)


def _class_exists(module_name: str, class_name: str) -> bool:
    try:
        module = importlib.import_module(module_name)
        return hasattr(module, class_name)
    except Exception:
        return False


def run_preflight(checkpoint=None, base_source=None) -> list:
    results = []

    torch, err = _torch()
    if torch is None:
        results.append(check("torch", False, f"import failed: {err}"))
        return results
    results.append(check("torch", True, torch.__version__))
    pinned = os.environ.get("VDN_EXPECT_TORCH", "2.13")
    results.append(check("torch-pin",
                         torch.__version__.startswith(pinned),
                         f"expected {pinned}.x, got {torch.__version__}"))

    if not torch.cuda.is_available():
        results.append(check("cuda", False, "torch.cuda.is_available() is False"))
        return results
    name = torch.cuda.get_device_name(0)
    major, minor = torch.cuda.get_device_capability(0)
    results.append(check("cuda", True, f"{name} sm{major}{minor}"))
    results.append(check("cuda-fp8", major >= 9,
                         "fp8 needs capability >= 9.0" if major < 9
                         else f"sm{major}{minor} supports fp8"))

    # Which window-softmax kernel path this card gets. The repo gates FA4 by
    # MEMBERSHIP, never `>=` (src/models/softmax_attention/window.py), so a
    # newer capability number can still be a non-FA4 card. Informational only:
    # non-FA4 cards are a documented, supported fallback path, not a failure.
    try:
        from src.models.softmax_attention.window import FA4_MAJORS
        if major in FA4_MAJORS:
            arch_detail = (f"sm{major}{minor} is an FA4 card "
                           f"(FA4 CuTe / flash kernels)")
        else:
            arch_detail = (f"sm{major}{minor} is NOT an FA4 card (FA4 covers "
                           f"sm{FA4_MAJORS}); window softmax uses the "
                           f"Triton/torch fallback - supported, but not the "
                           f"tuned path, so timings differ from the README")
    except Exception as exc:                 # never fail preflight on this
        arch_detail = f"could not read FA4_MAJORS from src ({exc})"
    results.append(check("fa4-arch", True, arch_detail))

    diffusers_ok = _class_exists("diffusers", "MiniMaxH3Transformer3DModel") \
        and _class_exists("diffusers", "AutoencoderKLMiniMaxH3") \
        and _class_exists("diffusers", "MiniMaxH3Scheduler")
    results.append(check("diffusers-h3", diffusers_ok,
                         "MiniMax-H3 classes found (patched tree)"
                         if diffusers_ok else
                         "MiniMax-H3 classes MISSING - is the patched diffusers "
                         "from scripts/setup_diffusers.sh first on sys.path?"))

    fla4 = importlib.util.find_spec("flash_attn") is not None or \
        importlib.util.find_spec("flash_attn.cute") is not None
    results.append(check("flash-attn-4", fla4,
                         "importable" if fla4 else
                         "missing; window softmax falls to torch's kernels on "
                         "sm8x/sm120, but sm90/sm100 paths want it"))

    from server.engine import REPO_ROOT
    for label, path in (("checkpoint", checkpoint), ("base_source", base_source)):
        if not path:
            continue
        resolved = os.path.join(str(REPO_ROOT), path) if not os.path.isabs(path) else path
        exists = os.path.isdir(resolved) or os.path.isfile(resolved)
        results.append(check(f"weights:{label}", exists, resolved))

    return results


def format_results(results) -> str:
    lines = []
    for r in results:
        lines.append(f"  [{'PASS' if r['ok'] else 'FAIL'}] {r['check']}: {r['detail']}")
    return "\n".join(lines)


def all_ok(results) -> bool:
    return all(r["ok"] for r in results)


def main() -> None:
    from .settings import Settings

    settings = Settings()
    results = run_preflight(checkpoint=settings.checkpoint,
                            base_source=settings.base_source)
    print(format_results(results))
    sys.exit(0 if all_ok(results) else 1)


if __name__ == "__main__":
    main()
