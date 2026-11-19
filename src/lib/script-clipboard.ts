/** Copy source verbatim. This function never evaluates the stored JavaScript. */
export async function copyScriptCode(code: string): Promise<void> {
  if (!code.trim()) throw new Error('There is no code to copy.');
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(code);
      return;
    } catch {
      // Some browser contexts deny the Clipboard API but still allow a user-triggered copy.
    }
  }
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const field = document.createElement('textarea');
  field.value = code;
  field.readOnly = true;
  field.setAttribute('aria-label', 'Copy code');
  field.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;';
  let copied = false;
  const writeExactText = (event: ClipboardEvent) => {
    // A textarea normalizes CRLF and bare CR. Override its default copy with the source text.
    event.preventDefault();
    if (!event.clipboardData) return;
    try {
      event.clipboardData.setData('text/plain', code);
      copied = true;
    } catch {
      // An event listener exception does not reliably propagate through execCommand.
      copied = false;
    }
  };
  try {
    // A modal makes the rest of the page inert; keep the fallback inside the active dialog.
    (active?.closest('dialog[open]') ?? document.body).appendChild(field);
    document.addEventListener('copy', writeExactText);
    field.focus({ preventScroll: true });
    field.select();
    if (!document.execCommand('copy') || !copied) throw new Error('Clipboard access was denied.');
  } finally {
    document.removeEventListener('copy', writeExactText);
    field.remove();
    active?.focus({ preventScroll: true });
  }
}
