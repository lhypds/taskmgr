import { useTranslation } from "react-i18next";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  SpaceTree,
  TaskList,
  TaskBoard,
  MonthPicker,
  TaskPanel,
  TaskEditorModal,
  ConfirmModal,
  HelpModal,
  FilePreviewModal,
  TaskPreviewModal,
  ConfigEditorModal,
  WorkEditModal,
  AddSpaceModal,
  RepositoryEditModal,
  IncomeAnalysisModal,
  LanguageSwitcher,
  UserMenu,
} from "@components";
import {
  PlusIcon,
  SearchIcon,
  XIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  RefreshIcon,
  PieIcon,
  ListIcon,
  BoardIcon,
} from "@components/icons";
import { BOARD_STATUSES, boardStatus } from "@components/TaskBoard";
import { showToast, Checkbox } from "@ui";
import { useAuth } from "@store";
import * as api from "@utils/api";
import { ALL_MONTHS, taskMonth, taskMonths, monthLabel, previewKind, flattenTasks, filterTasks } from "@utils/task";
import { groupWorksByOrigin } from "@utils/works";
import { useTaskFiles } from "@components/Attachments";
import { useShortcuts, useWheelSteps, moveIndex } from "@utils/keys";
import styles from "./home.module.css";

const EMPTY_DIR = {
  dir: "",
  absDir: "",
  isRoot: true,
  parent: null,
  crumbs: [],
  tasks: [],
  counts: { todo: 0, done: 0, pending: 0 },
};

function readFlag(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : v === "1";
  } catch {
    return fallback;
  }
}

// The task view: "list", or "board" (the progress view).
function readView() {
  try {
    return localStorage.getItem("tasks.view") === "board" ? "board" : "list";
  } catch {
    return "list";
  }
}

function writeFlag(key, value) {
  try {
    localStorage.setItem(key, value ? "1" : "0");
  } catch {
    /* ignore */
  }
}

// A key for a task that is unique across spaces, for the selection.
const keyOf = (space, rel) => `${space.work}/${space.repository || ""}/${rel}`;

