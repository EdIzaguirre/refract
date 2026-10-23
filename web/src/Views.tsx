import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ServerEvent, ViewInfo } from "../../src/shared/types";
import { connect, setView, views as viewsApi } from "./api";
import { Logo } from "./VerdictStrip";
import { App } from "./App";

/**
 * Refract is one tab. Everything opened from the command line (a branch, a
 * plan, plans side by side) is a view in it; running refract again switches
 * this tab to the new view instead of opening another window.
 */

const KIND: Record<ViewInfo["kind"], string> = { branch: "Branch", plan: "Plan", plans: "Plans side by side" };

interface Views {
  views: ViewInfo[];
  current: string | null;
  show(id: string): void;
  close(id: string): void;
}

const ViewsContext = createContext<Views>({ views: [], current: null, show: () => {}, close: () => {} });

const fromUrl = () => new URLSearchParams(location.search).get("v");

export function Shell() {
  const [list, setList] = useState<ViewInfo[] | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const listRef = useRef<ViewInfo[]>([]);
  listRef.current = list ?? [];

  const show = useCallback((id: string, how: "push" | "replace" | "none" = "push") => {
    setView(id);
    setCurrent(id);
    const url = new URL(location.href);
    if (url.searchParams.get("v") !== id) {
      url.searchParams.set("v", id);
      // Each view opens on its summary.
      url.searchParams.delete("view");
      if (how === "push") history.pushState(null, "", url);
      if (how === "replace") history.replaceState(null, "", url);
    }
  }, []);

  // First load: the view in the address, else the one opened last.
  useEffect(() => {
    viewsApi.list().then(({ views }) => {
      setList(views);
      const wanted = fromUrl();
      const id = views.find((v) => v.id === wanted)?.id ?? views[0]?.id;
      if (id) show(id, "replace");
    });
  }, [show]);

  useEffect(() => {
    const back = () => {
      const id = fromUrl();
      if (id && listRef.current.some((v) => v.id === id)) show(id, "none");
    };
    window.addEventListener("popstate", back);
    return () => window.removeEventListener("popstate", back);
  }, [show]);

  // Wait for the first answer, so a tab opened on a view does not briefly show another.
  const ready = list !== null;
  useEffect(() => {
    if (!ready) return;
    return connect(current, (e: ServerEvent) => {
      if (e.type === "views") {
        const next = e.payload as ViewInfo[];
        setList(next);
        if (current && next.some((v) => v.id === current)) return;
        // The view shown was closed: show the one opened last.
        if (next[0]) show(next[0].id, "replace");
        else {
          setView(null);
          setCurrent(null);
        }
      }
      if (e.type === "open") {
        const id = (e.payload as { id: string }).id;
        viewsApi.list().then(({ views }) => {
          setList(views);
          show(id);
          const v = views.find((x) => x.id === id);
          if (v) {
            setToast(`Opened ${KIND[v.kind].toLowerCase()} ${v.title}`);
            if (document.hidden) flagTitle(`${KIND[v.kind]}: ${v.title}`);
          }
        });
      }
    });
  }, [ready, current, show]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const close = useCallback((id: string) => {
    viewsApi.close(id);
  }, []);

  if (!ready) return null;
  if (!current) {
    return (
      <div className="loading">
        <div>
          <div className="big">Nothing is open</div>
          <p>
            Run <code>refract</code> in a repository, or <code>refract --plan &lt;name&gt;</code>, and it opens here.
          </p>
        </div>
      </div>
    );
  }
  return (
    <ViewsContext.Provider value={{ views: list ?? [], current, show, close }}>
      <App key={current} />
      {toast && <div className="toast views-toast">{toast}</div>}
    </ViewsContext.Provider>
  );
}

/** A new view arrived while the tab was in the background: say so in its title until it is looked at. */
function flagTitle(what: string) {
  const was = document.title;
  document.title = `● ${what}`;
  const back = () => {
    if (document.hidden) return;
    document.title = was;
    document.removeEventListener("visibilitychange", back);
  };
  document.addEventListener("visibilitychange", back);
}

/** The header's Refract mark: with more than one view open, it lists them to move between. */
export function ViewSwitch() {
  const { views, current, show, close } = useContext(ViewsContext);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", off);
    window.addEventListener("keydown", off);
    return () => {
      window.removeEventListener("mousedown", off);
      window.removeEventListener("keydown", off);
    };
  }, [open]);

  const several = views.length > 1;
  const repos = new Set(views.map((v) => v.repo)).size > 1;
  return (
    <div className="brand views-switch" ref={box}>
      <button className="brand-button" onClick={() => setOpen((o) => !o)} aria-expanded={open} title="Everything open in Refract">
        <Logo />
        Refract
        {several && (
          <>
            <span className="views-count">{views.length}</span>
            <span className="range-caret" aria-hidden>
              ▾
            </span>
          </>
        )}
      </button>
      {open && (
        <div className="views-pop" role="dialog" aria-label="Open in Refract">
          <div className="views-head">Open in Refract</div>
          <ul>
            {views.map((v) => (
              <li key={v.id} className={v.id === current ? "on" : ""}>
                <button
                  className="views-item"
                  onClick={() => {
                    show(v.id);
                    setOpen(false);
                  }}
                >
                  <span className="views-kind">
                    {v.live && <span className="live-dot" title="Following new commits" />}
                    {KIND[v.kind]}
                    {repos && <> · {v.repo}</>}
                  </span>
                  <span className="views-title">{v.title}</span>
                </button>
                <button className="views-close" title="Close" aria-label={`Close ${v.title}`} onClick={() => close(v.id)}>
                  ×
                </button>
              </li>
            ))}
          </ul>
          <p className="views-foot">
            Run <code>refract</code> again (a plan, another branch) and it opens here.
          </p>
        </div>
      )}
    </div>
  );
}
