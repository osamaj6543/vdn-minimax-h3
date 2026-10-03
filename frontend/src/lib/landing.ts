/** Landing-page content: every public claim in one place, next to its source.
 *
 *  The landing page is a claim sheet, so the numbers here are quoted rather
 *  than invented, and each one is traceable:
 *
 *  - Reference render figures (6.9 s denoise / 8 steps / ~9.0 s end-to-end for
 *    a 14.4 s clip on 8×B200 GPUs) — root `README.md`, measured with SGLang
 *    Diffusion. `src/lib/estimate.ts` quotes the same constants for the studio
 *    rail, so the marketing figure and the in-app estimate cannot drift.
 *  - Gateway surface — `server/README.md` ("API sketch") and `server/schemas.py`.
 *  - Licence split — code is Apache-2.0 (`LICENSE`); the weights are distributed
 *    separately under the MiniMax H3 Community Licence (`licenses/`).
 *
 *  Keep it that way: no metrics, benchmarks or uptime promises that are not
 *  readable somewhere in this repository.
 */

/** Published, citable links for the release. */
export const LINKS = {
  paper: "https://arxiv.org/abs/2609.20744",
  blog: "https://openvdn.github.io/",
  code: "https://github.com/OpenVDN/vdn-minimax-h3",
  weights: "https://huggingface.co/OpenVDN/vdn-minimax-h3",
  modelscope: "https://www.modelscope.ai/models/OpenVDN/vdn-minimax-h3",
  minimax: "https://huggingface.co/MiniMaxAI/MiniMax-H3",
  turboLora: "https://huggingface.co/larryvrh/MiniMax-H3-Turbo-Lora",
  sglang: "https://github.com/sgl-project/sglang",
} as const;

/** The one measured render this product's copy is allowed to cite. */
export const REFERENCE = {
  /** Seconds of denoising for the distilled 8-step preset. */
  denoiseSeconds: 6.9,
  /** Queue-to-muxed-mp4 time on the 8×B200 SGLang lane. */
  endToEndSeconds: 9.0,
  /** Clip length those numbers describe. */
  clipSeconds: 14.4,
  /** Frames follow the repo's 17n+5 rule; 345 = 14.4 s at 24 fps. */
  frames: 345,
  fps: 24,
  steps: 8,
  /** The ladder the published figures were measured on. */
  hardware: "8×B200",
} as const;

/** The same constants the studio rail uses, kept in one place. */
export const REFERENCE_HINT =
  "Published reference: 8×B200 GPUs, SGLang Diffusion, 8 denoising steps.";

/** Headline figures for the band under the hero. */
export const METRICS: { value: string; label: string; hint: string }[] = [
  { value: "6.9s", label: "Denoise", hint: "8 steps, one clip" },
  { value: "9.0s", label: "End-to-end", hint: "queue → muxed mp4" },
  { value: "14.4s", label: "Clip", hint: "345 frames · 24 fps" },
  { value: "8×", label: "B200 lane", hint: "sequence parallel" },
  { value: "768p", label: "Output", hint: "stereo audio muxed" },
  { value: "5", label: "Modes", hint: "one checkpoint" },
];

/** How a request becomes a file — the same stages the worker times. */
export const PIPELINE: { step: string; title: string; detail: string }[] = [
  {
    step: "01",
    title: "Prompt + conditioning",
    detail:
      "Text, first frame, last frame, both, or up to eight reference pictures. One checkpoint serves all five modes.",
  },
  {
    step: "02",
    title: "Encode once",
    detail:
      "The H3 text encoder writes a prompt cache — embeddings, token tags and the conditioning latents the sampler reads.",
  },
  {
    step: "03",
    title: "8-step denoise",
    detail:
      "The distilled turbo LoRA over the hybrid attention stack. Every NFE is timed and stored on the job.",
  },
  {
    step: "04",
    title: "Decode + mux",
    detail:
      "Video and audio VAEs decode into one atomic mp4 — 768p, 24 fps, stereo audio, served auth-gated.",
  },
];


