/**
 * Tiny download helpers for the 3D export feature.
 *
 * Two transports, because the two exports produce different things:
 *
 *   - A PNG screenshot is already a `data:` URL straight off the WebGL canvas, so
 *     it can be handed to the anchor as-is.
 *   - A GLB is a binary `Blob`, which we turn into an object URL. Object URLs are
 *     not garbage-collected, so the caller asks us to revoke it after the click.
 */

/** Wrap a `Blob` in an object URL the caller can later revoke. */
export function createObjectUrl(blob: Blob): string {
  return URL.createObjectURL(blob);
}

/**
 * Trigger a browser download without navigating away.
 *
 * @param revoke when true the `href` is treated as an object URL and revoked
 *   immediately after the click, so the app does not leak blob URLs.
 */
export function triggerDownload(filename: string, href: string, revoke = false): void {
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  if (revoke) {
    /* Defer so the click has time to register before the URL is released. */
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  }
}
