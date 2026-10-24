// Put `text` on the clipboard. The async clipboard API needs a secure context (https or
// localhost); over plain http on a LAN address it is missing, so an off-screen textarea and
// the old copy command stand in. Resolves to true when the text was copied.
export async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      /* fall through to the command */
    }
  }
  const el = document.createElement("textarea");
  el.value = text;
  el.setAttribute("readonly", "");
  el.style.position = "fixed";
  el.style.opacity = "0";
  document.body.appendChild(el);
  const active = document.activeElement;
  el.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  el.remove();
  active?.focus?.();
  return ok;
}
