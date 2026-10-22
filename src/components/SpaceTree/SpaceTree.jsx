import { useTranslation } from "react-i18next";
import { useEffect, useRef } from "react";
import { EditIcon, FolderIcon, PlusIcon, TrashIcon } from "@components/icons";
import { Checkbox } from "@ui";
import * as api from "@utils/api";
import { formatIncome, formatIncomeShort } from "@utils/income";
import { groupWorksByOrigin } from "@utils/works";
import styles from "./tree.module.css";

// Tree lines for a row at `depth`: a straight line for each ancestor level in `through` that still
// has rows below, then an elbow (├, or └ when `last`) pointing at this row.
function TreeLines({ depth, through, last }) {
  if (depth === 0) return null;
  return (
    <>
      {through.map((on, i) => on && <span key={i} className={styles.through} style={{ "--level": i }} aria-hidden="true" />)}
      <span className={styles.elbow} data-last={last} style={{ "--level": depth - 1 }} aria-hidden="true" />
    </>
  );
}

// A small button at the right of a row's name line, shown while the row is hovered.
function RowButton({ label, onClick, children }) {
  return (
    <button
      type="button"
      className={styles.rowEdit}
      title={label}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {children}
    </button>
  );
}

// The name line of a row: the name, then its income in short (in 万) at the right end, which the
// buttons replace while the row is hovered.
function Top({ label, income, actions }) {
  const { t } = useTranslation();
  return (
    <div className={styles.top}>
      <span className={styles.name} title={label}>
        {label}
      </span>
      {income && (
        <span className={styles.income} title={formatIncome(income, t)}>
          {formatIncomeShort(income)}
        </span>
      )}
      {actions}
    </div>
  );
}

// One space in the tree. `depth` is 0 for a work without an origin, 1 for a work under its origin
// or a repository of a depth-0 work, and 2 for a repository of a work under an origin.
function Row({ to, exists, hidden, depth, through = [], last, active, focused, label, root, income, actions, onSelect }) {
  const ref = useRef(null);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <div
      ref={ref}
      className={styles.row}
      style={{ "--depth": depth }}
      data-depth={depth}
      data-active={active}
      data-focused={active && focused}
      data-missing={!exists}
      data-hidden={!!hidden}
      role="button"
      tabIndex={0}
      onClick={() => onSelect(to)}
    >
      <TreeLines depth={depth} through={through} last={last} />
      <Top label={label} income={income} actions={actions} />
      <div className={`mono ${styles.root}`} title={root}>
        {/* The line is right-to-left so a long path is cut at its start; this keeps the path itself
            left-to-right, or its leading "/" would show at the end. */}
        <bdi dir="ltr">{root}</bdi>
      </div>
    </div>
  );
}

// An origin's name (and income) at the top of its tree; choosing it (`to`) shows every task of its
// works. "All origins" above the trees is one too, for every task.
function Origin({ name, to, active, focused, income, actions, onSelect }) {
  const ref = useRef(null);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <div
      ref={ref}
      className={styles.origin}
      data-active={active}
      data-focused={active && focused}
      role="button"
      tabIndex={0}
      onClick={() => onSelect(to)}
    >
      <Top label={name} income={income} actions={actions} />
    </div>
  );
}

