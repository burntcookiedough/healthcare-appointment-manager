/**
 * Accessible live region announcer and focus utility helpers.
 */

export function announceToScreenReader(message: string, priority: "polite" | "assertive" = "polite"): void {
  if (typeof document === "undefined") return;

  const id = `sr-announcer-${priority}`;
  let liveRegion = document.getElementById(id);

  if (!liveRegion) {
    liveRegion = document.createElement("div");
    liveRegion.id = id;
    liveRegion.setAttribute("aria-live", priority);
    liveRegion.setAttribute("aria-atomic", "true");
    liveRegion.style.position = "absolute";
    liveRegion.style.width = "1px";
    liveRegion.style.height = "1px";
    liveRegion.style.padding = "0";
    liveRegion.style.margin = "-1px";
    liveRegion.style.overflow = "hidden";
    liveRegion.style.clip = "rect(0, 0, 0, 0)";
    liveRegion.style.whiteSpace = "nowrap";
    liveRegion.style.border = "0";
    document.body.appendChild(liveRegion);
  }

  // Clear first then set timeout to trigger re-announcement
  liveRegion.textContent = "";
  setTimeout(() => {
    if (liveRegion) {
      liveRegion.textContent = message;
    }
  }, 50);
}