/** Enterprise capabilities, i.e. the parts that are not the model. */
export const CAPABILITIES: {
  id: "auth" | "queue" | "library" | "telemetry" | "api" | "deploy";
  title: string;
  hint: string;
  detail: string;
}[] = [
  {
    id: "auth",
    title: "Credentials stay server-side",
    hint: "Appwrite-backed tenancy",
    detail:
      "Passwords are exchanged by the Next server with an Appwrite API key. The session lives in an AES-256-GCM sealed, httpOnly cookie, and the gateway JWT is minted per request — the browser never holds a usable credential.",
  },
  {
    id: "queue",
    title: "Priority lanes and quotas",
    hint: "Per-tier rate limits",
    detail:
      "high / standard / low lanes, a per-minute ceiling and a daily quota per tier, pool routing (b200, h200), and load shedding with 503 + Retry-After once a queue passes its depth cap.",
  },
  {
    id: "library",
    title: "Every render, inspectable",
    hint: "Status, seed, timings",
    detail:
      "Jobs carry their state, prompt, seed, priority, pool and per-NFE samples. Artifacts stream through an auth-gated endpoint, so no public object host is needed and the same seed reproduces the render.",
  },
  {
    id: "telemetry",
    title: "Telemetry and webhooks",
    hint: "Prometheus + signed callbacks",
    detail:
      "Per-NFE seconds land on the job, /metrics exposes Prometheus counters, and terminal states fire a best-effort webhook signed with X-VDN-Signature (sha256), so delivery never affects job state.",
  },
  {
    id: "api",
    title: "A small, honest API",
    hint: "Five create endpoints",
    detail:
      "POST /v1/video/{t2v,i2v,l2v,fl2v,ref2v}, plus uploads, jobs and artifacts. An optional Idempotency-Key deduplicates creates; a create returns 202 with the job view.",
  },
  {
    id: "deploy",
    title: "Scales by lane, not by guesswork",
    hint: "One worker per GPU",
    detail:
      "Start on a single node, add a worker per GPU, or put the 8-GPU Ulysses lane / SGLang Diffusion lane behind the same gateway. The engine picks its softmax backend from the pool (b200, h200, default).",
  },
];

/** Frequently asked questions — answers repeat only what the repo states. */
export const FAQ: { question: string; answer: string }[] = [
  {
    question: "What exactly is VDN-H3?",
    answer:
      "A hybrid-attention video model built on MiniMax H3. The released H3 backbone stays the quality and consistency anchor, while a frame-wise linear-attention branch and two small LoRA adapters are merged in at inference. No backbone weight is modified, so the checkpoint stays plug-and-play.",
  },
  {
    question: "Why is it faster than real time?",
    answer:
      "The distilled 8-step turbo adapter removes most of the sampling cost and the linear branch replaces the frame-wise attention that dominates the rest. Together they denoise a 14.4-second clip in about 6.9 seconds — roughly 9.0 seconds end to end — on 8×B200 GPUs. Fourteen seconds of video in nine seconds is faster than it plays.",
  },
  {
    question: "Which conditioning modes are supported?",
    answer:
      "Five, from one checkpoint: text to video, first frame to video, last frame to video, first + last frame, and reference pictures (the Ref2VA-like task, through the FL2VA weights). Reference mode takes up to eight images.",
  },
  {
    question: "Can I run it on my own hardware?",
    answer:
      "Yes. The repository ships the inference stack and the training stages, with attention kernels chosen per GPU — FlashAttention 4 on Hopper and data-center Blackwell, FlexAttention's Triton kernel elsewhere — plus fp8 and 8-step / 50-step presets as configurations. The published timings are the 8×B200 figures; smaller ladders work, slower.",
  },
  {
    question: "How are my account and my renders protected?",
    answer:
      "The browser never holds a session secret or a gateway token. Sign-in is exchanged server-side, the session cookie is encrypted and httpOnly, the gateway JWT is minted per request by the proxy route, sign-out revokes the upstream session, and every artifact is streamed through an auth-gated endpoint.",
  },
  {
    question: "Is it open source, and what are the licence terms?",
    answer:
      "The training and inference code is Apache-2.0. The weights are distributed separately on Hugging Face and ModelScope under the MiniMax H3 Community Licence, which excludes some territories — read it before downloading or running the checkpoint.",
  },
];

/** Footer navigation. Internal hrefs stay literal route strings so Next's
 *  typed `<Link>` accepts them; external ones are plain anchors. */
export type FooterLink =
  | { label: string; href: "/dashboard" | "/jobs" | "/settings" }
  | { label: string; href: string; external: true };

export const FOOTER_GROUPS: { title: string; links: FooterLink[] }[] = [
  {
    title: "Product",
    links: [
      { label: "Create", href: "/dashboard" },
      { label: "Library", href: "/jobs" },
      { label: "Workspace settings", href: "/settings" },
    ],
  },
  {
    title: "Research",
    links: [
      { label: "Paper (arXiv)", href: LINKS.paper, external: true },
      { label: "Blog", href: LINKS.blog, external: true },
      { label: "Video DeltaNet", href: LINKS.code, external: true },
    ],
  },
  {
    title: "Open weights",
    links: [
      { label: "Hugging Face", href: LINKS.weights, external: true },
      { label: "ModelScope", href: LINKS.modelscope, external: true },
      { label: "MiniMax H3", href: LINKS.minimax, external: true },
    ],
  },
];