// The one page: the origins, works and repositories as a tree on the left, the tasks of the chosen
// one on the right. What is shown is in the path (/all for every task, /o/:origin for every task of an origin,
// /o/:origin/:work for a work's tasks and its repositories', and one more segment for a repository) and the folder
// inside a space in ?dir=, so back/forward and reload keep both. A work with ?dir= is a folder in
// the work's own tasks.
export default function Home({ all = false }) {
  const { t } = useTranslation();
  const { logout } = useAuth();
  const { origin = "", work = "", repository = "" } = useParams();
  const space = useMemo(() => (work ? { origin, work, repository } : null), [origin, work, repository]);
  const spaceTo = all ? api.allPath : work ? api.spacePath(origin, work, repository) : origin ? api.originPath(origin) : null;
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const dir = searchParams.get("dir") || "";
  // The tasks of several spaces in one list: every work, a whole origin, or a work at its top.
  const scope = useMemo(
    () => (all ? { all: "1" } : origin && !work ? { origin } : work && !repository && !dir ? { work } : null),
    [all, origin, work, repository, dir],
  );

  const [works, setWorks] = useState(null);
  const [origins, setOrigins] = useState([]); // the named origins, { origin, income }, some maybe without works
  const [worksError, setWorksError] = useState("");
  const [treeOpen, setTreeOpen] = useState(() => readFlag("panel.tree", true));
  const [detailOpen, setDetailOpen] = useState(() => readFlag("panel.detail", true));
  const [pane, setPane] = useState("tasks"); // where j / k and friends go: "tree" or "tasks"
  const [data, setData] = useState(EMPTY_DIR);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [query, setQuery] = useState("");
  // The new task modal is open: { space, dir, status, parent }, where the task goes (in a task
  // folder with `parent`, the task it is a subtask of) and the board column it belongs to.
  const [creating, setCreating] = useState(null);
  const searchRef = useRef(null);
  const [focusKey, setFocusKey] = useState(null); // the task whose text the panel should focus
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(null); // task to delete
  const [deleting, setDeleting] = useState(false);
  const [selectedKey, setSelectedKey] = useState(null); // the task the shortcuts act on
  const [help, setHelp] = useState(false);
  const [command, setCommand] = useState(null); // text after ":" while in command mode
  const [preview, setPreview] = useState(null); // attachment shown in the preview modal
  const [peek, setPeek] = useState(null); // task whose task.txt is shown on space
  const [configOpen, setConfigOpen] = useState(false);
  const [editingWork, setEditingWork] = useState(null); // work whose name and income are being edited
  const [adding, setAdding] = useState(null); // what the add modal starts with: { type, origin, work }
  const [editingOrigin, setEditingOrigin] = useState(null); // { origin, income } of the origin being edited
  const [editingRepository, setEditingRepository] = useState(null); // { work, name, paths } of the repository being edited
  const [removing, setRemoving] = useState(null); // { origin } or { work, repository? } to remove from taskmgr.json
  const [showHidden, setShowHidden] = useState(() => readFlag("tree.showHidden", false)); // the tree shows hidden works too
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [view, setView] = useState(readView);
  const [month, setMonth] = useState(ALL_MONTHS); // the month the tasks were created in, or all
  const [showDone, setShowDone] = useState(() => readFlag("tasks.showDone", true)); // the list shows done tasks too
  const [showPending, setShowPending] = useState(() => readFlag("tasks.showPending", true)); // and pending ones

  useEffect(() => writeFlag("panel.tree", treeOpen), [treeOpen]);
  useEffect(() => writeFlag("panel.detail", detailOpen), [detailOpen]);
  useEffect(() => writeFlag("tree.showHidden", showHidden), [showHidden]);
  useEffect(() => writeFlag("tasks.showDone", showDone), [showDone]);
  useEffect(() => writeFlag("tasks.showPending", showPending), [showPending]);
  useEffect(() => {
    try {
      localStorage.setItem("tasks.view", view);
    } catch {
      /* ignore */
    }
  }, [view]);

  // The works in the tree: the hidden ones only when they are shown.
  const treeWorks = useMemo(() => (works && !showHidden ? works.filter((w) => !w.hidden) : works), [works, showHidden]);
  const hiddenCount = (works || []).filter((w) => w.hidden).length;

  // The { works, origins } every change to taskmgr.json answers with.
  const setSpaces = useCallback((d) => {
    setWorks(d.works);
    setOrigins(d.origins || []);
    setWorksError("");
  }, []);

  const loadSpaces = useCallback(async () => {
    try {
      setSpaces(await api.listSpaces());
    } catch (e) {
      setWorksError(e.message);
    }
  }, [setSpaces]);

  // Only the latest load may set the list: an earlier one answering late (after the path changed)
  // would put another space's tasks on the right.
  const loadSeq = useRef(0);
  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    if (!scope && !space) {
      setData(EMPTY_DIR);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const d = scope ? await api.listAllTasks(scope) : await api.listTasks(space, dir);
      if (seq !== loadSeq.current) return;
      setData(d);
      setLoadError("");
    } catch (e) {
      if (seq !== loadSeq.current) return;
      setData(EMPTY_DIR);
      setLoadError(e.message);
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, [scope, space, dir]);

  // Re-read the works as well: a task folder may have been created or removed.
  const reload = useCallback(() => Promise.all([load(), loadSpaces()]), [load, loadSpaces]);

  useEffect(() => {
    loadSpaces();
  }, [loadSpaces]);

  useEffect(() => {
    document.title = all
      ? `taskmgr - ${t("tree.allOrigins")}`
      : work
        ? `taskmgr - ${work}${repository ? ` / ${repository}` : ""}`
        : origin
          ? `taskmgr - ${origin}`
          : "taskmgr";
  }, [all, origin, work, repository, t]);

  // Replace old /w links with the canonical origin path once the config is available.
  useEffect(() => {
    if (!work || origin || !works) return;
    const canonicalOrigin = works.find((item) => item.work === work)?.origin;
    if (canonicalOrigin)
      navigate(
        { pathname: api.spacePath(canonicalOrigin, work, repository), search: searchParams.toString() },
        { replace: true },
      );
  }, [origin, work, repository, works, navigate, searchParams]);

  useEffect(() => {
    setQuery("");
    load();
  }, [load]);

  // The tree's rows in order (all origins, each origin, then its works and their repositories),
  // including the spaces whose folder is missing.
  const spaces = useMemo(
    () => [
      { to: api.allPath, exists: true },
      ...groupWorksByOrigin(treeWorks, origins).flatMap((g) => [
        ...(g.origin ? [{ to: api.originPath(g.origin), exists: true }] : []),
        ...g.works.flatMap((w) => [
          { to: api.spacePath(g.origin, w.work), root: w.root, exists: w.exists },
          ...w.repositories.map((p) => ({ to: api.spacePath(g.origin, w.work, p.name), root: p.root, exists: p.exists })),
        ]),
      ]),
    ],
    [treeWorks, origins],
  );
  // The space on the right when its task folder does not exist. A list of several spaces just
  // leaves the missing ones out.
  const missing = (!scope && spaces.find((s) => s.to === spaceTo && !s.exists)) || null;

  // With nothing in the path, show the first space whose folder exists.
  useEffect(() => {
    const first = spaces.find((s) => s.exists && s.root) || spaces[0];
    if (!spaceTo && first) navigate(first.to, { replace: true });
  }, [spaceTo, spaces, navigate]);

  const selectSpace = (to, replace = false) => {
    if (to !== spaceTo || dir) navigate(to, { replace });
  };

  // Every task with the space it lives in, a key unique across spaces, and, in a list of several
  // spaces, where it is from: its repository, or its work for a work's own task in an origin's or
  // in all of them. The whole work / repository path is kept for the hover title and search. The
  // tasks are a tree (each with its subtasks, which live in the same space); `tree` keeps that
  // shape, `tasks` is every task as a row under its parent, in the list's order.
  const tree = useMemo(
    () =>
      // Until the new path's list arrives, the previous one may still be here; a task of one space
      // has no space of its own to show on an origin's page, so it is left out.
      data.tasks.flatMap((t) => {
        const s =
          t.work !== undefined
            ? { origin: (works || []).find((item) => item.work === t.work)?.origin || "", work: t.work, repository: t.repository }
            : space;
        if (!s) return [];
        const path = !scope ? [] : all || origin ? [s.work, s.repository].filter(Boolean) : [s.repository].filter(Boolean);
        const from = path.join(" / ");
        const fromParts = path.slice(-1);
        const decorate = (task) => ({
          ...task,
          space: s,
          key: keyOf(s, task.rel),
          from,
          fromParts,
          subtasks: (task.subtasks || []).map(decorate),
        });
        return decorate(t);
      }),
    [data.tasks, space, scope, all, origin, works],
  );
  const tasks = useMemo(() => flattenTasks(tree), [tree]);

  // The month filter's entries; a month that this list has no task from shows every month.
  const months = useMemo(() => taskMonths(tasks), [tasks]);
  const monthIndex = Math.max(
    0,
    months.findIndex((m) => m.key === month),
  );
  const monthKey = months[monthIndex].key;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const keep = (t) =>
      (monthKey === ALL_MONTHS || taskMonth(t) === monthKey) &&
      (!q || t.title.toLowerCase().includes(q) || t.id.includes(q) || t.from.toLowerCase().includes(q)) &&
      (view === "board" || ((showDone || t.status !== "done") && (showPending || t.status !== "pending")));
    // Both views show every task under its parent, which stays when a subtask of it is kept. The
    // list leaves the done and the pending tasks out unless they are shown. The board always has its columns;
    // a task at the top sits in the column of its status with its subtasks under it, whatever
    // theirs (`column` says which), and on it j / k go down a column and on into the next one.
    const kept = filterTasks(tree, keep);
    if (view !== "board") return flattenTasks(kept);
    return BOARD_STATUSES.flatMap((s) => flattenTasks(kept.filter((t) => boardStatus(t) === s)).map((r) => ({ ...r, column: s })));
  }, [tree, query, view, showDone, showPending, monthKey]);

  // No row is selected until one is chosen, or when the selected task is not in this list (a new
  // folder, a filter, a deleted task); j / k then start from the first row.
  const selectedIndex = visible.findIndex((t) => t.key === selectedKey);
  const selected = visible[selectedIndex] || null;

  // The selected task's attachments; on the Task panel j / k walk them and space opens one.
  const attachments = useTaskFiles(selected?.space, selected?.rel, data);
  const [fileRel, setFileRel] = useState(null);
  const fileList = attachments.files.filter((f) => !f.isDir);
  const fileIndex = fileList.findIndex((f) => f.rel === fileRel);
  const selectedFile = fileList[fileIndex] || null;
  // The same for the task preview opened with space: j / k pick a file, enter opens it.
  // peek holds the key; the task itself is read fresh, so a saved edit shows at once
  const peekTask = tasks.find((task) => task.key === peek?.key) || peek;
  const [peekEditing, setPeekEditing] = useState(false); // the preview's text is being edited
  const peekAttachments = useTaskFiles(peekTask?.space, peekTask?.rel, data);
  const peekFiles = peekAttachments.files.filter((f) => !f.isDir);
  const [peekFileRel, setPeekFileRel] = useState(null);
  const peekFile = peekFiles.find((f) => f.rel === peekFileRel) || null;
  // d on a file asks in a popup; confirming (d again, or the button) deletes it and moves the highlight to its neighbour.
  const [removingFile, setRemovingFile] = useState(null); // { hook, list, file, setRel }
  const deleteFile = (hook, list, file, setRel) => setRemovingFile({ hook, list, file, setRel });
  const confirmDeleteFile = async () => {
    const { hook, list, file, setRel } = removingFile;
    setRemovingFile(null);
    const i = list.indexOf(file);
    if (await hook.remove(file, false)) setRel((list[i + 1] || list[i - 1] || null)?.rel ?? null);
  };
  const openFile = (file, task = selected) => {
    if (previewKind(file.name)) setPreview({ ...file, space: task.space });
    else window.open(api.fileUrl(task.space, file.rel), "_blank", "noreferrer");
  };

  // The wheel over the task list moves the selection, which scrolls itself into view. (The board
  // scrolls as usual.)
  const [scrollEl, setScrollEl] = useState(null);
  useWheelSteps(scrollEl, (dir) => {
    const move = moveIndex(dir > 0 ? "down" : "up", selectedIndex, visible.length);
    if (move >= 0) setSelectedKey(visible[move].key);
    setPane("tasks");
  });

  // Edit a task in the panel: select it, show the panel and put the caret in its text.
  const openEditor = (task) => {
    setSelectedKey(task.key);
    setDetailOpen(true);
    setPane("detail");
    setFocusKey(task.key);
  };

  async function setStatus(task, status) {
    try {
      const { task: updated } = await api.setStatus(task.space, task.rel, status);
      setSelectedKey(keyOf(task.space, updated.rel)); // keep the task selected in its new place
      await reload();
    } catch (e) {
      showToast(e.message);
    }
  }

  const toggleDone = (task) => setStatus(task, task.status === "done" ? "todo" : "done");
  const togglePending = (task) => setStatus(task, task.status === "pending" ? "todo" : "pending");

  const goTo = (rel) => setSearchParams(rel ? { dir: rel } : {});

  // Up one folder, selecting the task we came out of; at the top, over to the tree.
  function goUp() {
    if (data.isRoot) {
      setTreeOpen(true);
      setPane("tree");
      return;
    }
    setSelectedKey(keyOf(space, data.dir));
    goTo(data.parent || "");
  }

  // The text edited in the task panel. A new first line renames the folder; the task stays
  // selected under its new rel unless another one was picked meanwhile.
  async function saveText(task, text) {
    try {
      const {
        task: { rel },
      } = await api.saveTaskText(task.space, task.rel, text);
      const key = keyOf(task.space, rel);
      setSelectedKey((k) => (k === task.key ? key : k));
      // the first line names the folder, so a preview of this task follows the rename
      setPeek((p) => (p && p.key === task.key ? { ...p, key, rel, details: text } : p));
      await reload();
      showToast(t("toast.saved"));
    } catch (e) {
      showToast(e.message, 4000);
    }
  }

  async function saveEditor(text, files = []) {
    setSaving(true);
    // the new task goes where the editor was opened for: the folder on the right (in a work's
    // list, the work's own tasks), or the folder of the task it is a subtask of
    const { space: inSpace, dir: inDir, status } = creating;
    try {
      const { task: created } = await api.createTaskText(inSpace, inDir, text);
      let rel = created.rel;
      if (status !== "todo") {
        try {
          const { task: updated } = await api.setStatus(inSpace, rel, status);
          rel = updated.rel;
        } catch (e) {
          setCreating(null);
          await reload();
          showToast(e.message, 5000);
          return;
        }
      }
      // the task exists now, so a failed upload must not keep the editor open for a second create
      try {
        for (const f of files) await api.uploadFile(inSpace, rel, f);
      } catch (e) {
        showToast(t("toast.createdUploadFailed", { error: e.message }), 5000);
      }
      setCreating(null);
      setSelectedKey(keyOf(inSpace, rel));
      await reload();
      showToast(t("toast.created"));
    } catch (e) {
      showToast(e.message, 4000);
    } finally {
      setSaving(false);
    }
  }

  // Remove an origin, a work or a repository from taskmgr.json; leave the space on the right when
  // it was in it.
  async function confirmRemove() {
    const { origin: o, work: w, repository: r } = removing;
    const kind = o ? "origin" : r ? "repository" : "work";
    const showing = o
      ? origin === o || (!!work && works.find((x) => x.work === work)?.origin === o)
      : work === w && (!r || repository === r);
    setDeleting(true);
    try {
      setSpaces(o ? await api.deleteOrigin(o) : r ? await api.deleteRepository(w, r) : await api.deleteWork(w));
      setRemoving(null);
      if (showing) navigate("/", { replace: true });
      showToast(t(`${kind}.deleted`));
    } catch (e) {
      showToast(e.message, 4000);
    } finally {
      setDeleting(false);
    }
  }

  async function confirmDelete() {
    if (!confirm) return;
    setDeleting(true);
    try {
      await api.deleteTask(confirm.space, confirm.rel);
      // select the row above the deleted one, as the terminal does
      const i = visible.findIndex((t) => t.key === confirm.key);
      setSelectedKey(visible[Math.max(0, i - 1)]?.key ?? null);
      setConfirm(null);
      await reload();
      showToast(t("toast.deleted"));
    } catch (e) {
      showToast(e.message, 4000);
    } finally {
      setDeleting(false);
    }
  }

  async function openFolder(task) {
    try {
      await api.openInFileManager(task.space, task.rel);
      showToast(t("toast.opened"));
    } catch (e) {
      showToast(e.message, 4000);
    }
  }

  async function openSpaceFolder(target) {
    try {
      await api.openSpaceFolder(target);
      showToast(t("toast.opened"));
    } catch (e) {
      showToast(e.message, 4000);
    }
  }

  async function createSpaceFolder() {
    try {
      setSpaces(await api.createSpaceFolder(space));
      await load();
      showToast(t("toast.folderCreated"));
    } catch (e) {
      showToast(e.message, 4000);
    }
  }

  function runCommand(raw) {
    const cmd = raw.trim();
    if (!cmd) return;
    if (cmd === "h" || cmd === "help") setHelp(true);
    // a page cannot close its own tab, so quitting means logging out
    else if (cmd === "q" || cmd === "quit") logout();
    else showToast(t("toast.notCommand", { cmd }));
  }

  // An origin, or a work without a tasks folder of its own, has nowhere to add to.
  const workRoot = (works || []).find((w) => w.work === work)?.root;
  const canAdd = !!space && !loadError && (!!repository || !!workRoot);

  // Open the new task editor: for a subtask of `parent` (in its folder, in its space), by default
  // the selected task, or, with none selected, for a task in the folder on the right.
  function openCreator(status = "todo", parent = selected) {
    if (parent) setCreating({ space: parent.space, dir: parent.rel, status, parent });
    else if (canAdd) setCreating({ space, dir, status, parent: null });
  }

  function toggleView() {
    const next = view === "board" ? "list" : "board";
    setView(next);
    setPane(next === "board" ? (selected ? boardStatus(selected) : BOARD_STATUSES[0]) : "tasks");
  }

  const boardPane = BOARD_STATUSES.includes(pane) ? pane : selected ? boardStatus(selected) : BOARD_STATUSES[0];

  function selectBoardColumn(status, row = 0) {
    const cards = visible.filter((task) => boardStatus(task) === status);
    setPane(status);
    setSelectedKey(cards[Math.min(row, cards.length - 1)]?.key ?? null);
  }

  function moveBoardColumn(step) {
    const areas = ["tree", ...BOARD_STATUSES, "detail"];
    const current = ["tree", "detail"].includes(pane) ? pane : boardPane;
    const target = areas[Math.max(0, Math.min(areas.length - 1, areas.indexOf(current) + step))];
    if (target === current) return;
    if (target === "tree") {
      setTreeOpen(true);
      setPane("tree");
      return;
    }
    if (target === "detail") {
      setDetailOpen(true);
      setPane("detail");
      return;
    }
    const cards = visible.filter((task) => boardStatus(task) === boardPane);
    const row = Math.max(
      0,
      cards.findIndex((task) => task.key === selectedKey),
    );
    selectBoardColumn(target, row);
  }

  function moveListPane(step) {
    const areas = ["tree", "tasks", "detail"];
    const current = areas.includes(pane) ? pane : "tasks";
    const target = areas[Math.max(0, Math.min(areas.length - 1, areas.indexOf(current) + step))];
    if (target === current) return;
    if (target === "tree") setTreeOpen(true);
    if (target === "detail") {
      setDetailOpen(true);
    }
    setPane(target);
  }

  function toggleTreePane() {
    const next = !treeOpen;
    setTreeOpen(next);
    if (!next && pane === "tree") setPane(view === "board" ? boardPane : "tasks");
  }

  function toggleDetailPane(focusWhenOpening = true) {
    const next = !detailOpen;
    setDetailOpen(next);
    if (next) {
      if (focusWhenOpening) setPane("detail");
    } else if (pane === "detail") setPane(view === "board" ? boardPane : "tasks");
  }

  useEffect(() => {
    const onLayoutKeyDown = (e) => {
      if (e.defaultPrevented || e.repeat || (e.code !== "KeyB" && e.key.toLowerCase() !== "b")) return;
      if (e.metaKey && e.altKey && !e.ctrlKey && !e.shiftKey) {
        e.preventDefault();
        toggleDetailPane(false);
      } else if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        toggleTreePane();
      }
    };
    document.addEventListener("keydown", onLayoutKeyDown);
    return () => document.removeEventListener("keydown", onLayoutKeyDown);
  });

  // On the tree: j / k move through the spaces (the right side follows), l / enter go over to
  // the tasks.
  function treeKey(name) {
    const i = spaces.findIndex((s) => s.to === spaceTo);
    const move = moveIndex(name, i, spaces.length);
    if (move !== null) {
      if (move >= 0) selectSpace(spaces[move].to, true);
      return true;
    }
    if (["l", "right", "enter"].includes(name)) {
      if (spaceTo) {
        if (view === "board") selectBoardColumn(BOARD_STATUSES[0]);
        else setPane("tasks");
      }
      return true;
    }
    return false;
  }

  // The terminal's key bindings (see cli.js); :h lists them.
  useShortcuts((name) => {
    if (
      creating ||
      confirm ||
      removingFile ||
      configOpen ||
      editingWork ||
      editingOrigin ||
      adding ||
      editingRepository ||
      analysisOpen ||
      command !== null
    )
      return false;
    if (preview) {
      // j / k step to the next / previous file of the task the preview came from
      const list = (peek ? peekFiles : fileList).filter((f) => previewKind(f.name));
      const move = moveIndex(name, list.findIndex((f) => f.rel === preview.rel), list.length);
      if (move !== null) {
        if (move >= 0 && list[move].rel !== preview.rel) {
          const file = list[move];
          setPreview({ ...file, space: preview.space });
          (peek ? setPeekFileRel : setFileRel)(file.rel);
        }
        return true;
      }
      if (!["q", "enter", "space"].includes(name)) return false;
      setPreview(null);
      return true;
    }
    if (peek) {
      if (["e", "i"].includes(name)) {
        setPeekEditing(true);
        return true;
      }
      const move = moveIndex(name, peekFiles.indexOf(peekFile), peekFiles.length);
      if (move !== null) {
        if (move >= 0) setPeekFileRel(peekFiles[move].rel);
        return true;
      }
      if (name === "d" && peekFile) {
        deleteFile(peekAttachments, peekFiles, peekFile, setPeekFileRel);
        return true;
      }
      if (["enter", "space"].includes(name) && peekFile) {
        openFile(peekFile, peek);
        return true;
      }
      if (!["q", "enter", "space"].includes(name)) return false;
      setPeekFileRel(null);
      setPeek(null);
      return true;
    }
    // the help closes with the keys that close it in the terminal
    if (help) {
      if (!["q", "enter", "space"].includes(name)) return false;
      setHelp(false);
      return true;
    }
    if (name === "Tab") {
      if (pane !== "tree") {
        setTreeOpen(true);
        setPane("tree");
      } else if (spaceTo) {
        if (view === "board") selectBoardColumn(BOARD_STATUSES[0]);
        else setPane("tasks");
      }
      return true;
    }
    if (name === "/") {
      searchRef.current?.focus();
      return true;
    }
    if (name === "r") {
      reload();
      return true;
    }
    if (name === "v") {
      toggleView();
      return true;
    }
    if (name === ":") {
      setCommand("");
      return true;
    }
    if (["a", "n"].includes(name)) {
      openCreator(view === "board" && BOARD_STATUSES.includes(pane) ? pane : "todo");
      return true;
    }
    // esc drops the selection, so the next a / n adds a task at the top, not a subtask
    if (name === "escape" && selected && pane !== "detail") {
      setSelectedKey(null);
      return true;
    }
    if (view === "list" && ["h", "left", "l", "right"].includes(name)) {
      moveListPane(["h", "left"].includes(name) ? -1 : 1);
      return true;
    }
    if (pane === "tree") return treeKey(name);

    if (pane === "detail") {
      const move = moveIndex(name, fileIndex, fileList.length);
      if (move !== null) {
        if (move >= 0) setFileRel(fileList[move].rel);
        return true;
      }
      if (["space", "enter"].includes(name)) {
        if (selectedFile) openFile(selectedFile);
        return true;
      }
      if (name === "d" && selectedFile) {
        deleteFile(attachments, fileList, selectedFile, setFileRel);
        return true;
      }
      if (name === "escape" && selectedFile) {
        setFileRel(null);
        return true;
      }
    }

    if (view === "board" && ["h", "left", "l", "right"].includes(name)) {
      moveBoardColumn(["h", "left"].includes(name) ? -1 : 1);
      return true;
    }
    if (view === "board" && BOARD_STATUSES.includes(pane) && name === "i") {
      openCreator(pane);
      return true;
    }
    const movable = view === "board" ? visible.filter((task) => boardStatus(task) === boardPane) : visible;
    const moveFrom = view === "board" ? movable.findIndex((task) => task.key === selectedKey) : selectedIndex;
    const move = moveIndex(name, moveFrom, movable.length);
    if (move !== null) {
      if (move >= 0) setSelectedKey(movable[move].key);
      return true;
    }
    const t = selected;
    switch (name) {
      case "e":
      case "i":
        if (t) openEditor(t);
        return true;
      case "space":
        if (t) setPeek(t);
        return true;
      case "enter":
        if (t) {
          if (view === "list") openEditor(t);
          else openFolder(t);
        }
        return true;
      case "x":
        if (t) toggleDone(t);
        return true;
      case "p":
        if (t) togglePending(t);
        return true;
      case "d":
        if (t) setConfirm(t);
        return true;
      default:
        return false;
    }
  });

  const c = data.counts;
  const crumbClass = (active) => `${styles.crumb}${active ? ` ${styles.crumbActive}` : ""}`;

  let content;
  if (!spaceTo) {
    content = (
      <div className={styles.state}>
        <p className="muted">{works === null ? t("common.loading") : t("home.pickSpace")}</p>
      </div>
    );
  } else if (missing) {
    content = (
      <div className={styles.state}>
        <p className="muted">
          {t("home.folderNotFound")}{" "}
          <button type="button" className={styles.createFolder} onClick={createSpaceFolder}>
            ({t("home.createFolder")})
          </button>
        </p>
        <p className={`mono ${styles.missingPath}`}>{missing.root}</p>
      </div>
    );
  } else if (loadError) {
    content = (
      <div className={styles.state}>
        <p className={styles.error}>{loadError}</p>
        <button type="button" className="btn" onClick={load}>
          {t("common.retry")}
        </button>
      </div>
    );
  } else if (view === "board" && !(loading && data.tasks.length === 0)) {
    // The board keeps its todo / done / pending columns even with no tasks (or none matching).
    content = (
      <TaskBoard
        tasks={visible}
        selectedKey={selected?.key}
        focusedStatus={BOARD_STATUSES.includes(pane) ? pane : null}
        onFocusStatus={setPane}
        onSelect={(t) => {
          setPane(boardStatus(t));
          setSelectedKey(t.key);
        }}
        onOpen={openEditor}
        onOpenFolder={openFolder}
        onDelete={setConfirm}
        onMove={setStatus}
      />
    );
  } else if (data.tasks.length === 0) {
    content = (
      <div className={styles.state}>
        {loading ? (
          <p className="muted">{t("common.loading")}</p>
        ) : (
          <>
            <p className="muted">{data.isRoot ? t("home.noTasks") : t("home.noSubtasks")}</p>
            {canAdd && (
              <button type="button" className="btn" onClick={() => openCreator()}>
                <PlusIcon />
                {t("header.newTask")}
              </button>
            )}
          </>
        )}
      </div>
    );
  } else if (visible.length === 0) {
    content = (
      <div className={styles.state}>
        <p className="muted">
          {query.trim()
            ? t("home.noMatch", { query })
            : t(!showDone && !showPending ? "home.onlyHidden" : !showPending ? "home.onlyPending" : "home.onlyDone")}
        </p>
      </div>
    );
  } else {
    content = (
      <div className={styles.scroll} ref={setScrollEl}>
        <TaskList
          tasks={visible}
          selectedKey={selected?.key}
          focused={pane === "tasks"}
          onSelect={(t) => setSelectedKey(t.key)}
          onOpenFolder={openFolder}
          onToggleDone={toggleDone}
        />
      </div>
    );
  }

  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <h1 className={styles.title}>taskmgr</h1>
        </div>

        <div className={styles.search}>
          <SearchIcon className={styles.searchIcon} />
          <input
            ref={searchRef}
            className={`input ${styles.searchInput}`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Escape") return;
              e.currentTarget.blur();
              if (pane !== "tree") {
                const selectedTask = tasks.find((task) => task.key === selectedKey);
                const status = selectedTask
                  ? boardStatus(selectedTask)
                  : BOARD_STATUSES.includes(pane)
                    ? pane
                    : BOARD_STATUSES[0];
                setPane(view === "board" ? status : "tasks");
              }
            }}
            placeholder={t("header.filter")}
            aria-label={t("header.filterLabel")}
          />
          {query && (
            <button
              type="button"
              className={styles.searchClear}
              onClick={() => setQuery("")}
              aria-label={t("header.clearFilter")}
            >
              <XIcon />
            </button>
          )}
        </div>

        <div className={styles.actions}>
          {!data.isRoot && (
            <button type="button" className="btn" onClick={() => goTo(data.parent || "")}>
              <ChevronLeftIcon />
              {t("header.up")}
            </button>
          )}
          <button
            type="button"
            className="btn"
            tabIndex={-1}
            onMouseDown={(e) => e.preventDefault()}
            onClick={toggleView}
            title={t(view === "board" ? "header.listView" : "header.boardView")}
            aria-label={t(view === "board" ? "header.listView" : "header.boardView")}
          >
            {view === "board" ? <ListIcon /> : <BoardIcon />}
          </button>
          <button type="button" className="btn" onClick={reload} title={t("header.refresh")} aria-label={t("header.refresh")}>
            <RefreshIcon />
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => setAnalysisOpen(true)}
            title={t("analysis.title")}
            aria-label={t("analysis.title")}
          >
            <PieIcon />
          </button>
          <div className={styles.account}>
            <LanguageSwitcher />
            <UserMenu />
          </div>
        </div>
      </header>

      <div className={styles.body}>
        <aside className={styles.drawer} data-open={treeOpen} onMouseDown={() => setPane("tree")}>
          <SpaceTree
            works={treeWorks}
            origins={origins}
            error={worksError}
            activeTo={spaceTo}
            focused={pane === "tree"}
            showHidden={showHidden}
            hiddenCount={hiddenCount}
            onShowHidden={setShowHidden}
            onSelect={(to) => selectSpace(to)}
            onEdit={() => setConfigOpen(true)}
            onAdd={setAdding}
            onEditWork={setEditingWork}
            onEditOrigin={setEditingOrigin}
            onEditRepository={setEditingRepository}
            onOpenFolder={openSpaceFolder}
            onDelete={setRemoving}
          />
        </aside>
        <button
          type="button"
          className={styles.toggle}
          onClick={toggleTreePane}
          title={t(treeOpen ? "header.hideTree" : "header.showTree")}
          aria-label={t(treeOpen ? "header.hideTree" : "header.showTree")}
        >
          {treeOpen ? <ChevronLeftIcon /> : <ChevronRightIcon />}
        </button>

        <main
          className={styles.main}
          onMouseDown={() => spaceTo && setPane("tasks")}
          // a click on the blank area (not on a task or a button) clears the selection
          onClick={(e) => {
            if (!e.target.closest('[role="button"], button, a, input, label')) setSelectedKey(null);
          }}
        >
          {(all || origin || space) && (
            <nav className={styles.section} aria-label={t("header.location")}>
              {(all || origin) && (
                <button
                  type="button"
                  className={crumbClass(!space)}
                  onClick={() => origin && space && selectSpace(api.originPath(origin))}
                  disabled={!space}
                >
                  {all ? t("tree.allOrigins") : origin}
                </button>
              )}
              {space && (
                <span className={styles.crumbItem}>
                  {origin && <span className={styles.crumbSep}>&gt;</span>}
                  <button
                    type="button"
                    className={crumbClass(!repository && data.isRoot)}
                    onClick={() => selectSpace(api.spacePath(origin, work))}
                  >
                    {work}
                  </button>
                </span>
              )}
              {repository && (
                <span className={styles.crumbItem}>
                  <span className={styles.crumbSep}>&gt;</span>
                  <button type="button" className={crumbClass(data.isRoot)} onClick={() => goTo("")}>
                    {repository}
                  </button>
                </span>
              )}
              {data.crumbs.map((cr, i) => {
                const active = i === data.crumbs.length - 1;
                return (
                  <span key={cr.rel} className={styles.crumbItem}>
                    <span className={styles.crumbSep}>&gt;</span>
                    <button type="button" className={crumbClass(active)} onClick={() => goTo(cr.rel)} disabled={active}>
                      {cr.title}
                    </button>
                  </span>
                );
              })}
            </nav>
          )}
          {spaceTo && (
            <div className={styles.listBar}>
              <MonthPicker months={months} index={monthIndex} label={(m) => monthLabel(m.key, t)} onChange={setMonth} />
              {view !== "board" && (
                <>
                  <Checkbox className={styles.showDone} checked={showDone} onChange={setShowDone}>
                    {t("header.showDone")}
                  </Checkbox>
                  <Checkbox className={styles.showDone} checked={showPending} onChange={setShowPending}>
                    {t("header.showPending")}
                  </Checkbox>
                </>
              )}
              <button
                type="button"
                className={`btn ${styles.addTask}`}
                onClick={() => openCreator()}
                disabled={!canAdd && !selected}
                title={selected ? t("header.newSubtaskOf", { name: selected.title || selected.id }) : undefined}
              >
                <PlusIcon />
                {t(selected ? "header.newSubtask" : "header.newTask")}
              </button>
            </div>
          )}
          {content}
        </main>

        <button
          type="button"
          className={styles.toggle}
          onClick={() => toggleDetailPane()}
          title={t(detailOpen ? "header.hideDetails" : "header.showDetails")}
          aria-label={t(detailOpen ? "header.hideDetails" : "header.showDetails")}
        >
          {detailOpen ? <ChevronRightIcon /> : <ChevronLeftIcon />}
        </button>
        <aside className={styles.detail} data-open={detailOpen} onMouseDown={() => setPane("detail")} onFocus={() => setPane("detail")}>
          {spaceTo && (
            <TaskPanel
              task={selected}
              focused={pane === "detail"}
              focusKey={focusKey}
              onFocused={() => setFocusKey(null)}
              onSave={saveText}
              onDelete={setConfirm}
              onPreview={(file) => selected && setPreview({ ...file, space: selected.space })}
              attachments={attachments}
              selectedFile={selectedFile?.rel}
            />
          )}
        </aside>
      </div>

      <footer className={styles.statusBar}>
        {command !== null ? (
          <CommandLine
            value={command}
            onChange={setCommand}
            onCancel={() => setCommand(null)}
            onRun={() => {
              setCommand(null);
              runCommand(command);
            }}
          />
        ) : (
          <>
            <span>
              {t("status.todo")} {c.todo}
            </span>
            <span>
              {t("status.done")} {c.done}
            </span>
            <span>
              {t("status.pending")} {c.pending}
            </span>
            <span className={`mono ${styles.path}`} title={data.remote ? t("tree.remote") : data.absDir}>
              {data.remote ? t("tree.remote") : data.absDir}
            </span>
          </>
        )}
      </footer>

      <ConfigEditorModal
        isOpen={configOpen}
        onClose={() => setConfigOpen(false)}
        onSaved={(d) => {
          setConfigOpen(false);
          setSpaces(d);
          showToast(t("config.saved"));
        }}
      />

      <WorkEditModal
        work={editingWork}
        onClose={() => setEditingWork(null)}
        onSaved={(d, newName) => {
          const oldName = editingWork.work;
          setEditingWork(null);
          setSpaces(d);
          // Follow the rename when the space on the right is this work or one of its repositories.
          if (newName !== oldName && work === oldName)
            navigate(
              { pathname: api.spacePath(editingWork.origin || origin, newName, repository), search: searchParams.toString() },
              { replace: true },
            );
          showToast(t("work.saved"));
        }}
      />

      <WorkEditModal
        origin={editingOrigin}
        onClose={() => setEditingOrigin(null)}
        onSaved={(d, newName) => {
          const oldName = editingOrigin.origin;
          setEditingOrigin(null);
          setSpaces(d);
          // Follow the rename when the origin is the one on the right.
          if (newName !== oldName && origin === oldName)
            navigate(work ? api.spacePath(newName, work, repository) : api.originPath(newName), { replace: true });
          showToast(t("origin.saved"));
        }}
      />

      <AddSpaceModal
        add={adding}
        origins={origins}
        works={works}
        onClose={() => setAdding(null)}
        onSaved={(d, added) => {
          setAdding(null);
          setSpaces(d);
          // Open what was added on the right.
          const to =
            added.type === "origin"
              ? api.originPath(added.name)
              : added.type === "work"
                ? api.spacePath(added.origin, added.name)
                : api.spacePath(d.works.find((item) => item.work === added.work)?.origin || "", added.work, added.name);
          selectSpace(to);
          showToast(t(`${added.type}.added`));
        }}
      />

      <RepositoryEditModal
        repository={editingRepository}
        onClose={() => setEditingRepository(null)}
        onSaved={(d, newName) => {
          const { work: inWork, name } = editingRepository;
          setEditingRepository(null);
          setSpaces(d);
          // Follow a rename when the repository is the one on the right.
          const inOrigin = (works || []).find((item) => item.work === inWork)?.origin || "";
          if (spaceTo === api.spacePath(inOrigin, inWork, name))
            navigate({ pathname: api.spacePath(inOrigin, inWork, newName), search: searchParams.toString() }, { replace: true });
          showToast(t("repository.saved"));
        }}
      />

      <IncomeAnalysisModal isOpen={analysisOpen} works={works} origins={origins} onClose={() => setAnalysisOpen(false)} />

      <HelpModal isOpen={help} onClose={() => setHelp(false)} />

      <TaskEditorModal
        isOpen={!!creating}
        space={creating?.space}
        parent={creating?.parent}
        saving={saving}
        onCancel={() => setCreating(null)}
        onSave={saveEditor}
        onPreview={(file) => setPreview({ ...file, space: creating.space })}
      />

      <TaskPreviewModal task={peekTask} editing={peekEditing} onEdit={() => setPeekEditing(true)} onEndEdit={() => setPeekEditing(false)} onSave={saveText} onOpenFile={(file) => openFile(file, peek)} files={peekFiles} selectedRel={peekFile?.rel} onUnselect={() => setPeekFileRel(null)} onClose={() => { setPeek(null); setPeekFileRel(null); setPeekEditing(false); }} />

      {/* after the task preview, so it stacks in front of it */}
      <FilePreviewModal space={preview?.space} file={preview} onClose={() => setPreview(null)} />

      <ConfirmModal
        isOpen={!!removingFile}
        title={t("attach.deleteTitle")}
        message={removingFile ? t("attach.deleteConfirm", { name: removingFile.file.name }) : ""}
        onCancel={() => setRemovingFile(null)}
        onConfirm={confirmDeleteFile}
      />

      <ConfirmModal
        isOpen={!!confirm}
        title={t("delete.title")}
        message={confirm ? t("delete.message", { name: confirm.title || confirm.id }) : ""}
        busy={deleting}
        onCancel={() => setConfirm(null)}
        onConfirm={confirmDelete}
      />

      <ConfirmModal
        isOpen={!!removing}
        title={t(removing?.origin ? "origin.delete" : removing?.repository ? "repository.delete" : "work.delete")}
        message={
          removing
            ? t(
                removing.origin
                  ? "origin.deleteMessage"
                  : removing.repository
                    ? "repository.deleteMessage"
                    : "work.deleteMessage",
                {
                  name: removing.origin || removing.repository || removing.work,
                },
              )
            : ""
        }
        typeToConfirm={removing?.origin}
        busy={deleting}
        onCancel={() => setRemoving(null)}
        onConfirm={confirmRemove}
      />
    </div>
  );
}

// Vim-style command line in the status bar: enter runs, esc (or backspace on empty) leaves.
function CommandLine({ value, onChange, onCancel, onRun }) {
  const { t } = useTranslation();
  return (
    <span className={`mono ${styles.command}`}>
      :
      <input
        className={styles.commandInput}
        value={value}
        autoFocus
        onChange={(e) => onChange(e.target.value)}
        onBlur={onCancel}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onRun();
          } else if (e.key === "Escape" || (e.key === "Backspace" && !value)) {
            e.preventDefault();
            onCancel();
          }
        }}
        aria-label={t("home.command")}
      />
    </span>
  );
}
