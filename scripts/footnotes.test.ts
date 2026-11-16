import test from "node:test";
import assert from "node:assert/strict";
import { cleanFootnote, cleanFootnotes, tableFootnotes, notesLabel, notesAnchor, MAX_NOTES_PER_FILING } from "../web/src/lib/footnotes";

test("XML escapes are undone, once or twice escaped", () => {
  assert.equal(cleanFootnote("J&amp;A Holdings (the &quot;Trust&quot;)"), 'J&A Holdings (the "Trust")');
  assert.equal(cleanFootnote("A &amp;amp; B &#39;x&#39; &lt;1%"), "A & B 'x' <1%");
  assert.equal(cleanFootnote("R&D costs; AT&T"), "R&D costs; AT&T");
});
test("white space and control characters collapse; non-text is empty", () => {
  assert.equal(cleanFootnote("  a\n\n  b\tc\u0000d  "), "a b c d");
  assert.equal(cleanFootnote(null), "");
  assert.equal(cleanFootnote(12), "");
});
test("a filing's list keeps order and drops empty and repeated notes", () => {
  assert.deepEqual(cleanFootnotes(["b", " ", "a", "b ", null, "c"]), ["b", "a", "c"]);
  assert.deepEqual(cleanFootnotes("not a list"), []);
  assert.deepEqual(cleanFootnotes(undefined), []);
});
test("one block per filing, in row order, only for filings with notes", () => {
  const notes = new Map<number, string[]>([[7, ["x"]], [9, ["y", "z"]]]);
  const out = tableFootnotes([9, 7, 9, 5, 7], (id) => notes.get(id));
  assert.deepEqual(out.map((b) => b.filingId), [9, 7]);
  assert.deepEqual(out[0], { filingId: 9, notes: ["y", "z"], more: 0, total: 2 });
});
test("a long list is cut and the rest counted", () => {
  const many = Array.from({ length: 14 }, (_, i) => `n${i}`);
  const [b] = tableFootnotes([1], () => many);
  assert.equal(b.notes.length, MAX_NOTES_PER_FILING);
  assert.equal(b.more, 14 - MAX_NOTES_PER_FILING);
  assert.equal(b.total, 14);
  assert.equal(b.notes[0], "n0");
});
test("labels", () => {
  assert.equal(notesLabel(1), "1 note");
  assert.equal(notesLabel(4), "4 notes");
  assert.equal(notesAnchor(53574), "fn53574");
});
