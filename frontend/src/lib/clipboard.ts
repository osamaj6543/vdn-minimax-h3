/** Clipboard helper with a consistent toast, so every copy affordance in the
 *  app behaves (and fails) the same way. Clipboard access is denied on
 *  non-secure origins, hence the explicit error path. */
import { toast } from "sonner";

export async function copyText(text: string, message = "Copied to clipboard") {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(message);
  } catch {
    toast.error("Clipboard unavailable in this browser");
  }
}
