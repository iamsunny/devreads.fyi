# Article sharing and Tags directory

Approved scope: share individual articles and add a Tags navigation destination.

## Article sharing

Use a 16px outline share icon next to each article's bookmark. Keep controls visible in muted theme colors, with green hover/focus feedback and generous touch targets. Use the original publisher URL and article title, including on the dynamically rendered Saved page.

Follow-up request: shared publisher URLs now include `utm_source=devreads.fyi`, including clipboard success, manual-copy fallback, native shares, and nested URLs in social composers. Set one source parameter using the URL API while preserving other query parameters and fragments. Stored article URLs remain unchanged.

One shared menu provides Copy link, LinkedIn, X, and Bluesky without third-party scripts. On devices with a coarse pointer, try the native Web Share API when available; unsupported or failed sharing falls back to the menu, while cancellation leaves the page unchanged. Copy success is announced and shown briefly in green. If the clipboard API fails, display a selectable URL for manual copying.

Support keyboard activation, arrow navigation, Escape, Tab, outside dismissal, focus restoration, and a viewport-bounded menu. Existing feed keyboard shortcuts must not intercept menu/button interactions. Navigation attribution must not modify social composer links or the nested publisher URL.

## Tags directory

Add /tags/ and a Tags link between Digest and Sources. Use the existing indexed tags and slug routes, preserving the minimum-three-post rule. Show tag names with article counts in a responsive two-column list, sorted by popularity; provide an explicitly labelled local filter and visible result count/empty state. Reconcile aliases sharing a slug so each directory entry represents one destination and its count matches the tag page. Links work without JavaScript; filtering is a progressive enhancement. Match existing theme colors, typography, and borders.

## Delivery and verification

Track progress in the integration kit's root DEVELOPMENT_PLAN.md. Build the static site; check generated tag links/counts and sharing markup; exercise menu, clipboard, native sharing, and saved-post behavior. Verify narrow and wide layouts, both themes, and analytics/counter regression checks. Push through the existing Git-connected Cloudflare deployment and inspect live artifacts.

## Wider layout follow-up

Increase the shared desktop container from 780px to 1,120px. Align header, feed, and footer, give article rows more breathing room, and limit summary line length for readability. Keep the article feed in one column. Use three Tags columns at desktop widths, two on tablets, and one on small screens. Retain the compact responsive navigation. Verify widths from 320px through 1,440px in both themes.
