# Publishing an article on Spot the Money

An article is one Markdown file. Add the file, open a pull request, and once it is merged the next deploy publishes it at `https://spotthemoney.com/writing/<name>/`. Several articles can wait in their own pull requests at the same time; you can look at them all together on the QA site and put them all live in one go.

## Where the files go

| What | Where |
|---|---|
| The article | `web/src/content/articles/<name>.md` |
| Your author profile (once) | `web/src/content/authors/<your-name>.json` |
| Images | `web/public/writing/<name>/` |

The file name is the URL. `web/src/content/articles/congress-and-the-ten-day-rule.md` becomes `/writing/congress-and-the-ten-day-rule/`. Use lowercase letters, digits and single hyphens only, no spaces and no capitals. The build fails on any other name.

## Add yourself as an author (once)

Create `web/src/content/authors/jane-doe.json`. The file name (without `.json`) is what you put in `author:` in each article, and your page appears at `/writing/authors/jane-doe/`.

```json
{
  "name": "Jane Doe",
  "bio": "Up to 300 characters about you.",
  "url": "https://example.com",
  "x": "@janedoe",
  "linkedin": "janedoe",
  "github": "janedoe"
}
```

Only `name` is required. `url` is a full address; `x`, `linkedin` and `github` take a handle or a full address.

## The article file

Copy this block to the top of your file, then write the article below it in Markdown.

```yaml
---
title: "Your title, 60 characters or fewer"                     # page heading and search title
deck: "One or two sentences that sum up the article, between 70 and 155 characters long."  # subtitle and search description
summary: "Two sentences that answer the article's main question directly, 80 to 320 characters."   # optional, recommended: the answer AI answer engines quote
faqs:                                  # optional, recommended: 3 to 5 real questions, up to 8
  - q: "A question people really search, 10 to 150 characters?"
    a: "The answer in one to three sentences, 40 to 600 characters."
published: 2026-11-15                  # YYYY-MM-DD; a future date holds the article until then
updated: 2026-11-20                    # optional: set only after a later edit
author: jane-doe                       # your author file name, without .json
tags: [congress, disclosure]           # optional: lowercase words
original: https://example.com/post     # optional: where it was first published
image: /writing/my-first-article/hero.jpg   # optional: hero image, see Images
draft: false                           # true keeps the article off the site
---
```

Put quotes around `title`, `deck`, `summary` and every `q` and `a`. A colon inside an unquoted value breaks the file. Keep each `q` and `a` on one line.

## What the build enforces

- `title`: 1 to 60 characters.
- `deck`: 70 to 155 characters.
- `summary`, if set: 80 to 320 characters.
- `faqs`, if set: at most 8 items, each with a `q` of 10 to 150 characters and an `a` of 40 to 600 characters.
- `published`: a real date written `YYYY-MM-DD`. `updated`, if set, is a date too.
- `author`: must match a file in `web/src/content/authors/`.
- `tags`: lowercase.
- `original`: a full `http://` or `https://` address.
- `image`: a path starting with `/writing/`.
- Author `bio`: 300 characters or fewer.
- The file name: lowercase letters, digits and single hyphens.

A file that breaks a rule fails the build with a message naming the file and the field.

## Getting found in search and AI answers

Both `summary` and `faqs` are optional, and both help. Search engines and AI answer engines (ChatGPT, Perplexity, Google's AI answers) quote pages that answer a question plainly.

- **Title:** carry the main search phrase, as people would type it.
- **Deck:** this is the search snippet. Say what the article answers.
- **Summary:** the two-sentence answer to the article's main question. It appears in a boxed answer under the byline and is what answer engines quote. It also replaces the deck in `llms.txt`.
- **First paragraph:** answer the question directly, before any background.
- **Headings:** phrase each `##` heading as a question readers search ("How soon must a member of Congress report a trade?").
- **Links:** link the Spot the Money page for anything you name: a [member](/congress/), an [insider](/insiders/), a [stock](/stocks/), a [company](/companies/), or a [guide](/guides/).
- **Faqs:** 3 to 5 real questions people search, each answered in one to three sentences. They show as a "Questions and answers" section after the article.

## Drafts and scheduled publishing

- `draft: true` keeps the article off the site. Remove the line (or set it to `false`) to publish.
- A `published` date in the future holds the article until the first daily deploy on or after that date. The site rebuilds every day, so no further commit is needed.
- Neither a draft nor a future-dated article appears in the Writing list, the RSS feed, the sitemap or `llms.txt`.

## Images

Put the files in `web/public/writing/<name>/` (the same `<name>` as the article file). Reference them from the article as `/writing/<name>/file.jpg`, with alt text that says what the image shows:

```markdown
![A bar chart of trades filed late, by quarter](/writing/<name>/late-filings.png)
```

The optional `image:` field sets the hero image at the top of the article and the preview image when the link is shared. A 1200 by 630 pixel image works best.

## Links

Link to other pages on the site with relative paths, for example `[Congress trades](/congress/)` or `[the ten-day rule](/guides/congress-stock-trading-rules/)`. To link another article, use `/writing/<name>/`. The checker confirms that links to `/writing/` pages point at files that exist.

## Check before you open the pull request

From the repository root:

```bash
npm run check:articles
```

It reads every article and author file, prints one line each, and exits with an error if anything is wrong. Warnings (for example a future `published` date) do not fail the run.

## Preview locally (optional)

If you can run the site (`npm install`, then the commands below), drafts and future-dated articles are shown only when `PUBLIC_SHOW_DRAFTS=1` is set. They carry a "Draft — not public" banner.

```bash
PUBLIC_SHOW_DRAFTS=1 npm run dev          # macOS, Linux
$env:PUBLIC_SHOW_DRAFTS=1; npm run dev    # Windows PowerShell
```

Then open `http://localhost:4321/writing/`.

## Open the pull request

- Branch name: `article/<name>`.
- One article per pull request. Include the author file if it is your first article.
- Open it as a draft pull request against `main`.
- You can have several articles open at the same time, each in its own pull request.
- Peter publishes them (see "Publishing" below).

## QA

After you open the pull request, a QA copy of the whole site is built: main plus your article plus every other article that is not live yet (all open article pull requests, drafts included). Within about 10 minutes a comment appears on your pull request with a link to your article at `https://qa.spotthemoney.com/writing/<name>/`, and the comment updates on every push. `https://qa.spotthemoney.com/writing/` lists all articles not live yet, together. Check your article there (a draft or future-dated article shows a banner) before you ask for a merge. The QA copy is not indexed by search engines. Do not share its link: it changes whenever any article pull request changes, and a pull request that is merged or closed drops out of it. If the comment says QA failed, open the run it links to and read the build error.

Only the article, author and image files of a pull request (`web/src/content/articles/`, `web/src/content/authors/`, `web/public/writing/`) go into the QA copy. Anything else a pull request changes is ignored there.

## Publishing

Two ways, both by Peter:

- **Everything at once.** When all pending articles look right on `qa.spotthemoney.com/writing/`, go to Actions, choose **publish**, and click **Run workflow** (tick "Dry run" first to see what would happen without merging anything). It checks the combined site (`npm run check:articles` and a full build), merges every open article pull request (oldest first, draft ones marked ready first) and deploys the site. The run summary lists what was merged, what was skipped and why, and any merged article that still says `draft: true` (it stays hidden). A pull request that also changes anything other than articles, authors and images is skipped: merge it by hand after review. If the check fails, nothing is merged.
- **One article.** Merge that single pull request. The next deploy publishes it, and the other pull requests stay in QA.

Either way, an article marked `draft: true` or dated in the future stays off the live site until the line is removed or the date arrives.
