// The icons of the AI parts of the web UI, drawn as the ones in components/icons.jsx.
function Icon({ className, children }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {children}
    </svg>
  );
}

// Run: a play triangle.
export function PlayIcon({ className }) {
  return (
    <Icon className={className}>
      <polygon points="6 4 20 12 6 20 6 4" />
    </Icon>
  );
}

// Stop: a square.
export function StopIcon({ className }) {
  return (
    <Icon className={className}>
      <rect x="6" y="6" width="12" height="12" />
    </Icon>
  );
}
