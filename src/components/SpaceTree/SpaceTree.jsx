import { useTranslation } from "react-i18next";
import { useEffect, useRef } from "react";
import { EditIcon } from "@components/icons";
import * as api from "@utils/api";
import styles from "./tree.module.css";

// todo / done / pending as three coloured numbers; the words are in the tooltip.
function Counts({ counts }) {
  const { t } = useTranslation();
  if (!counts) return <span className={styles.missing}>{t("tree.notFound")}</span>;
  return (
    <span className={`mono ${styles.counts}`} title={t("tree.counts", counts)}>
      <b className={styles.todo}>{counts.todo}</b>
      <b className={styles.done}>{counts.done}</b>
      <b className={styles.pending}>{counts.pending}</b>
    </span>
  );
}

function Row({ to, exists, level, last, active, focused, label, root, counts, onSelect }) {
  const ref = useRef(null);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <div
      ref={ref}
      className={`${styles.row} ${level === "project" ? styles.project : styles.work}${last ? ` ${styles.last}` : ""}`}
      data-active={active}
      data-focused={active && focused}
      data-disabled={!exists}
      role="button"
      tabIndex={exists ? 0 : -1}
      aria-disabled={!exists}
      onClick={() => exists && onSelect(to)}
    >
      {level === "project" && <span className={styles.tree} aria-hidden="true" />}
      <div className={styles.top}>
        <span className={styles.name}>{label}</span>
        <Counts counts={counts} />
      </div>
      <div className={`mono ${styles.root}`} title={root}>
        {root}
      </div>
    </div>
  );
}

// The works and their projects as a tree. `activeTo` is the space shown on the right; `focused`
// says the keyboard is on the tree rather than the task list.
export default function SpaceTree({ works, error, activeTo, focused, onSelect, onEdit }) {
  const { t } = useTranslation();
  return (
    <div className={styles.panel}>
      <div className={styles.head}>
        <span className={styles.title}>{t("tree.works")}</span>
        <button type="button" className="btn" onClick={onEdit} title={t("config.title")}>
          <EditIcon />
          {t("common.edit")}
        </button>
      </div>
      <div className={styles.list}>
        {error ? (
          <p className={styles.error}>{error}</p>
        ) : works === null ? (
          <p className={styles.empty}>{t("common.loading")}</p>
        ) : works.length === 0 ? (
          <p className={styles.empty}>{t("tree.noWorks")}</p>
        ) : (
          works.map((w) => (
            <div key={w.work} className={styles.group}>
              <Row
                to={api.spacePath(w.work)}
                exists={w.exists}
                level="work"
                active={activeTo === api.spacePath(w.work)}
                focused={focused}
                label={w.work}
                root={w.root}
                counts={w.counts}
                onSelect={onSelect}
              />
              {w.projects.map((p, i) => (
                <Row
                  key={p.name}
                  to={api.spacePath(w.work, p.name)}
                  exists={p.exists}
                  level="project"
                  last={i === w.projects.length - 1}
                  active={activeTo === api.spacePath(w.work, p.name)}
                  focused={focused}
                  label={p.name}
                  root={p.root}
                  counts={p.counts}
                  onSelect={onSelect}
                />
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
