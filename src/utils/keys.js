import { useEffect, useRef } from "react";

// True when a key press belongs to a text field rather than to the page's shortcuts.
export function isTyping(e) {
  const el = e.target;
  if (!el || !el.tagName) return false;
  if (el.tagName === "INPUT") return !["checkbox", "radio", "button"].includes(el.type);
  return el.isContentEditable || ["TEXTAREA", "SELECT"].includes(el.tagName);
}

// Enter and space on a focused button, link or checkbox keep their native click.
const isControl = (el) => !!el?.closest?.("button, a, input, label");

// Key name in the terminal's terms: "j", "enter", "space", "up", "left", ...
export function keyName(e) {
  switch (e.key) {
    case "ArrowUp":
      return "up";
    case "ArrowDown":
      return "down";
    case "ArrowLeft":
      return "left";
    case "ArrowRight":
      return "right";
    case "Enter":
      return "enter";
    case " ":
      return "space";
    case "Escape":
      return "escape";
    default:
      return e.key;
  }
}

// Page-level shortcuts, as in the terminal UI. The handler gets (name, event) for plain key
// presses outside text fields and returns true when it used the key. The latest handler is read
// at key time so it can close over fresh state.
export function useShortcuts(handler) {
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  });

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || isTyping(e)) return;
      const name = keyName(e);
      if ((name === "enter" || name === "space") && isControl(e.target)) return;
      if (ref.current(name, e)) e.preventDefault();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);
}

// Next selection index for j / k / up / down, clamped to the list (-1 for an empty one); null for
// any other key.
export function moveIndex(name, index, length) {
  const down = name === "j" || name === "down";
  if (!down && name !== "k" && name !== "up") return null;
  if (length === 0) return -1;
  return down ? Math.min(length - 1, index + 1) : Math.max(0, index - 1);
}
