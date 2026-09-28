"""Staged GPU validation of the REAL engine — the plan doc's standing gate.

Run on a GPU box with weights present:

    python -m server.validate_gpu                 # full: assemble+encode+render
    python -m server.validate_gpu --skip-encoder  # no Qwen3-VL (t2v only, cached prompt)
    python -m server.validate_gpu --frames 39 --steps 2   # quick smoke

Stages, each timed and independently reported:
  1. preflight   environment checks (server.preflight)
  2. assemble    build_inference_model: spec -> base -> transform -> branch ->
                 LoRA -> kernels -> fp8 (the one-way commitment)
  3. encode      prompt through Qwen3-VL (skippable)
  4. warmup      a discarded tiny render (absorbs Triton/compile)
  5. render      num_steps NFEs at num_frames
  6. decode+save decode_and_save through the storage abstraction

Exit 0 only if every stage passed. This is the script a GPU runner executes;
its output goes verbatim into docs/server_plan.md.
"""
import argparse
import json
import time


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--frames", type=int, default=345)
    parser.add_argument("--steps", type=int, default=8)
    parser.add_argument("--prompt", default="a cinematic establishing shot of "
                        "the Cologne Cathedral at golden hour")
    parser.add_argument("--skip-encoder", action="store_true",
                        help="skip Qwen3-VL; requires an existing prompt cache "
                             "(reuses the warmup cache)")
    parser.add_argument("--out", default="server_data/artifacts/validation.mp4")
    args = parser.parse_args()

    from .metrics import REGISTRY
    from .schemas import Task
    from .settings import Settings
    from .storage import make_storage
    from .engine import VdnEngine

    stages = []

    def stage(name, fn):
        print(f"[validate] stage {name}...", flush=True)
        started = time.monotonic()
        try:
            detail = fn()
            stages.append({"stage": name, "ok": True,
                           "seconds": round(time.monotonic() - started, 2),
                           "detail": detail or ""})
            print(f"[validate]   PASS ({stages[-1]['seconds']}s) {detail or ''}",
                  flush=True)
        except Exception as exc:
            stages.append({"stage": name, "ok": False,
                           "seconds": round(time.monotonic() - started, 2),
                           "detail": str(exc)[:1000]})
            print(f"[validate]   FAIL: {exc}", flush=True)

    settings = Settings()
    settings.validate()
    engine = VdnEngine(settings, pool="validation")

    def preflight():
        from .preflight import all_ok, format_results, run_preflight
        results = run_preflight(checkpoint=settings.checkpoint,
                                base_source=settings.base_source)
        print(format_results(results), flush=True)
        if not all_ok(results):
            raise RuntimeError("preflight failed; fix the environment first")
        return "environment ok"

    def assemble():
        engine._ensure_model()
        return "fp8 model resident"

    def encode():
        if args.skip_encoder:
            return "skipped (--skip-encoder)"
        path = engine._prompt_encoder.encode(Task.t2v, args.prompt, [])
        import os
        assert os.path.isfile(path)
        return path

    def warmup():
        engine.warmup()
        return "compile absorbed"

    def render():
        result = engine.render(Task.t2v, args.prompt, [],
                               args.frames, args.steps, 42, 12.0, 3.0, args.out)
        per_nfe = [round(s, 2) for s in result.step_seconds]
        avg = sum(result.step_seconds) / max(len(result.step_seconds), 1)
        REGISTRY.observe("vdn_render_seconds", sum(result.step_seconds))
        return f"{args.steps} NFEs, avg {avg:.2f} s/NFE: {per_nfe}"

    def store():
        storage = make_storage(settings)
        url = storage.save(args.out, "validation.mp4")
        return f"artifact at {url}"

    stage("preflight", preflight)
    stage("assemble", assemble)
    stage("encode", encode)
    stage("warmup", warmup)
    stage("render", render)
    stage("store", store)

    report = {"ok": all(s["ok"] for s in stages), "stages": stages}
    with open(args.out + ".validation.json", "w") as f:
        json.dump(report, f, indent=2)
        f.write("\n")
    print(json.dumps(report, indent=2), flush=True)
    raise SystemExit(0 if report["ok"] else 1)


if __name__ == "__main__":
    main()
