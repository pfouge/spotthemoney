# Publishing an article on Spot the Money

An article is one Markdown file. Add the file, open a pull request, and once it is merged the next deploy publishes it at `https://spotthemoney.com/writing/<name>/`.

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
published: 2026-11-15                  # YYYY-MM-DD; a future date holds the article until then
updated: 2026-11-20                    # optional: set only after a later edit
author: jane-doe                       # your author file name, without .json
tags: [congress, disclosure]           # optional: lowercase words
original: https://example.com/post     # optional: where it was first published
image: /writing/my-first-article/hero.jpg   # optional: hero image, see Images
draft: false                           # true keeps the article off the site
---
```

Put quotes around `title` and `deck`. A colon inside an unquoted value breaks the file.

## What the build enforces

- `title`: 1 to 60 characters.
- `deck`: 70 to 155 characters.
- `published`: a real date written `YYYY-MM-DD`. `updated`, if set, is a date too.
- `author`: must match a file in `web/src/content/authors/`.
- `tags`: lowercase.
- `original`: a full `http://` or `https://` address.
- `image`: a path starting with `/writing/`.
- Author `bio`: 300 characters or fewer.
- The file name: lowercase letters, digits and single hyphens.

A file that breaks a rule fails the build with a message naming the file and the field.

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
- Peter merges it, and the next deploy publishes it.
