import { useEffect, useRef } from "react";
import type { Comparison, LensReport, PlanComparison, Sequence, ServerEvent, Story, Timeline, ViewInfo } from "../../src/shared/types";

export interface AppState {
  timeline: Timeline;
  head: string;
  comparison: Comparison;
  lenses: LensReport;
  story: Story;
  status: string;
  areasPath: string;
  /** Only when Refract was started with two plans; the rest is then left out. */
  plans?: PlanComparison;
}

/** The view this tab shows; every question below is about it. */
let current: string | null = null;
export const setView = (id: string | null) => (current = id);

async function get<T>(url: string, init?: RequestInit): Promise<T> {
  if (current) url += `${url.includes("?") ? "&" : "?"}view=${encodeURIComponent(current)}`;
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
  source: (commit: string, path: string) => get<{ text: string }>(`/api/source?${q({ commit, path })}`),
  story: (head: string) => get<Story>(`/api/story?${q({ head })}`),
  tellStory: (head: string, again = false) => get<Story>(`/api/story?${q({ head, ...(again ? { again: "1" } : {}) })}`, { method: "POST" }),
  diff: (head: string, paths: string[], context?: number) =>
    get<{ diff: string }>(`/api/diff?${q({ head, path: paths, context: context === undefined ? undefined : String(context) })}`),
  sequence: (head: string, side: "before" | "after", cls: string, method: string) =>
    get<Sequence>(`/api/sequence?${q({ head, side, class: cls, method })}`),
  trace: (head: string, side: "before" | "after") =>
    get<{ status: string; tests: string[]; error?: string; flows: number } | null>(`/api/trace?${q({ head, side })}`),
  draftAreas: () => get<{ started: boolean }>("/api/areas/draft", { method: "POST" }),
};

/** Everything open in this Refract. */
export const views = {
  list: () => fetch("/api/views").then((r) => r.json() as Promise<{ views: ViewInfo[] }>),
  twin: (id: string) => get<{ id: string }>(`/api/views/twin?${q({ view: id })}`, { method: "POST" }),
  close: (id: string) => fetch(`/api/views?${q({ view: id })}`, { method: "DELETE" }).then((r) => r.json() as Promise<{ views: ViewInfo[] }>),
};

const listeners = new Set<(e: ServerEvent) => void>();

/** One event stream per tab, for the view it shows; the shell reconnects it when the view changes. */
export function connect(view: string | null, onHub: (e: ServerEvent) => void): () => void {
  const source = new EventSource(view ? `/api/events?${q({ view })}` : "/api/events");
  source.onmessage = (m) => {
    const e = JSON.parse(m.data) as ServerEvent;
    if (e.type === "views" || e.type === "open") onHub(e);
    else if (!e.view || e.view === view) for (const l of listeners) l(e);
  };
  return () => source.close();
}

/** Server-sent events: new commits, comparisons, lens progress and status lines. */
export function useEvents(onEvent: (e: ServerEvent) => void) {
  const handler = useRef(onEvent);
  handler.current = onEvent;
  useEffect(() => {
    const l = (e: ServerEvent) => handler.current(e);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
}
