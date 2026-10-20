// A tiny pub/sub so any module can show a toast without threading props to the one <Toast />.
let handlers = null;

export function register(show, hide) {
  handlers = { show, hide };
  return () => {
    handlers = null;
  };
}

export function show(message, duration = 1800, position = "bottom") {
  handlers?.show(message, duration, position);
}

export function hide() {
  handlers?.hide();
}
