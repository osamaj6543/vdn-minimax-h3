"use client";

/** The studio: conditioning mode, prompt composer, image attachments, render
 *  settings, and a live spec/estimate rail.
 *
 * Request bodies, upload order and error handling are unchanged from the
 * gateway contract (`server/schemas.py`); this file only decides how the
 * choices are presented.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Image as ImageIcon,
  ImagePlus,
  Images,
  Layers,
  Loader2,
  RefreshCw,
  SlidersHorizontal,
  Sparkles,
  TextCursorInput,
  Trash2,
  Upload,
  Wand2,
  X,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";

import { VdnMark } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  createFL2V,
  createI2V,
  createL2V,
  createRef2V,
  createT2V,
  uploadImage,
} from "@/lib/api";
import { estimateDenoise, meanStepSeconds } from "@/lib/estimate";
import {
  FRAME_OPTIONS,
  TASK_LABELS,
  framesToSeconds,
  type JobView,
  type Task,
} from "@/lib/types";
import { cn } from "@/lib/utils";

const TASK_HINTS: Record<Task, string> = {
  t2v: "Describe the shot. Rewriting the prompt with MiniMax H3's guide improves quality.",
  i2v: "First line should name the first-frame picture (H3 i2va instruction), then describe the motion.",
  l2v: "Describe how the video ends on the last-frame picture (H3 l2va instruction).",
  fl2v: "Open with the fl2va instruction line ('How the reference pictures align ...'), then the shot.",
  ref2v: "Number your subjects with <Picture 1>, <Picture 2>, ... in reference order.",
};

const MODES: {
  id: Task;
  short: string;
  hint: string;
  icon: LucideIcon;
  images: number | null;
}[] = [
  { id: "t2v", short: "Text", hint: "Prompt only", icon: TextCursorInput, images: null },
  { id: "i2v", short: "First frame", hint: "Animate a still", icon: ImageIcon, images: 1 },
  { id: "l2v", short: "Last frame", hint: "Land on a frame", icon: ImagePlus, images: 1 },
  { id: "fl2v", short: "Start + end", hint: "Bridge two frames", icon: Images, images: 2 },
  { id: "ref2v", short: "References", hint: "Up to 8 pictures", icon: Layers, images: 8 },
];

const STEPS: { value: number; label: string; hint: string }[] = [
  { value: 8, label: "Fast", hint: "8-step distill" },
  { value: 50, label: "Quality", hint: "50 steps" },
];

const PRIORITIES: { value: string; label: string }[] = [
  { value: "high", label: "High" },
  { value: "standard", label: "Standard" },
  { value: "low", label: "Low" },
];

export function CreateVideoForm({ jobs = [] }: { jobs?: JobView[] }) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [task, setTask] = useState<Task>("t2v");
  const [prompt, setPrompt] = useState("");
  const [frames, setFrames] = useState(345);
  const [steps, setSteps] = useState(8);
  const [seed, setSeed] = useState("42");
  const [priority, setPriority] = useState("standard");
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);

  const mode = MODES.find((entry) => entry.id === task) ?? MODES[0];
  const maxImages = mode.images;
  const needsImages = maxImages !== null;

  // Object URLs for the attachment previews; revoked whenever the set changes.
  const previews = useMemo(() => files.map((file) => URL.createObjectURL(file)), [files]);
  useEffect(() => {
    return () => previews.forEach((url) => URL.revokeObjectURL(url));
  }, [previews]);

  const timing = useMemo(() => meanStepSeconds(jobs), [jobs]);
  const estimate = estimateDenoise(steps, timing);

  function onTaskChange(next: Task) {
    setTask(next);
    setFiles([]);
  }

  function onPickFiles(picked: FileList | null) {
    if (!picked?.length) return;
    const accepted = Array.from(picked).filter((file) => file.type.startsWith("image/"));
    if (maxImages !== null) {
      const room = maxImages - files.length;
      if (room <= 0) {
        toast.error(`This mode takes at most ${maxImages} image(s)`);
        return;
      }
      setFiles((current) => [...current, ...accepted.slice(0, room)]);
    }
    if (fileInput.current) fileInput.current.value = "";
  }

  function removeFile(index: number) {
    setFiles((current) => current.filter((_, i) => i !== index));
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!prompt.trim()) {
      toast.error("Write a prompt first");
      return;
    }
    if (needsImages && files.length === 0) {
      toast.error("Attach at least one image for this mode");
      return;
    }
    setBusy(true);
    try {
      const body = {
        prompt: prompt.trim(),
        num_frames: frames,
        num_steps: steps,
        seed: Number.parseInt(seed, 10) || 42,
        priority,
      };
      let jobId: string;
      if (task === "t2v") {
        jobId = (await createT2V(body)).job_id;
      } else {
        const keys: string[] = [];
        for (const file of files) {
          keys.push(await uploadImage(file));
        }
        if (task === "i2v") {
          jobId = (await createI2V({ ...body, first_image: keys[0] })).job_id;
        } else if (task === "l2v") {
          jobId = (await createL2V({ ...body, last_image: keys[0] })).job_id;
        } else if (task === "fl2v") {
          jobId = (
            await createFL2V({ ...body, first_image: keys[0], last_image: keys[1] })
          ).job_id;
        } else {
          jobId = (await createRef2V({ ...body, images: keys })).job_id;
        }
      }
      toast.success("Render queued", { description: `Job ${jobId.slice(0, 12)}…` });
      router.push(`/jobs/${jobId}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not queue render");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_348px]"
    >
      <div className="flex min-w-0 flex-col gap-6">
        {/* conditioning */}
        <section className="panel p-4 sm:p-5">
          <PanelHeading
            icon={Layers}
            title="Conditioning"
            hint="What the render starts from"
          />
          <div className="mt-4 grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {MODES.map((entry) => (
              <ModeCard
                key={entry.id}
                mode={entry}
                active={entry.id === task}
                onSelect={() => onTaskChange(entry.id)}
              />
            ))}
          </div>
        </section>

        {/* prompt composer */}
        <section className="panel p-4 sm:p-5">
          <PanelHeading
            icon={Sparkles}
            title="Prompt"
            hint="H3 context instructions welcome"
            action={
              <span className="text-[0.7rem] text-muted-foreground num">
                {prompt.length}/8000
              </span>
            }
          />
          <div
            className={cn(
              "well mt-4 p-3 transition-colors",
              "focus-within:border-gold/40 focus-within:ring-3 focus-within:ring-ring/20",
            )}
          >
            <Textarea
              id="prompt"
              rows={7}
              maxLength={8000}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder={TASK_HINTS[task]}
              aria-label="Prompt"
              className="min-h-[10rem] resize-y border-0 bg-transparent p-0 text-sm leading-relaxed shadow-none focus-visible:ring-0 dark:bg-transparent"
              required
            />
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-hairline pt-3">
              <span className="flex items-center gap-1.5 text-[0.7rem] text-muted-foreground">
                <Wand2 className="size-3.5 text-gold/70" />
                {TASK_LABELS[task]}
              </span>
              <div className="ml-auto flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  disabled={!prompt}
                  onClick={() => setPrompt("")}
                >
                  <X className="size-3" />
                  Clear
                </Button>
              </div>
            </div>
          </div>
          <p className="mt-2.5 text-[0.7rem] leading-relaxed text-muted-foreground">
            {TASK_HINTS[task]}
          </p>
        </section>

        {/* attachments (image-conditioned modes only) */}
        {needsImages && (
          <section className="panel p-4 sm:p-5">
            <PanelHeading
              icon={ImageIcon}
              title="Conditioning images"
              hint={mode.images === 1 ? "Exactly one picture" : `Up to ${maxImages} pictures`}
              action={
                <span className="text-[0.7rem] text-muted-foreground num">
                  {files.length}/{maxImages}
                </span>
              }
            />
            <div
              role="button"
              tabIndex={0}
              aria-label="Add images"
              onClick={() => fileInput.current?.click()}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  fileInput.current?.click();
                }
              }}
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                onPickFiles(event.dataTransfer.files);
              }}
              className={cn(
                "mt-4 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-7 text-center transition-colors",
                dragging
                  ? "border-gold/50 bg-gold/[0.06]"
                  : "border-tint/12 bg-tint/[0.015] hover:border-tint/20 hover:bg-tint/[0.03]",
              )}
            >
              <span className="grid size-9 place-items-center rounded-lg border border-hairline bg-tint/[0.03] text-muted-foreground">
                <Upload className="size-4" />
              </span>
              <span className="text-sm">Drop images or click to browse</span>
              <span className="text-[0.7rem] text-muted-foreground">
                PNG · JPEG · WebP — uploaded to the gateway on submit
              </span>
            </div>
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              multiple={task === "ref2v"}
              className="hidden"
              onChange={(event) => onPickFiles(event.target.files)}
            />

            {files.length > 0 && (
              <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {files.map((file, index) => (
                  <li
                    key={`${file.name}-${index}`}
                    className="group relative overflow-hidden rounded-lg border border-hairline bg-black/40"
                  >
                    <span className="absolute top-1.5 left-1.5 z-10 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[0.6rem] text-white/80">
                      {index + 1}
                    </span>
                    <button
                      type="button"
                      aria-label={`Remove ${file.name}`}
                      onClick={() => removeFile(index)}
                      className="absolute top-1.5 right-1.5 z-10 rounded-md border border-white/10 bg-black/70 p-1 text-white/80 transition-colors hover:bg-destructive/80 hover:text-white"
                    >
                      <Trash2 className="size-3" />
                    </button>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={previews[index]}
                      alt={file.name}
                      className="aspect-video w-full object-cover"
                    />
                    <span className="block truncate px-2 py-1.5 text-[0.65rem] text-muted-foreground">
                      {file.name}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {/* render settings */}
        <section className="panel p-4 sm:p-5">
          <PanelHeading
            icon={SlidersHorizontal}
            title="Render settings"
            hint="Duration, sampling, seed and lane"
          />
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Duration" hint={`${framesToSeconds(frames).toFixed(1)}s clip`}>
              <Select value={String(frames)} onValueChange={(v) => v && setFrames(Number(v))}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FRAME_OPTIONS.map((option) => (
                    <SelectItem key={option} value={String(option)}>
                      {framesToSeconds(option).toFixed(1)}s · {option}f
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Quality" hint={STEPS.find((s) => s.value === steps)?.hint}>
              <Select value={String(steps)} onValueChange={(v) => v && setSteps(Number(v))}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STEPS.map((option) => (
                    <SelectItem key={option.value} value={String(option.value)}>
                      {option.label} · {option.value} steps
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Seed" hint="0 – 4294967295" htmlFor="seed">
              <div className="flex items-center gap-1.5">
                <Input
                  id="seed"
                  inputMode="numeric"
                  value={seed}
                  onChange={(event) => setSeed(event.target.value.replace(/\D/g, ""))}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label="Randomise seed"
                  title="Randomise seed"
                  onClick={() =>
                    setSeed(String(Math.floor(Math.random() * 4_294_967_295)))
                  }
                >
                  <RefreshCw className="size-3.5" />
                </Button>
              </div>
            </Field>

            <Field label="Priority" hint="Lane in the queue">
              <Select value={priority} onValueChange={(v) => v && setPriority(v)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <p className="mt-4 rounded-lg border border-hairline bg-tint/[0.02] px-3 py-2 text-[0.7rem] leading-relaxed text-muted-foreground">
            Frames follow the 17n+5 rule used by the repo. Your tier caps the
            priority the gateway accepts; higher lanes are served first by the
            worker pool.
          </p>
        </section>

      </div>

      <aside className="flex flex-col gap-4 xl:sticky xl:top-24">
        <OutputPreview
          task={task}
          frames={frames}
          steps={steps}
          seed={seed}
          priority={priority}
          images={needsImages ? files.length : null}
          estimate={estimate}
        />

        <Button
          type="submit"
          variant="brand"
          size="cta"
          className="w-full"
          disabled={busy}
        >
          {busy ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Queueing render…
            </>
          ) : (
            <>
              <Wand2 className="size-4" />
              Generate video
            </>
          )}
        </Button>

        <p className="px-1 text-[0.7rem] leading-relaxed text-muted-foreground">
          {needsImages
            ? "Images upload first, then the render is queued. You can leave this page — the library keeps live status."
            : "H3 renders 768p / 24 fps with audio. You can leave this page — the library keeps live status."}
        </p>

      </aside>
    </form>
  );
}


function PanelHeading({
  icon: Icon,
  title,
  hint,
  action,
}: {
  icon: LucideIcon;
  title: string;
  hint: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-hairline bg-tint/[0.03] text-gold/80">
        <Icon className="size-4" />
      </span>
      <div className="min-w-0">
        <h2 className="text-sm font-medium tracking-tight">{title}</h2>
        <p className="text-[0.7rem] text-muted-foreground">{hint}</p>
      </div>
      {action && <div className="ml-auto">{action}</div>}
    </div>
  );
}

function Field({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-2">
      <Label
        htmlFor={htmlFor}
        className="justify-between text-[0.7rem] tracking-[0.12em] text-muted-foreground uppercase"
      >
        <span>{label}</span>
        {hint && (
          <span className="text-[0.65rem] font-normal tracking-normal normal-case num">
            {hint}
          </span>
        )}
      </Label>
      {children}
    </div>
  );
}

function ModeCard({
  mode,
  active,
  onSelect,
}: {
  mode: { id: Task; short: string; hint: string; icon: LucideIcon };
  active: boolean;
  onSelect: () => void;
}) {
  const Icon = mode.icon;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={cn(
        "group flex flex-col items-start gap-1.5 rounded-xl border p-3 text-left transition-all",
        active
          ? "border-gold/35 bg-gold/[0.07]"
          : "border-hairline bg-tint/[0.015] hover:border-tint/15 hover:bg-tint/[0.04]",
      )}
    >
      <span
        className={cn(
          "grid size-7 place-items-center rounded-lg border transition-colors",
          active
            ? "border-gold/30 bg-gold/10 text-gold-soft"
            : "border-hairline bg-tint/[0.03] text-muted-foreground group-hover:text-foreground",
        )}
      >
        <Icon className="size-3.5" />
      </span>
      <span className={cn("text-[0.8rem]", active ? "font-medium" : "text-foreground/90")}>
        {mode.short}
      </span>
      <span className="text-[0.65rem] text-muted-foreground">{mode.hint}</span>
    </button>
  );
}



function OutputPreview({
  task,
  frames,
  steps,
  seed,
  priority,
  images,
  estimate,
}: {
  task: Task;
  frames: number;
  steps: number;
  seed: string;
  priority: string;
  images: number | null;
  estimate: { seconds: number; perStep: number; basis: string; fromHistory: boolean };
}) {
  return (
    <div className="panel overflow-hidden">
      <div className="relative aspect-video w-full overflow-hidden bg-black">
        <div className="size-full bg-[radial-gradient(120%_120%_at_20%_0%,#1c2129,#090a0d_62%)]" />
        <div aria-hidden className="grid-lines absolute inset-0 opacity-60" />
        <div className="absolute inset-0 grid place-items-center">
          <VdnMark className="h-8 text-white/12" title="" />
        </div>
        <div className="absolute top-3 left-3 flex items-center gap-2 rounded-full border border-white/10 bg-black/50 px-2.5 py-1 text-[0.65rem] text-white/70 backdrop-blur-sm">
          <span className="status-dot text-gold" />
          768p · 24 fps · audio
        </div>
        <div className="absolute bottom-3 left-3 rounded-md border border-white/10 bg-black/50 px-1.5 py-0.5 text-[0.65rem] text-white/80 backdrop-blur-sm num">
          {framesToSeconds(frames).toFixed(1)}s · {frames}f
        </div>
      </div>

      <div className="flex flex-col divide-y divide-hairline text-[0.75rem]">
        <SpecRow label="Mode" value={TASK_LABELS[task]} />
        <SpecRow
          label="Sampling"
          value={steps === 8 ? "Fast · 8 steps" : `Quality · ${steps} steps`}
        />
        <SpecRow label="Seed" value={seed || "42"} mono />
        <SpecRow label="Priority" value={priority} capitalize />
        {images !== null && <SpecRow label="Images" value={`${images} attached`} />}
        <div className="flex flex-col gap-1 px-4 py-3">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Estimated denoise</span>
            <span className="gold-text font-medium num">
              ~{estimate.seconds.toFixed(1)}s
            </span>
          </div>
          <p className="text-[0.65rem] leading-relaxed text-muted-foreground">
            {estimate.perStep.toFixed(2)}s per NFE, {estimate.fromHistory ? "from" : "per the"}{" "}
            {estimate.basis}.
          </p>
        </div>
      </div>
    </div>
  );
}

function SpecRow({
  label,
  value,
  mono = false,
  capitalize = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
  capitalize?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2.5">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span
        className={cn(
          "truncate text-right",
          mono && "font-mono text-[0.7rem] num",
          capitalize && "capitalize",
        )}
      >
        {value}
      </span>
    </div>
  );
}
