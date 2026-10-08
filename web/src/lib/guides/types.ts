// Guides and FAQ: the data model. A guide is DATA (not a hand-written page) so that one renderer
// (pages/guides/[slug].astro), one FAQ page, the section FAQ blocks, the sitemap, llms.txt, the
// search index and the drift check (scripts/verify-guides.mjs) all read the same source.
//
// KEEPING GUIDES IN STEP WITH THE SITE — three mechanisms, all declared on the guide itself:
//   1. Live values. A guide is a function of GuideCtx: deadlines, size bands, thresholds, counts
//      and the current I-Bond rate come from the code and the database at build time, so a
//      changed constant changes the guide text with no edit.
//   2. `covers`: the source files whose behaviour the guide describes in words. verify-guides
//      compares each file with the copy the guide was last reviewed against (reviewed.json) and
//      fails when one changed: re-read the guide, fix it if needed, then `--accept` it.
//   3. `ui`: on-screen labels the guide quotes, with the page they are on. verify-guides fails
//      when a label is no longer in that page's HTML (a renamed button, a removed filter).
// Facts about the outside world that go stale on their own (a bill's status, a contribution
// limit) live in facts.ts with an "as of" date and a re-check date.

export type GuideGroup = "congress" | "insiders" | "washington" | "rates" | "site";

export interface GuideSection {
  /** Anchor id, stable (other pages link to it). */
  id: string;
  /** Heading, written as the question a reader would type where that is natural. */
  h: string;
  /** Body HTML: <p>, <ul>, <ol>, <table>, <a>. The first sentence answers the heading. */
  html: string;
}

export interface Faq {
  q: string;
  /** Plain text, two or three sentences, complete on its own (it is quoted without the guide). */
  a: string;
  /** Section pages that show this question in their FAQ block. */
  on?: ("congress" | "insiders" | "stocks" | "washington" | "rates")[];
}

export interface GuideSource { name: string; url: string }

export interface Guide {
  slug: string;
  group: GuideGroup;
  /** The h1. */
  title: string;
  /** <title> candidates, preferred first (fitTitle picks the first that fits 60 characters). */
  seoTitle: string[];
  /** Meta description candidates (first that fits 155 characters). */
  description: string[];
  /** Two plain sentences an answer engine can quote. */
  answer: string;
  /** Date the wording last changed (ISO). */
  updated: string;
  /** Three to six one-line facts shown as a list under the answer. */
  keyFacts: string[];
  sections: GuideSection[];
  faqs: Faq[];
  /** Primary sources, linked at the foot. */
  sources: GuideSource[];
  /** Slugs of related guides. */
  related: string[];
  /** Pages on this site where the reader can see the thing described. */
  seeLive: { label: string; href: string }[];
  /** Repo-relative source files this guide describes (drift check). */
  covers: string[];
  /** On-screen labels quoted in the guide: the text, and the page whose HTML must contain it. */
  ui: { text: string; on: string }[];
  /** Keys in facts.ts this guide relies on. */
  facts: string[];
}

export const GROUPS: { key: GuideGroup; label: string; blurb: string; hub: string }[] = [
  { key: "congress", label: "Congress trades", blurb: "What members of Congress must disclose, how to read a report, and what the numbers can and cannot tell you.", hub: "/congress/" },
  { key: "insiders", label: "Insider trades", blurb: "Form 4 from the ground up: who files, what the codes mean, and why most insider selling is routine.", hub: "/insiders/" },
  { key: "washington", label: "Washington money", blurb: "Campaign donations, lobbying reports and federal contracts: what each record is and where its limits are.", hub: "/washington/" },
  { key: "rates", label: "Rates", blurb: "I Bonds, the Treasury yield curve and TIPS in plain words, tied to the live figures on this site.", hub: "/rates/" },
  { key: "site", label: "Using this site", blurb: "How to read the trade map, and the limits of what public filings can show.", hub: "/" },
];
