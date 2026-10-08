// Built-in sharing. One dialog (#shareDlg in BaseLayout) serves every Share button on the site:
//   data-share="page"   the page itself (the button in the answer block)
//   data-share="chart"  one chart card  → link to its anchor, optional image and embed code
//   data-share="trade"  one table row   → link to the filer's page at that row (#t<id>)
//   data-share="map"    the trade map   → link that keeps the current filters (the URL hash)
//
// Rules:
// - No third-party script, pixel or SDK. Each network is an ordinary link built here, opened only
//   when the visitor clicks it (the privacy page says so; keep it true).
// - Shared links always point at the canonical production URL, never at a preview host.
// - Nothing here records that a share happened.
// - TikTok and Instagram take pictures and captions, not links: for those the menu saves the
//   chart as an image and copies the caption.

type Kind = "page" | "chart" | "trade" | "map";
interface Ctx { kind: Kind; url: string; title: string; text: string; embed: string; fig: HTMLElement | null; }

const SITE = "Spot the Money";
const q = <T extends Element>(sel: string, root: ParentNode = document): T | null => root.querySelector<T>(sel);

function canonical(): string {
  const href = q<HTMLLinkElement>('link[rel="canonical"]')?.href;
  return href || location.origin + location.pathname;
}
const pageTitle = (): string => document.title.replace(/\s*[|–—-]\s*Spot the Money\s*$/i, "").trim() || SITE;
const pageDesc = (): string => q<HTMLMetaElement>('meta[name="description"]')?.content?.trim() ?? "";
const clean = (s: string | null | undefined): string => (s ?? "").replace(/\s+/g, " ").trim();
const clip = (s: string, n: number): string => (s.length <= n ? s : s.slice(0, n - 1).replace(/\s+\S*$/, "") + "…");

function contextFor(btn: HTMLElement): Ctx {
  const kind = (btn.dataset.share || "page") as Kind;
  const base = canonical();
  if (kind === "chart") {
    const fig = btn.closest<HTMLElement>("figure.viz");
    const name = clean(fig?.querySelector("h3")?.textContent);
    return {
      kind, fig, url: fig?.id ? `${base}#${fig.id}` : base,
      title: name ? `${name} — ${pageTitle()}` : pageTitle(),
      text: clean(fig?.querySelector(".viz-sum")?.textContent) || clean(fig?.querySelector(".viz-q")?.textContent),
      embed: fig?.querySelector(".viz-embed code")?.textContent ?? "",
    };
  }
  if (kind === "trade") {
    const id = btn.dataset.shareId || btn.closest("tr")?.id || "";
    const path = btn.dataset.sharePath;
    const page = path ? new URL(path, base).toString() : base;
    return { kind, fig: null, url: id ? `${page}#${id}` : page, title: clean(btn.dataset.shareText) || pageTitle(), text: "", embed: "" };
  }
  if (kind === "map") {
    return { kind, fig: null, url: base + location.hash, title: `Trade map — ${pageTitle()}`, text: pageDesc(), embed: "" };
  }
  return { kind: "page", fig: null, url: base, title: pageTitle(), text: pageDesc(), embed: "" };
}

/** Title, the longer reading when there is one, then the link: what gets pasted as a caption. */
const caption = (c: Ctx): string => [c.title, c.text && c.text !== c.title ? c.text : "", c.url].filter(Boolean).join("\n");

function networkUrl(net: string, c: Ctx): string {
  const e = encodeURIComponent, short = clip(c.title, 220);
  switch (net) {
    case "x": return `https://x.com/intent/tweet?text=${e(short)}&url=${e(c.url)}`;
    case "whatsapp": return `https://wa.me/?text=${e(`${short} ${c.url}`)}`;
    case "reddit": return `https://www.reddit.com/submit?url=${e(c.url)}&title=${e(clip(c.title, 290))}`;
    case "linkedin": return `https://www.linkedin.com/sharing/share-offsite/?url=${e(c.url)}`;
    case "facebook": return `https://www.facebook.com/sharer/sharer.php?u=${e(c.url)}`;
    case "email": return `mailto:?subject=${e(clip(c.title, 140))}&body=${e(caption(c))}`;
    default: return c.url;
  }
}

async function copyText(text: string, fallbackField?: HTMLInputElement | null): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* older browsers, or no permission */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = text; ta.setAttribute("readonly", ""); ta.style.cssText = "position:fixed;left:-9999px;top:0";
    (fallbackField?.parentElement ?? document.body).appendChild(ta); ta.select();
    const ok = document.execCommand("copy"); ta.remove(); return ok;
  } catch { return false; }
}