// "All origins", then the origins as trees, each with its works and their repositories; works
// without an origin come last. `activeTo` is what is shown on the right; `focused` says the keyboard is on the tree rather
// than the task list. `onAdd` opens the add modal with what to start with: { type: "origin" } from
// the head, a work into an origin, a repository into a work. `works` leaves out the hidden ones
// unless `showHidden`; the checkbox under the head (with `hiddenCount`) turns that on and off.
export default function SpaceTree({
  works,
  origins,
  error,
  activeTo,
  focused,
  showHidden,
  hiddenCount,
  onShowHidden,
  onSelect,
  onEdit,
  onAdd,
  onEditWork,
  onEditOrigin,
  onEditRepository,
  onOpenFolder,
  onDelete,
}) {
  const { t } = useTranslation();
  const groups = groupWorksByOrigin(works, origins);
  return (
    <div className={styles.panel}>
      <div className={styles.head} data-focused={focused}>
        <span className={styles.title}>{t("tree.origins")}</span>
        <div className={styles.headActions}>
          <button
            type="button"
            className="btn"
            onClick={() => onAdd({ type: "origin" })}
            title={t("add.title")}
            aria-label={t("add.title")}
          >
            <PlusIcon />
          </button>
          <button type="button" className="btn" onClick={onEdit} title={t("config.title")} aria-label={t("config.title")}>
            <EditIcon />
          </button>
        </div>
      </div>
      <Checkbox className={styles.showHidden} checked={showHidden} onChange={onShowHidden}>
        {t("tree.showHidden", { count: hiddenCount })}
      </Checkbox>
      <div className={styles.list}>
        {error ? (
          <p className={styles.error}>{error}</p>
        ) : works === null ? (
          <p className={styles.empty}>{t("common.loading")}</p>
        ) : groups.length === 0 ? (
          <p className={styles.empty}>{t("tree.noOrigins")}</p>
        ) : (
          <>
            <div className={styles.group}>
              <Origin
                name={t("tree.allOrigins")}
                to={api.allPath}
                active={activeTo === api.allPath}
                focused={focused}
                onSelect={onSelect}
              />
            </div>
            {groups.map((g) => {
              const base = g.origin ? 1 : 0;
              return (
                <div key={g.origin} className={styles.group}>
                  {g.origin && (
                    <Origin
                      name={g.origin}
                      to={api.originPath(g.origin)}
                      income={g.income}
                      active={activeTo === api.originPath(g.origin)}
                      focused={focused}
                      onSelect={onSelect}
                      actions={
                        <>
                          <RowButton label={t("add.workInto")} onClick={() => onAdd({ type: "work", origin: g.origin })}>
                            <PlusIcon />
                          </RowButton>
                          <RowButton
                            label={t("origin.edit")}
                            onClick={() => onEditOrigin({ origin: g.origin, income: g.income })}
                          >
                            <EditIcon />
                          </RowButton>
                          <RowButton label={t("origin.delete")} onClick={() => onDelete({ origin: g.origin })}>
                            <TrashIcon />
                          </RowButton>
                        </>
                      }
                    />
                  )}
                  {g.works.map((w, wi) => {
                    const lastWork = wi === g.works.length - 1;
                    return [
                      <Row
                        key={w.work}
                        to={api.spacePath(g.origin, w.work)}
                        exists={w.exists}
                        hidden={w.hidden}
                        depth={base}
                        last={lastWork}
                        active={activeTo === api.spacePath(g.origin, w.work)}
                        focused={focused}
                        label={w.work}
                        root={w.remote ? t("tree.remote") : w.shownPath}
                        income={w.income}
                        onSelect={onSelect}
                        actions={
                          <>
                            <RowButton
                              label={t("add.repositoryInto")}
                              onClick={() => onAdd({ type: "repository", work: w.work })}
                            >
                              <PlusIcon />
                            </RowButton>
                            <RowButton label={t("work.edit")} onClick={() => onEditWork(w)}>
                              <EditIcon />
                            </RowButton>
                            {w.root && (
                              <RowButton label={t("tree.openFolder")} onClick={() => onOpenFolder({ work: w.work })}>
                                <FolderIcon />
                              </RowButton>
                            )}
                            <RowButton label={t("work.delete")} onClick={() => onDelete({ work: w.work })}>
                              <TrashIcon />
                            </RowButton>
                          </>
                        }
                      />,
                      ...w.repositories.map((p, i) => (
                        <Row
                          key={`${w.work}/${p.name}`}
                          to={api.spacePath(g.origin, w.work, p.name)}
                          exists={p.exists}
                          hidden={w.hidden}
                          depth={base + 1}
                          through={g.origin ? [!lastWork] : []}
                          last={i === w.repositories.length - 1}
                          active={activeTo === api.spacePath(g.origin, w.work, p.name)}
                          focused={focused}
                          label={p.name}
                          root={p.remote ? t("tree.remote") : p.shownPath}
                          onSelect={onSelect}
                          actions={
                            <>
                              <RowButton
                                label={t("repository.edit")}
                                onClick={() => onEditRepository({ work: w.work, name: p.name, paths: p.paths })}
                              >
                                <EditIcon />
                              </RowButton>
                              <RowButton
                                label={t("tree.openFolder")}
                                onClick={() => onOpenFolder({ work: w.work, repository: p.name })}
                              >
                                <FolderIcon />
                              </RowButton>
                              <RowButton
                                label={t("repository.delete")}
                                onClick={() => onDelete({ work: w.work, repository: p.name })}
                              >
                                <TrashIcon />
                              </RowButton>
                            </>
                          }
                        />
                      )),
                    ];
                  })}
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
