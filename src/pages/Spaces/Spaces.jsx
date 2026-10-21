import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRightIcon, RefreshIcon } from "@components/icons";
import * as api from "@utils/api";
import styles from "./spaces.module.css";

function Counts({ counts }) {
  if (!counts) return <span className={styles.missing}>folder not found</span>;
  return (
    <span className={styles.counts}>
      <span>
        todo <b>{counts.todo}</b>
      </span>
      <span>
        done <b>{counts.done}</b>
      </span>
      <span>
        pending <b>{counts.pending}</b>
      </span>
    </span>
  );
}

// One row of the tree: a link into the space when its folder exists, otherwise an inert row.
function SpaceRow({ to, exists, level, last, label, root, counts }) {
  const className = [styles.row, level === "project" ? styles.project : styles.work, exists ? "" : styles.disabled]
    .filter(Boolean)
    .join(" ");
  const body = (
    <>
      <span className={styles.tree} aria-hidden="true">
        {level === "project" ? (last ? "└" : "├") : ""}
      </span>
      <span className={styles.name}>{label}</span>
      <span className={`mono ${styles.root}`} title={root}>
        {root}
      </span>
      <Counts counts={counts} />
      <span className={styles.arrow}>{exists && <ChevronRightIcon />}</span>
    </>
  );
  return exists ? (
    <Link to={to} className={className}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

export default function Spaces() {
  const [settings, setSettings] = useState(null);
  const [works, setWorks] = useState(null);
  const [error, setError] = useState("");

  async function load() {
    try {
      const [s, d] = await Promise.all([api.getSettings(), api.listSpaces()]);
      setSettings(s);
      setWorks(d.works);
      setError("");
      document.title = "taskmgr";
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <h1 className={styles.title}>taskmgr</h1>
        <p className={styles.tagline}>Pick a work for its common tasks, or one of its projects below it.</p>

        {error ? (
          <div className={styles.state}>
            <p className={styles.error}>{error}</p>
            <button type="button" className="btn" onClick={load}>
              <RefreshIcon />
              Retry
            </button>
          </div>
        ) : works === null ? (
          <p className={`muted ${styles.state}`}>Loading…</p>
        ) : (
          <div className={styles.list}>
            {works.map((w) => (
              <div key={w.work} className={styles.group}>
                <SpaceRow to={api.spacePath(w.work)} exists={w.exists} level="work" label={w.work} root={w.root} counts={w.counts} />
                {w.projects.map((p, i) => (
                  <SpaceRow
                    key={p.name}
                    to={api.spacePath(w.work, p.name)}
                    exists={p.exists}
                    level="project"
                    last={i === w.projects.length - 1}
                    label={p.name}
                    root={p.root}
                    counts={p.counts}
                  />
                ))}
              </div>
            ))}
          </div>
        )}

        {settings && (
          <p className={`muted mono ${styles.config}`} title={settings.configPath}>
            {settings.configPath}
          </p>
        )}
      </main>
    </div>
  );
}