// ── chart → PNG ─────────────────────────────────────────────────────────────────────────────
// The charts are inline SVG coloured by the page's stylesheet, so a copy on its own would lose
// every colour. Each element's computed paint is written onto the copy, the copy is drawn on a
// canvas with the chart's title, legend and the site name, and the canvas becomes a PNG.
const PAINT = ["fill", "fill-opacity", "stroke", "stroke-width", "stroke-opacity", "stroke-dasharray", "stroke-linecap", "stroke-linejoin", "opacity", "font-family", "font-size", "font-weight", "font-style", "letter-spacing", "text-anchor", "dominant-baseline", "text-decoration", "display", "visibility"];

function visibleSvg(fig: HTMLElement): SVGSVGElement | null {
  return [...fig.querySelectorAll<SVGSVGElement>(".viz-body svg")].find((s) => s.getBoundingClientRect().width > 0) ?? null;
}
const hasChartImage = (fig: HTMLElement | null): boolean => !!fig && !!visibleSvg(fig);

function wrapLines(g: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number): string[] {
  const words = text.split(" "), lines: string[] = []; let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (g.measureText(next).width <= maxW || !cur) cur = next; else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) { const kept = lines.slice(0, maxLines); let last = kept[maxLines - 1]!; while (last.length > 1 && g.measureText(last + "…").width > maxW) last = last.slice(0, -1); kept[maxLines - 1] = last.trimEnd() + "…"; return kept; }
  return lines;
}

