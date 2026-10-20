import type { Tone } from "@/components/ui";

export const STATUS_TONE: Record<string, Tone> = { draft: "neutral", sent: "info", accepted: "success", declined: "danger", expired: "warning", archived: "neutral" };
