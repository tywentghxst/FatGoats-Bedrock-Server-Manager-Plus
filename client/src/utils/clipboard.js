/**
 * Safely copy text to clipboard across all browser environments,
 * including mobile browsers, non-secure HTTP contexts, and localhost.
 */
export async function safeCopyToClipboard(text) {
  if (!text) return false;

  // Modern navigator.clipboard API (requires secure context)
  if (typeof window !== 'undefined' && window.isSecureContext && navigator?.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_) {
      // Fall through to legacy DOM copy
    }
  }

  // Fallback for HTTP / non-secure contexts and older mobile browsers
  try {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    // Avoid scrolling to bottom
    textArea.style.top = '0';
    textArea.style.left = '0';
    textArea.style.position = 'fixed';
    textArea.style.opacity = '0';
    textArea.style.pointerEvents = 'none';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    const successful = document.execCommand('copy');
    document.body.removeChild(textArea);
    return Boolean(successful);
  } catch (_) {
    return false;
  }
}
