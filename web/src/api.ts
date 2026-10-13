import { useEffect, useRef } from "react";
import type { Comparison, LensReport, Sequence, ServerEvent, Timeline } from "../../src/shared/types";

export interface AppState {
  timeline: Timeline;
  head: string;
  comparison: Comparison;
  lenses: LensReport;
  status: string;
  areasPath: string;
}

async function get<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json();
  if (!res.ok) throw new Error((body as { error?: string }).error ?? res.statusText);
  return body as T;
}

const q = (params: Record<string, string | string[] | undefined>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    for (const x of Array.isArray(v) ? v : [v]) s.append(k, x);
  }
  return s.toString();
};

export const api = {
  state: () => get<AppState>("/api/state"),
  compare: (head: string) => get<Comparison>(`/api/compare?${q({ head })}`),
  lenses: (head: string) => get<LensReport>(`/api/lenses?${q({ head })}`),
  runLenses: (head: string) => get<LensReport>(`/api/lenses?${q({ head })}`, { method: "POST" }),
  diff: (head: string, paths: string[]) => get<{ diff: string }>(`/api/diff?${q({ head, path: paths })}`),
  sequence: (head: string, side: "before" | "after", cls: string, method: string) =>
    get<Sequence>(`/api/sequence?${q({ head, side, class: cls, method })}`),
  trace: (head: string, side: "before" | "after") =>
    get<{ status: string; tests: string[]; error?: string; flows: number } | null>(`/api/trace?${q({ head, side })}`),
  draftAreas: () => get<{ started: boolean }>("/api/areas/draft", { method: "POST" }),
};

/** Server-sent events: new commits, comparisons, lens progress and status lines. */
export function useEvents(onEvent: (e: ServerEvent) => void) {
  const handler = useRef(onEvent);
  handler.current = onEvent;
  useEffect(() => {
    const source = new EventSource("/api/events");
    source.onmessage = (m) => handler.current(JSON.parse(m.data) as ServerEvent);
    return () => source.close();
  }, []);
}
