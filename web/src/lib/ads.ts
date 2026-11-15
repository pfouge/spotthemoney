// Advertising switch. ONE constant for the whole site.
//
// There is no AdSense account yet, so this is empty and the site renders no ad code at all:
// no meta tag, no script, no in-page slot. When Google issues a publisher ID, put it here in the
// form "ca-pub-" followed by 16 digits. In the SAME commit add web/public/ads.txt with the line
//   google.com, pub-XXXXXXXXXXXXXXXX, DIRECT, f08c47fec0942fa0
// (the same 16 digits, without the "ca-" prefix). Do not add ads.txt before there is an ID.
// Before the first ad is served, turn on Google's consent message for the EEA, the UK and
// Switzerland in AdSense (Privacy & messaging): the privacy page promises it.
//
// The ID must be the site owner's own. Never paste an ID from another network or another site.
export const ADSENSE_CLIENT = "";

const VALID = /^ca-pub-\d{16}$/;

/** The publisher ID if it is well formed and this is a production build; otherwise "". */
export function adClient(): string {
  const id = ADSENSE_CLIENT.trim();
  return VALID.test(id) && import.meta.env.PROD ? id : "";
}
