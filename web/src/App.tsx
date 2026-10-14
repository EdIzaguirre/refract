import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Comparison, LensReport, ServerEvent, Story, Timeline } from "../../src/shared/types";
import { api, useEvents } from "./api";
import { layoutMap, type MapLayout } from "./map/layout";
import { MapView, type MapHandle } from "./map/MapView";
import { Numbers, VerdictStrip } from "./VerdictStrip";
import { LensRail } from "./LensRail";
import { TimelineBar } from "./TimelineBar";
import { ClassPanel, type PanelTab } from "./ClassPanel";
import { Crumbs, Hint, Peek, useHints, type Level } from "./MapChrome";
import { Tour } from "./tour/Tour";

export type Mode = "before" | "after" | "split";
export type Screen = "tour" | "explore";

export function App() {
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [liveHead, setLiveHead] = useState<string | null>(null);
  const [head, setHead] = useState<string | null>(null);
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [lenses, setLenses] = useState<LensReport | null>(null);
  const [story, setStory] = useState<Story | null>(null);
  const [storyMissing, setStoryMissing] = useState(false);
  const [screen, setScreen] = useState<Screen>(() => (new URLSearchParams(location.search).get("view") === "explore" ? "explore" : "tour"));
  const [stop, setStop] = useState(0);
  const [layout, setLayout] = useState<MapLayout | null>(null);
  const [status, setStatus] = useState("Loading");
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("after");
  const [phase, setPhase] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<PanelTab>("shape");
  const [view, setView] = useState<{ k: number; openArea: string | null }>({ k: 1, openArea: null });
  // The numbers, the authors and the commits wait behind "More" so the map comes first.
  const [more, setMore] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const [areasPath, setAreasPath] = useState("");
  const map = useRef<MapHandle>(null);
  const following = useRef(true);

  // First load.
  useEffect(() => {
    api
      .state()
      .then((s) => {
        setTimeline(s.timeline);
        setLiveHead(s.head);
        setHead(s.head);
        setComparison(s.comparison);
        setLenses(s.lenses);
        setStory(s.story ?? null);
        // A server started before the tour existed sends no story.
        setStoryMissing(!s.story);
        setStatus(s.status);
        setAreasPath(s.areasPath);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  // Scrubbing the timeline asks for that commit's comparison.
  useEffect(() => {
    if (!head || comparison?.head.sha === head) return;
    let stale = false;
    setStatus("Measuring…");
    api.compare(head).then((c) => {
      if (stale) return;
      setComparison(c);
      setStatus("Ready");
    });
    api.lenses(head).then((l) => !stale && setLenses(l));
    return () => {
      stale = true;
    };
  }, [head, comparison?.head.sha]);

  useEffect(() => {
    if (!comparison) return;
    let stale = false;
    layoutMap(comparison)
      .then((l) => !stale && setLayout(l))
      .catch((e: Error) => setError(`Layout failed: ${e.message}`));
    return () => {
      stale = true;
    };
  }, [comparison]);

  useEvents((e: ServerEvent) => {
    switch (e.type) {
      case "status":
        setStatus((e.payload as { message: string }).message);
        break;
      case "timeline": {
        const t = e.payload as Timeline;
        setTimeline(t);
        const latest = t.commits[t.commits.length - 1]?.sha;
        if (latest) {
          setLiveHead(latest);
          setFresh(latest);
          setTimeout(() => setFresh(null), 1500);
          if (following.current) setHead(latest);
          else setToast("A new commit landed. Click the last dot to see it.");
        }
        break;
      }
      case "comparison": {
        const c = e.payload as Comparison;
        if (c.head.sha === head || (following.current && c.head.sha === liveHead)) setComparison(c);
        break;
      }
      case "story": {
        const st = e.payload as Story;
        if (st.head === head) setStory(st);
        break;
      }
      case "lenses": {
        const r = e.payload as LensReport;
        if (r.head === head) setLenses(r);
        break;
      }
    }
  });

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  // Flipping before and after animates the map between them.
  const animateTo = useCallback((target: number) => {
    const start = performance.now();
    let from = 0;
    setPhase((p) => (from = p));
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / 650);
      setPhase(from + (target - from) * t);
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, []);

  const changeMode = useCallback(
    (m: Mode) => {
      setMode(m);
      if (m === "before") animateTo(0);
      if (m === "after") animateTo(1);
    },
    [animateTo],
  );

  const stage = useRef<HTMLDivElement>(null);
  const select = useCallback((name: string | null, fly = false) => {
    setSelected(name);
    if (!name) return;
    // Every class opens on its shape; flow and code are one tab away.
    setTab("shape");
    // Keep the class in view beside the panel that opens over the map.
    const w = stage.current?.clientWidth ?? 1200;
    const panel = Math.min(760, w * 0.62);
    if (fly) map.current?.flyToClass(name, panel);
  }, []);

  const goTo = useCallback(
    (target?: { kind: string; name: string }) => {
      if (!target || !comparison) return;
      if (target.kind === "area") {
        const area = comparison.areas.find((a) => a.id === target.name || a.name === target.name);
        if (area) map.current?.flyToArea(area.id);
        return;
      }
      const cls = target.name.split(/[#.]/)[0];
      const found = comparison.classes.find((c) => c.name === cls) ?? comparison.classes.find((c) => c.name.endsWith(`::${cls}`));
      if (found) select(found.name, true);
    },
    [comparison, select],
  );

  const pickHead = useCallback(
    (sha: string) => {
      following.current = sha === liveHead;
      setHead(sha);
    },
    [liveHead],
  );

  // The summary always covers the whole branch; stepping through commits belongs to Explore.
  const goScreen = useCallback(
    (next: Screen) => {
      if (next === "tour" && liveHead && head !== liveHead) pickHead(liveHead);
      setScreen(next);
    },
    [liveHead, head, pickHead],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea")) return;
      if (screen === "tour") {
        if (document.querySelector(".modal")) return;
        const n = document.querySelectorAll(".tour-stops li").length;
        if (e.key === "ArrowRight" && stop < n - 1) setStop(stop + 1);
        else if (e.key === "ArrowLeft" && stop > 0) setStop(stop - 1);
        else if (e.key === "e") setScreen("explore");
        return;
      }
      if (e.key === "t") goScreen("tour");
      else if (e.key === " ") {
        // Hold space to peek at the map before the change; letting go comes back.
        e.preventDefault();
        if (!e.repeat && mode === "after") changeMode("before");
      } else if (e.key === "s") changeMode(mode === "split" ? "after" : "split");
      else if (e.key === "m") setMore((m) => !m);
      else if (e.key === "f") map.current?.fit();
      else if (e.key === "Escape") setSelected(null);
      else if (more && (e.key === "ArrowLeft" || e.key === "ArrowRight") && timeline && head) {
        const i = timeline.commits.findIndex((c) => c.sha === head);
        const j = e.key === "ArrowLeft" ? Math.max(0, i - 1) : Math.min(timeline.commits.length - 1, i + 1);
        if (timeline.commits[j]) pickHead(timeline.commits[j].sha);
      }
    };
    const onUp = (e: KeyboardEvent) => {
      if (screen === "explore" && e.key === " " && mode === "before") changeMode("after");
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onUp);
    };
  }, [mode, changeMode, timeline, head, pickHead, screen, story, stop, goScreen, more]);

  // Keep the tour on the commit being shown, however the comparison arrived (scrubbing or a live commit).
  const shown = comparison?.head.sha;
  useEffect(() => {
    if (!shown || story?.head === shown || storyMissing) return;
    let stale = false;
    api
      .story(shown)
      .then((st) => !stale && setStory(st))
      .catch(() => !stale && setStoryMissing(true));
    return () => {
      stale = true;
    };
  }, [shown, story?.head, storyMissing]);

  // A new story starts the tour from its first stop.
  useEffect(() => setStop(0), [story?.head, story?.source]);

  // Opening a class from the tour switches to the map and flies to it once the map is drawn.
  const pending = useRef<string | null>(null);
  const openInExplore = useCallback((name: string) => {
    pending.current = name;
    setScreen("explore");
  }, []);
  useEffect(() => {
    if (screen !== "explore" || !layout || !pending.current) return;
    const name = pending.current;
    pending.current = null;
    const t = setTimeout(() => select(name, true), 60);
    return () => clearTimeout(t);
  }, [screen, layout, select]);

  const selectedChange = useMemo(() => comparison?.classes.find((c) => c.name === selected) ?? null, [comparison, selected]);
  const level: Level = selectedChange ? 3 : view.openArea ? 2 : 1;
  const hints = useHints(level);

  if (error) {
    return (
      <div className="loading">
        <div>
          <div className="big">Refract could not load this change</div>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <VerdictStrip
        comparison={comparison}
        screen={screen}
        onScreen={goScreen}
        watching={timeline?.watching ?? null}
        timeline={timeline}
        more={more}
        onMore={() => setMore((m) => !m)}
      />
      {screen === "tour" ? (
        <div className="main tour-main">
          {comparison ? (
            <Tour
              comparison={comparison}
              story={story?.head === comparison.head.sha ? story : null}
              storyMissing={storyMissing}
              lenses={lenses}
              stop={stop}
              onStop={setStop}
              onOpen={openInExplore}
              onTell={(again) => head && api.tellStory(head, again).then(setStory)}
              onAskBooks={() => head && api.runLenses(head).then(setLenses)}
            />
          ) : (
            <div className="loading">
              <div>
                <div className="big">Measuring the change</div>
                <p>{status}</p>
                <span className="spinner" />
              </div>
            </div>
          )}
          {toast && <div className="toast">{toast}</div>}
        </div>
      ) : (
      <div className={`main ${more ? "" : "no-rail"}`}>
        <div className="stage" ref={stage}>
          {layout && comparison ? (
            <>
              <MapView
                ref={map}
                layout={layout}
                phase={mode === "split" ? 1 : phase}
                split={mode === "split"}
                selected={selected}
                focusArea={selectedChange?.area ?? null}
                onSelect={(n) => select(n, true)}
                onView={setView}
              />
              <Crumbs
                comparison={comparison}
                openArea={view.openArea}
                selected={selectedChange}
                onAreas={() => {
                  setSelected(null);
                  map.current?.fit();
                }}
                onArea={(id) => {
                  setSelected(null);
                  map.current?.flyToArea(id);
                }}
              />
              {hints.open && <Hint level={level} comparison={comparison} areasPath={areasPath} onDraft={() => api.draftAreas()} onClose={hints.close} />}
              {level > 1 && !selectedChange && <Peek mode={mode} onMode={changeMode} />}
              <div className="map-tools">
                {!hints.open && (
                  <button title="What am I looking at?" onClick={hints.ask}>
                    ?
                  </button>
                )}
                <button title="Fit the whole map (f)" onClick={() => map.current?.fit()}>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
                    <path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" />
                  </svg>
                </button>
              </div>
              {selectedChange && (
                <ClassPanel
                  key={selectedChange.name}
                  change={selectedChange}
                  comparison={comparison}
                  lenses={lenses}
                  head={comparison.head.sha}
                  showLenses={more}
                  tab={tab}
                  onTab={setTab}
                  onClose={() => setSelected(null)}
                  onGo={(name) => select(name, true)}
                />
              )}
            </>
          ) : (
            <div className="loading">
              <div>
                <div className="big">Measuring the change</div>
                <p>{status}</p>
                <span className="spinner" />
              </div>
            </div>
          )}
          {toast && <div className="toast">{toast}</div>}
        </div>
        {more && (
          <LensRail report={lenses} comparison={comparison} onRun={() => head && api.runLenses(head).then(setLenses)} onTarget={goTo}>
            {comparison && <Numbers comparison={comparison} onDelta={goTo} />}
          </LensRail>
        )}
      </div>
      )}
      {screen === "explore" && more && <TimelineBar timeline={timeline} head={head} liveHead={liveHead} fresh={fresh} onPick={pickHead} />}
    </div>
  );
}
