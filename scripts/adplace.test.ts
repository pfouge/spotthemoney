import { test } from "node:test";
import assert from "node:assert/strict";
import { topLevel, splitForAd, topHasClass } from "../web/src/lib/adplace";

test("top-level elements, with nesting, comments, void tags, scripts and quoted >", () => {
  const h = `<nav class="crumbs"><a href="/">Home</a></nav><!-- c --><h1>T</h1><br><p class="lede" title="a > b">x <b>y</b></p><script>if (a < b) { x = "</div>"; }</script><section class='card big'><div><div>z</div></div></section>`;
  const t = topLevel(h);
  assert.deepEqual(t.map((e) => e.tag), ["nav", "h1", "br", "p", "script", "section"]);
  assert.equal(t[3]!.cls, "lede");
  assert.equal(t[5]!.cls, "card big");
  assert.equal(h.slice(t[5]!.start, t[5]!.end), `<section class='card big'><div><div>z</div></div></section>`);
});

test("the ad goes after the h1 and the lede or facts that follow it", () => {
  const h = `<nav class="crumbs">c</nav><h1>T</h1><p class="lede">l</p><dl class="facts"><div>f</div></dl><section>rest</section>`;
  const { before, after } = splitForAd(h);
  assert.ok(before.endsWith("</dl>"));
  assert.equal(after, "<section>rest</section>");
  assert.equal(before + after, h);
});

test("an h1 inside a wrapper: the ad goes after the whole wrapper", () => {
  const h = `<div class="home-top"><section class="hero"><h1>T</h1></section><nav>tiles</nav></div><section class="answer">a</section><section class="feed">f</section>`;
  const { before, after } = splitForAd(h);
  // the answer block directly after the title block belongs to it
  assert.equal(after, `<section class="feed">f</section>`);
  assert.equal(before + after, h);
});

test("no h1: the ad stays first; nothing is lost", () => {
  const h = `<p>one</p><svg viewBox="0 0 1 1"><path d="M0 0"/></svg><p>two</p>`;
  assert.deepEqual(splitForAd(h), { before: "", after: h });
  assert.equal(topLevel(h).length, 3);
});

test("class lookup is on top-level elements only", () => {
  const h = `<div class="title-row x"><h1>T</h1></div><div><span class="deep"></span></div>`;
  assert.equal(topHasClass(h, "title-row"), true);
  assert.equal(topHasClass(h, "deep"), false);
});
