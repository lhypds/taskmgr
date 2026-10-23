import styles from "./treeLines.module.css";

// Tree lines for a row at `depth`, drawn over the row (which is positioned): a straight line for
// each ancestor level in `through` that still has rows below, then an elbow (├, or └ when `last`)
// pointing at this row. The row sets where they go with --tree-left (level 0's x) and --tree-mid
// (the elbow's y, the middle of the row's first line); see treeLines.module.css.
export default function TreeLines({ depth, through = [], last }) {
  if (depth === 0) return null;
  return (
    <>
      {through.map((on, i) => on && <span key={i} className={styles.through} style={{ "--level": i }} aria-hidden="true" />)}
      <span className={styles.elbow} data-last={last} style={{ "--level": depth - 1 }} aria-hidden="true" />
    </>
  );
}
