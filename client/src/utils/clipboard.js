// Bulletproof Clipboard Copy Utility for Electron, Web, and Unfocused Contexts
export async function copyTextSafely(text) {
  if (text === null || text === undefined) return false;
  const str = String(text).trim();
  if (!str) return false;

  // 1. Electron IPC clipboard (if running in desktop app)
  if (typeof window !== 'undefined' && window.electronAPI && typeof window.electronAPI.copyToClipboard === 'function') {
    try {
      const res = await window.electronAPI.copyToClipboard(str);
      if (res) return true;
    } catch (e) {
      console.warn('[Clipboard] electronAPI.copyToClipboard error:', e);
    }
  }

  // 2. Modern navigator.clipboard API
  if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(str);
      return true;
    } catch (e) {
      console.warn('[Clipboard] navigator.clipboard.writeText error, attempting textarea fallback:', e);
    }
  }

  // 3. Fallback: invisible DOM textarea with document.execCommand('copy')
  try {
    const textArea = document.createElement('textarea');
    textArea.value = str;
    textArea.setAttribute('readonly', '');
    textArea.style.position = 'fixed';
    textArea.style.top = '0';
    textArea.style.left = '0';
    textArea.style.width = '2em';
    textArea.style.height = '2em';
    textArea.style.padding = '0';
    textArea.style.border = 'none';
    textArea.style.outline = 'none';
    textArea.style.boxShadow = 'none';
    textArea.style.background = 'transparent';
    textArea.style.opacity = '0';
    textArea.style.zIndex = '-9999';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    textArea.setSelectionRange(0, str.length);

    const successful = document.execCommand('copy');
    document.body.removeChild(textArea);
    if (successful) return true;
  } catch (err) {
    console.error('[Clipboard] execCommand fallback failed:', err);
  }

  return false;
}
