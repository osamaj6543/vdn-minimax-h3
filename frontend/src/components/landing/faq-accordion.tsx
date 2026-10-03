"use client";

/** Landing FAQ: one panel at a time, keyboard- and screen-reader-friendly.
 *
 *  Hand-rolled rather than pulled from a dependency: it is a dozen lines, the
 *  repo has no accordion primitive, and this keeps the landing route free of
 *  new packages. Each answer keeps the wording of the source document it came
 *  from (`src/lib/landing.ts`).
 */
import { useState } from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

export function FaqAccordion({
  items,
}: {
  items: { question: string; answer: string }[];
}) {
  const [open, setOpen] = useState(0);

  return (
    <div className="flex flex-col gap-2">
      {items.map((item, index) => {
        const expanded = open === index;
        const buttonId = `faq-question-${index}`;
        const panelId = `faq-answer-${index}`;
        return (
          <div
            key={item.question}
            className={cn(
              "panel overflow-hidden transition-colors",
              expanded && "border-gold/20",
            )}
          >
            <h3>
              <button
                id={buttonId}
                type="button"
                aria-expanded={expanded}
                aria-controls={panelId}
                onClick={() => setOpen(expanded ? -1 : index)}
                className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-tint/[0.03] focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <span className="text-[0.88rem] font-medium tracking-tight">
                  {item.question}
                </span>
                <ChevronDown
                  className={cn(
                    "ml-auto size-4 shrink-0 text-muted-foreground transition-transform duration-200",
                    expanded && "rotate-180 text-gold",
                  )}
                />
              </button>
            </h3>
            {expanded && (
              <div
                id={panelId}
                role="region"
                aria-labelledby={buttonId}
                className="animate-rise border-t border-hairline px-4 py-3.5"
              >
                <p className="text-[0.8rem] leading-relaxed text-muted-foreground">
                  {item.answer}
                </p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
