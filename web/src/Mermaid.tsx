import { useEffect, useRef, useState } from "react";

let seq = 0;
let loaded: Promise<typeof import("mermaid")["default"]> | null = null;

function mermaid() {
  loaded ??= import("mermaid").then((m) => m.default);
  return loaded;
}

const dark = () =>
  document.documentElement.dataset.theme === "dark" ||
  (document.documentElement.dataset.theme !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);

/** Tall enough for the longest participant name, which arrives already broken into lines with <br/>. */
function actorHeight(text: string): number {
  const lines = Math.max(1, ...text.split("\n").filter((l) => /^\s*participant\s/.test(l)).map((l) => l.split("<br/>").length));
  return 14 + lines * 16;
}

/** Renders Mermaid text in the page's colours; loads Mermaid only when first needed. */
export function Mermaid({ text }: { text: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let stale = false;
    mermaid().then(async (m) => {
      const css = getComputedStyle(document.documentElement);
      const v = (name: string) => css.getPropertyValue(name).trim();
      m.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: "base",
        fontFamily: "IBM Plex Sans, sans-serif",
        themeVariables: {
          darkMode: dark(),
          background: v("--surface"),
          primaryColor: v("--accent-soft"),
          primaryTextColor: v("--ink"),
          primaryBorderColor: v("--accent"),
          lineColor: v("--muted"),
          actorBkg: v("--accent-soft"),
          actorBorder: v("--accent"),
          actorTextColor: v("--ink"),
          signalColor: v("--ink"),
          signalTextColor: v("--ink"),
          noteBkgColor: v("--ask-soft"),
          noteTextColor: v("--ink"),
          fontSize: "13px",
        },
        sequence: { useMaxWidth: false, mirrorActors: false, actorMargin: 24, messageMargin: 18, boxMargin: 6, width: 120, height: actorHeight(text), actorFontSize: 12, messageFontSize: 11.5, noteFontSize: 11.5, wrap: false },
      });
      try {
        const { svg } = await m.render(`refract-mmd-${seq++}`, text);
        if (!stale && ref.current) ref.current.innerHTML = svg;
        setError(null);
      } catch (e) {
        if (!stale) setError((e as Error).message);
      }
    });
    return () => {
      stale = true;
    };
  }, [text]);
  return error ? <pre className="outline">{text}</pre> : <div ref={ref} />;
}
