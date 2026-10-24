// A tiny pub/sub so any module can show a toast without threading props to the one <Toast />.
let handlers = null;

export function register(show, hide) {
  handlers = { show, hide };
  return () => {
    handlers = null;
  };
}

// `variant` "error" shows the toast in red.
export function show(message, duration = 1800, position = "bottom", variant = "") {
  handlers?.show(message, duration, position, variant);
}

export function hide() {
  handlers?.hide();
}
