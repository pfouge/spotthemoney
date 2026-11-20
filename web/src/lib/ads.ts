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

// In-page ad units (AdSlot). Keep false until Google has approved the site: before approval a
// unit renders as an empty labelled box. The head tag above is what Google needs for review.
export const AD_SLOTS_ON = false;

const VALID = /^ca-pub-\d{16}$/;

/** The publisher ID if it is well formed and this is a production build; otherwise "". */
export function adClient(): string {
  const id = ADSENSE_CLIENT.trim();
  return VALID.test(id) && import.meta.env.PROD ? id : "";
}
