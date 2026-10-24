import { useTranslation } from "react-i18next";
import { PlayIcon } from "./icons";

// The run button on the Prompt divider of the Task panel: a click (onClick) starts Claude Code on
// the task and opens the run's dialog, or opens the dialog of the run the task already has (`run`,
// see RunModal), with a dot on the button while the task has a run, going or finished, as the
// brain has one while the task has a prompt. `disabled` greys it out (no prompt to run) unless
// there is a run to show. Not kept focused, as the other buttons there, so the page's keys stay
// the page's.
export default function RunButton({ run, disabled, onClick }) {
  const { t } = useTranslation();
  const label = t(run ? "ai.show" : "ai.run");
  return (
    <button
      type="button"
      className="btn"
      tabIndex={-1}
      disabled={disabled && !run}
      data-dot={!!run}
      onClick={(e) => {
        e.currentTarget.blur();
        onClick();
      }}
      title={label}
      aria-label={label}
    >
      <PlayIcon />
    </button>
  );
}
