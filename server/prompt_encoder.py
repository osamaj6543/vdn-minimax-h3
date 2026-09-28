"""In-process prompt encoder (Phase 2's resolution of S-06 / Q-01).

One PromptEncoder per worker. Every encoding is disk-cached by content hash
(server_data/prompt_cache/<sha256>.pt), so a repeat request never touches the
63 GB Qwen3-VL conditioner. The encoder is loaded on demand and unloaded
afterwards; the VAE used for conditioning latents is the model's own (already
resident in the worker), not a second copy.

The image paths come from the repo's encode_keyframes.py building blocks,
IMPORTED, not re-implemented and not shelled out to: put_on_canvas /
normalize_references / build_presentation / qwen3vl_prompt_embeds are the
diffusers-block replicas the paper's numbers depend on. Importing keeps one
source of truth; this module only orchestrates lifecycle around them.
"""
import hashlib
from pathlib import Path
from typing import List

from .schemas import Task

# encode_keyframes.py's building blocks, imported in-process on the worker
_KEYFRAMES_MODULE = "src.inference.encode_keyframes"


def content_hash(task: Task, prompt: str, image_paths: List[str]) -> str:
    h = hashlib.sha256()
    h.update(task.value.encode())
    h.update(b"\0")
    h.update(prompt.encode())
    for path in image_paths:
        with open(path, "rb") as f:
            h.update(hashlib.file_digest(f, "sha256").digest())
    return h.hexdigest()


class PromptEncoder:
    """Lifecycle: cache hit -> return; miss -> ensure conditioner (and for
    image tasks the building blocks) -> encode -> write .pt -> unload."""

    def __init__(self, cache_dir: str, device: str):
        self.cache_dir = Path(cache_dir)
        self.device = device
        self._encoder = None            # (processor, text_encoder) or None
        self._keyframes_mod = None      # src.inference.encode_keyframes, lazy

    def encode(self, task: Task, prompt: str, image_paths: List[str],
               vae=None) -> str:
        """Path to the prompt cache .pt for this conditioning request. `vae`
        is the worker's resident AutoencoderKLMiniMaxH3 (None -> t2v path,
        which needs no VAE)."""
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        out = self.cache_dir / f"{content_hash(task, prompt, image_paths)}.pt"
        if out.is_file():
            return str(out)
        if task is Task.t2v:
            self._encode_t2v(prompt, str(out))
        else:
            self._encode_images(task, prompt, image_paths, str(out), vae)
        return str(out)

    def unload(self) -> None:
        import torch

        self._encoder = None
        self._keyframes_mod = None
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

    def _conditioner(self):
        if self._encoder is None:
            import torch
            from transformers import (Qwen3VLForConditionalGeneration,
                                      Qwen3VLProcessor)

            from src.paths import upstream_snapshot
            print("[encoder] loading Qwen3-VL conditioner", flush=True)
            model_root = upstream_snapshot("processor", "text_encoder")
            processor = Qwen3VLProcessor.from_pretrained(model_root,
                                                         subfolder="processor")
            text_encoder = Qwen3VLForConditionalGeneration.from_pretrained(
                model_root, subfolder="text_encoder", dtype=torch.bfloat16
            ).to(self.device)
            text_encoder.eval().requires_grad_(False)
            self._encoder = (processor, text_encoder)
        return self._encoder

    def _keyframes(self):
        if self._keyframes_mod is None:
            import importlib

            self._keyframes_mod = importlib.import_module(_KEYFRAMES_MODULE)
        return self._keyframes_mod

    def _encode_t2v(self, prompt: str, out: str) -> None:
        import torch

        processor, text_encoder = self._conditioner()
        token_ids = processor.tokenizer(prompt, add_special_tokens=False)["input_ids"]
        input_ids = torch.tensor([token_ids], dtype=torch.long, device=self.device)
        mm = torch.tensor(processor.create_mm_token_type_ids([token_ids]),
                          dtype=torch.long, device=self.device)
        with torch.no_grad():
            outputs = text_encoder.model(
                input_ids=input_ids, attention_mask=torch.ones_like(input_ids),
                mm_token_type_ids=mm, use_cache=False, output_hidden_states=True)
        embeds = outputs.hidden_states[50][0].to(torch.bfloat16).cpu()
        torch.save({
            "prompt": prompt,
            "prompt_embeds": embeds,
            "text_token_tags": torch.full((len(token_ids),), 1, dtype=torch.long),
        }, out)
        self.unload()

    def _encode_images(self, task: Task, prompt: str, image_paths: List[str],
                       out: str, vae) -> None:
        import numpy as np
        import torch
        from PIL import Image

        from src.inference.render import PIXEL_MEAN, PIXEL_STD
        from src.inference.utils.prompt_cache import (REFERENCE_ANCHOR,
                                                      conditioning_mode)
        mod = self._keyframes()
        processor, text_encoder = self._conditioner()

        if task is Task.ref2v:
            pairs = [(REFERENCE_ANCHOR, path) for path in image_paths]
            anchors = [anchor for anchor, _ in pairs]
            keyframes = mod.normalize_references(
                [Image.open(p) for _, p in pairs], mod.REFERENCE_SHORT_EDGE)
            height, width = mod.resolve_canvas_size(
                16, 9, mod.CANVAS_MULTIPLE, mod.CANVAS_SHORT_EDGE,
                mod.CANVAS_MAX_PIXELS)
            extra = {"reference_size": mod.REFERENCE_SHORT_EDGE}
        else:
            anchors = {"i2v": ["first"], "l2v": ["last"],
                       "fl2v": ["first", "last"]}[task.value]
            pairs = list(zip(anchors, image_paths))
            mod.check_instruction(prompt, anchors)
            keyframes, height, width = mod.put_on_canvas(
                [Image.open(p) for _, p in pairs])
            extra = {}

        token_ids, token_tags, vision_inputs = mod.build_presentation(
            processor, prompt, keyframes)
        prompt_embeds = mod.qwen3vl_prompt_embeds(
            text_encoder, processor, token_ids, vision_inputs, self.device)
        self.unload()

        if vae is None:
            # A fresh worker assembles the model before rendering, so by the
            # time an image encode happens the resident VAE exists.
            raise RuntimeError("image-conditioned encoding needs the model's "
                               "VAE; assemble the model before the first image encode")
        with torch.no_grad():
            condition_latents = [
                mod.encode_vae_condition(
                    vae, torch.from_numpy(np.array(k)).to(self.device)
                    .permute(2, 0, 1)[None, :, None],
                    PIXEL_MEAN, PIXEL_STD, mod.KEYFRAME_ENCODE_SEED)
                for k in keyframes]

        torch.save({
            "prompt": prompt,
            "prompt_embeds": prompt_embeds,
            "text_token_tags": torch.tensor(token_tags, dtype=torch.long),
            "keyframe_anchors": anchors,
            "keyframe_files": [p for _, p in pairs],
            "condition_latents": condition_latents,
            "height": height, "width": width,
            **extra,
        }, out)
        _ = conditioning_mode    # re-exported contract; see prompt_cache.py