async function chartPng(fig: HTMLElement): Promise<Blob | null> {
  const src = visibleSvg(fig); if (!src) return null;
  const vb = src.viewBox.baseVal; const vw = vb && vb.width ? vb.width : src.getBoundingClientRect().width, vh = vb && vb.height ? vb.height : src.getBoundingClientRect().height;
  if (!vw || !vh) return null;
  const copy = src.cloneNode(true) as SVGSVGElement;
  const from = [src, ...src.querySelectorAll<SVGElement>("*")], to = [copy, ...copy.querySelectorAll<SVGElement>("*")];
  for (let i = 0; i < from.length && i < to.length; i++) {
    const cs = getComputedStyle(from[i]!); let style = "";
    for (const p of PAINT) { const v = cs.getPropertyValue(p); if (v) style += `${p}:${v};`; }
    to[i]!.setAttribute("style", style); to[i]!.removeAttribute("data-tip"); to[i]!.removeAttribute("class");
  }
  const W = 1200, PAD = 56, cw = W - PAD * 2, ch = Math.round(cw * (vh / vw));
  copy.setAttribute("xmlns", "http://www.w3.org/2000/svg"); copy.setAttribute("width", String(cw)); copy.setAttribute("height", String(ch));
  copy.style.display = "block";
  const img = new Image();
  const loaded = new Promise<boolean>((res) => { img.onload = () => res(true); img.onerror = () => res(false); });
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(new XMLSerializer().serializeToString(copy));
  if (!(await loaded)) return null;

  const root = getComputedStyle(document.documentElement);
  const col = (name: string, fb: string) => root.getPropertyValue(name).trim() || fb;
  const bg = col("--surface", "#FFFFFF"), ink = col("--ink", "#0C0D0E"), soft = col("--ink-soft", "#5B5F63"), line = col("--line", "#E2E1DC");
  const sans = getComputedStyle(document.body).fontFamily || "sans-serif";
  const head = getComputedStyle(fig.querySelector("h3") ?? document.body).fontFamily || sans;
  const title = clean(fig.querySelector("h3")?.textContent) || "Chart", sub = pageTitle();
  const legend = [...fig.querySelectorAll<HTMLElement>(".viz-legend span")].map((s) => ({ label: clean(s.textContent), color: getComputedStyle(s.querySelector("i") ?? s).backgroundColor })).filter((l) => l.label);

  const canvas = document.createElement("canvas"); const g = canvas.getContext("2d"); if (!g) return null;
  g.font = `600 44px ${head}`; const tLines = wrapLines(g, title, cw, 2);
  g.font = `400 26px ${sans}`; const sLines = wrapLines(g, sub, cw, 1);
  const headH = PAD + tLines.length * 54 + sLines.length * 38 + 18, legH = legend.length ? 48 : 0, footH = 96;
  canvas.width = W; canvas.height = headH + legH + ch + footH;
  g.fillStyle = bg; g.fillRect(0, 0, canvas.width, canvas.height);
  g.textBaseline = "alphabetic";
  let y = PAD + 40;
  g.fillStyle = ink; g.font = `600 44px ${head}`; for (const l of tLines) { g.fillText(l, PAD, y); y += 54; }
  g.fillStyle = soft; g.font = `400 26px ${sans}`; for (const l of sLines) { g.fillText(l, PAD, y - 8); y += 38; }
  if (legend.length) {
    let x = PAD; const ly = headH + 18; g.font = `400 22px ${sans}`;
    for (const l of legend) { g.fillStyle = l.color; g.fillRect(x, ly - 16, 18, 18); g.fillStyle = soft; g.fillText(l.label, x + 26, ly); x += 26 + g.measureText(l.label).width + 28; }
  }
  g.drawImage(img, PAD, headH + legH, cw, ch);
  const fy = headH + legH + ch + 30;
  g.strokeStyle = line; g.lineWidth = 2; g.beginPath(); g.moveTo(PAD, fy); g.lineTo(W - PAD, fy); g.stroke();
  g.fillStyle = ink; g.font = `600 26px ${sans}`; g.fillText("spotthemoney.com", PAD, fy + 42);
  const stamp = `Public filings, as disclosed · ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
  g.fillStyle = soft; g.font = `400 22px ${sans}`; g.fillText(stamp, W - PAD - g.measureText(stamp).width, fy + 42);
  return new Promise<Blob | null>((res) => canvas.toBlob((b) => res(b), "image/png"));
}

function download(blob: Blob, name: string): void {
  const a = document.createElement("a"); const url = URL.createObjectURL(blob);
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
const imageName = (c: Ctx): string => `spotthemoney-${(c.fig?.id || "chart").replace(/^chart-/, "")}.png`;

// ── dialog ───────────────────────────────────────────────────────────────────────────────────
function initShare(): void {
  const dlg = document.getElementById("shareDlg") as HTMLDialogElement | null;
  if (!dlg || typeof dlg.showModal !== "function") return;
  const what = q<HTMLElement>("#shareWhat", dlg)!, field = q<HTMLInputElement>("#shareUrl", dlg)!, status = q<HTMLElement>("#shareStatus", dlg)!, heading = q<HTMLElement>("#shareTitle", dlg)!;
  const act = (name: string) => q<HTMLButtonElement>(`[data-share-act="${name}"]`, dlg);
  let ctx: Ctx | null = null;
  const say = (msg: string): void => { status.textContent = msg; };
  const canNative = typeof navigator.share === "function";

  const open = (btn: HTMLElement): void => {
    ctx = contextFor(btn);
    heading.textContent = ctx.kind === "chart" ? "Share this chart" : ctx.kind === "trade" ? "Share this trade" : ctx.kind === "map" ? "Share this view" : "Share this page";
    what.textContent = ctx.title; field.value = ctx.url; say("");
    for (const a of dlg.querySelectorAll<HTMLAnchorElement>("[data-share-net]")) a.href = networkUrl(a.dataset.shareNet!, ctx);
    const nat = act("native"), image = act("image"), embed = act("embed");
    if (nat) nat.hidden = !canNative;
    if (image) image.hidden = !hasChartImage(ctx.fig);
    if (embed) embed.hidden = !ctx.embed;
    if (!dlg.open) dlg.showModal();
  };

  document.addEventListener("click", (e) => {
    const btn = (e.target as Element | null)?.closest?.<HTMLElement>("[data-share]");
    if (btn) { e.preventDefault(); open(btn); }
  });
  q("#shareClose", dlg)?.addEventListener("click", () => dlg.close());
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
  field.addEventListener("focus", () => field.select());

  dlg.addEventListener("click", async (e) => {
    const b = (e.target as Element | null)?.closest?.<HTMLButtonElement>("[data-share-act]");
    if (!b || !ctx) return;
    const c = ctx, name = b.dataset.shareAct;
    if (name === "copy") say((await copyText(c.url, field)) ? "Link copied." : "Could not copy. Select the link above and copy it.");
    else if (name === "caption") say((await copyText(caption(c), field)) ? "Text and link copied." : "Could not copy the text.");
    else if (name === "embed") say((await copyText(c.embed, field)) ? "Embed code copied. Paste it into your page's HTML." : "Could not copy the embed code.");
    else if (name === "native") { try { await navigator.share({ title: c.title, text: c.title, url: c.url }); } catch { /* closed without sharing */ } }
    else if (name === "image" || name === "tiktok") {
      const blob = hasChartImage(c.fig) ? await chartPng(c.fig!) : null;
      if (name === "image") { if (blob) { download(blob, imageName(c)); say("Image saved."); } else say("Could not make an image of this chart."); return; }
      // TikTok has no way to receive a link from a website: hand over what it does take.
      const copied = await copyText(caption(c), field);
      if (blob) {
        const file = new File([blob], imageName(c), { type: "image/png" });
        const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
        if (canNative && nav.canShare?.({ files: [file] }) && matchMedia("(pointer: coarse)").matches) {
          try { await navigator.share({ files: [file], text: caption(c) }); say("Choose TikTok in the share sheet. The caption is on your clipboard."); return; } catch { /* fall through to saving */ }
        }
        download(blob, imageName(c));
        say(copied ? "Image saved and caption copied. Add both to a TikTok post." : "Image saved. Add it to a TikTok post.");
      } else say(copied ? "Caption copied. TikTok does not accept links from websites, so paste it into your post." : "Could not copy the caption.");
    }
  });
}

initShare();
