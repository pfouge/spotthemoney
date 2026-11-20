// Advertising switch. ONE constant for the whole site.
//
// The publisher ID below is the site owner's own AdSense account. With it set, production builds
// put the google-adsense-account meta tag and the AdSense script in the head of every page that
// may carry ads. web/public/ads.txt holds the matching line
//   google.com, pub-XXXXXXXXXXXXXXXX, DIRECT, f08c47fec0942fa0
// (the same 16 digits, without the "ca-" prefix). Change both together. An empty string turns
// all ad code off.
// Before the first ad is served, turn on Google's consent message for the EEA, the UK and
// Switzerland in AdSense (Privacy & messaging): the privacy page promises it.
//
// The ID must be the site owner's own. Never paste an ID from another network or another site.
export const ADSENSE_CLIENT = "ca-pub-9671575911691889"; // account opened 2026-11-15 under the business, site spotthemoney.com

// In-page ad units (AdSlot). Google approved the site on 2026-11-17 ("Ready", ads.txt
// "Authorized"); switched on 2026-11-19. false turns every in-page unit off and leaves only the
// head tag (and whatever Auto ads formats are switched on in AdSense for the site).
export const AD_SLOTS_ON = true;

// The ad units, created in AdSense (Ads > By ad unit) under the publisher ID above. The number is
// the unit's data-ad-slot. One unit per position, so AdSense reports earnings by position.
//   top        leaderboard under the site header, above the page title (BaseLayout, every ad page)
//   mid        between panels, part way down a page (placed by each page template)
//   low        a second in-page unit further down long pages
//   article    in-article native unit inside guides and articles
//   multiplex  grid of native ads after the page content, above the footer (BaseLayout)
export const AD_UNITS = {
  top: "2036885133",       // stm_top, display
  mid: "8143128488",       // stm_mid, display
  low: "5848137635",       // stm_low, display
  article: "9665587007",   // stm_article, in-article
  multiplex: "9125037663", // stm_multiplex, multiplex
} as const;
export type AdPos = keyof typeof AD_UNITS;

const VALID = /^ca-pub-\d{16}$/;

/** The publisher ID if it is well formed and this is a production build; otherwise "". */
export function adClient(): string {
  const id = ADSENSE_CLIENT.trim();
  return VALID.test(id) && import.meta.env.PROD ? id : "";
}
