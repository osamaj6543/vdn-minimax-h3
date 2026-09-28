"""Render engines.

RenderEngine protocol:
    warmup()                      run once per worker at startup (absorbs the
                                  Triton/torch.compile cost, plan doc 2.3 #4)
    render(task, prompt, image_paths, num_frames, num_steps, seed,
           video_shift, audio_shift, out_path) -> RenderResult

VdnEngine is the real one. It imports torch / src.* LAZILY - only on the GPU
worker process - and follows the repo's documented pipeline exactly:
assemble (fp8, inference kernels, pool-aware softmax backend) -> encode the
prompt through the in-process PromptEncoder (disk-cached by content hash) ->
generate_latents -> decode_and_save, then hands the artifact to the storage
layer. The fp8 conversion is one-way (plan doc 2.3 #3), so an engine is built
once and never de-quantized.
"""
import os
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional, Protocol

from .prompt_encoder import PromptEncoder
from .schemas import Task

REPO_ROOT = Path(__file__).resolve().parent.parent

# The tuned kernel per pool, from plan doc 2.2: B200 wants `decomposed`
# (bandwidth-bound, dense calls win on sm100), H200 wants `flex` (equal speed,
# no gather -> smaller transients). Any other pool resolves `auto`.
POOL_BACKENDS = {"b200": "decomposed", "h200": "flex"}


@dataclass
class RenderResult:
    artifact_path: str
    step_seconds: List[float] = field(default_factory=list)


class RenderEngine(Protocol):
    def warmup(self) -> None: ...
    def render(self, task: Task, prompt: str, image_paths: List[str],
               num_frames: int, num_steps: int, seed: int,
               video_shift: float, audio_shift: float,
               out_path: str) -> RenderResult: ...


def prompt_cache_key(task: Task, prompt: str, image_paths: List[str]) -> str:
    """Content-hash identity of a conditioning request (S-06 cache key)."""
    h = hashlib.sha256()
    h.update(task.value.encode())
    h.update(b"\0")
    h.update(prompt.encode())
    for path in image_paths:
        with open(path, "rb") as f:
            h.update(hashlib.file_digest(f, "sha256").digest())
    return h.hexdigest()


class VdnEngine:
    """The real engine. One instance per GPU worker process."""

    def __init__(self, settings, pool: str = "default"):
        self.settings = settings
        self.pool = pool
        self._transformer = None
        self._vae = None
        self._audio_vae = None
        self._prompt_encoder = PromptEncoder(settings.encode_cache_dir,
                                             settings.device)

    def _ensure_model(self):
        if self._transformer is not None:
            return
        import torch
        from src.config.inference import (Fp8Config, InferenceConfig,
                                          InferenceKernels, PrecisionConfig,
                                          RenderConfig)
        from src.inference.utils.assemble import build_inference_model

        s = self.settings
        backend = POOL_BACKENDS.get(self.pool, "auto")
        cfg = InferenceConfig(
            checkpoint=s.checkpoint,
            base_source=s.base_source,
            render=RenderConfig(device=s.device),
            kernels=InferenceKernels(inference_kernels=True,
                                     softmax_backend=backend),
            precision=PrecisionConfig(fp8=Fp8Config(enabled=s.fp8,
                                                    skip_end_blocks=0)),
        )
        print(f"[engine] assembling checkpoint={s.checkpoint} fp8={s.fp8} "
              f"pool={self.pool} softmax_backend={backend} device={s.device}",
              flush=True)
        model = build_inference_model(cfg, s.device)
        self._cfg = cfg
        self._transformer = model.transformer
        self._vae = model.vae
        self._audio_vae = model.audio_vae
        torch.set_grad_enabled(False)

    def warmup(self) -> None:
        """A tiny real render: absorbs compile + the 2nd-timestep
        re-specialisation the repo's warmup_steps exist for."""
        self._ensure_model()
        out = str(Path(self.settings.encode_cache_dir).parent / "warmup.mp4")
        self.render(Task.t2v, "warmup render, discarded", [], 22, 2, 0,
                    12.0, 3.0, out)
        try:
            os.remove(out)
        except OSError:
            pass

    # ---------------- render ----------------

    def render(self, task: Task, prompt: str, image_paths: List[str],
               num_frames: int, num_steps: int, seed: int,
               video_shift: float, audio_shift: float, out_path: str) -> RenderResult:
        from src.inference.render import decode_and_save, generate_latents
        from src.inference.utils.prompt_cache import load_prompt

        self._ensure_model()
        cache = self._prompt_encoder.encode(task, prompt, image_paths,
                                            vae=self._vae)
        device = self.settings.device
        prompt_embeds, text_token_tags, conditions = load_prompt(cache, device)
        os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
        step_seconds: List[float] = []
        latents, audio_latents = generate_latents(
            self._transformer, prompt_embeds, text_token_tags,
            num_frames, num_steps, seed, device,
            video_shift=video_shift, audio_shift=audio_shift,
            step_seconds=step_seconds, conditions=conditions)
        decode_and_save(latents, audio_latents, self._vae, self._audio_vae,
                        out_path, device)
        return RenderResult(artifact_path=out_path, step_seconds=step_seconds)


class FakeEngine:
    """Tests and GPU-less dev: instant, writes a small file as the artifact."""

    def __init__(self, fail_on_prompt: Optional[str] = None):
        self.calls: List[dict] = []
        self.fail_on_prompt = fail_on_prompt

    def warmup(self) -> None:
        self.calls.append({"kind": "warmup"})

    def render(self, task, prompt, image_paths, num_frames, num_steps, seed,
               video_shift, audio_shift, out_path) -> RenderResult:
        self.calls.append({"kind": "render", "task": task, "prompt": prompt,
                           "num_frames": num_frames, "num_steps": num_steps,
                           "seed": seed, "out_path": out_path})
        if self.fail_on_prompt is not None and prompt == self.fail_on_prompt:
            raise RuntimeError(f"injected failure for {prompt!r}")
        Path(out_path).parent.mkdir(parents=True, exist_ok=True)
        Path(out_path).write_bytes(b"FAKE MP4")
        return RenderResult(artifact_path=out_path, step_seconds=[0.01] * num_steps)
