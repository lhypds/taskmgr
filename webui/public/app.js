/* taskmgr web UI - mirrors the CLI keybindings and behaviour. */
(function () {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const listEl = $('#list');
  const emptyEl = $('#empty');
  const headerEl = $('#header');
  const statusEl = $('#statusbar');

  const state = {
    root: '',
    editor: '',
    dir: '',           // relative to root ('' = root)
    isRoot: true,
    parent: null,
    tasks: [],
    counts: { todo: 0, done: 0, pending: 0 },
    selected: 0,
    modal: null,       // 'preview' | 'editor' | 'folder' | 'confirm' | 'help'
    editing: null,     // { rel, isNew, original }
    folderTask: null
  };

  // ---------- api ----------

  async function api(method, url, body) {
    const opts = { method, headers: {} };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(url, opts);
    let data = null;
    try { data = await res.json(); } catch (e) { /* no body */ }
    if (!res.ok) throw new Error((data && data.error) || `HTTP ${res.status}`);
    return data;
  }

  // ---------- toast ----------

  let toastTimer = null;
  function toast(msg, isError) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.toggle('error', !!isError);
    el.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), isError ? 4000 : 1800);
  }

  // ---------- rendering ----------

  function padDisplay(s, width) {
    // mimic CLI column: CJK counts as width 2
    s = (s || '').toString().trim();
    let out = '', cur = 0;
    for (const ch of s) {
      const w = /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u.test(ch) ? 2 : 1;
      if (cur + w > width) break;
      out += ch; cur += w;
    }
    return out + ' '.repeat(Math.max(0, width - cur));
  }

  function checkFor(t) {
    if (t.status === 'done') return '[x]';
    if (t.status === 'pending') return '[p]';
    return t.hasSubtask ? '[+]' : '[ ]';
  }

  function renderList() {
    listEl.innerHTML = '';
    const tasks = state.tasks;
    const showEmpty = tasks.length === 0 && state.isRoot;
    emptyEl.classList.toggle('hidden', !showEmpty);
    headerEl.classList.toggle('hidden', showEmpty);
    listEl.classList.toggle('hidden', showEmpty);

    tasks.forEach((t, i) => {
      const row = document.createElement('div');
      row.className = 'row ' + t.status + (i === state.selected ? ' selected' : '');
      row.dataset.index = i;
      row.innerHTML =
        `<span class="col-check"></span><span class="col-id"></span>` +
        `<span class="col-origin"></span><span class="col-edit"></span><span class="col-title"></span>`;
      row.children[0].textContent = checkFor(t);
      row.children[1].textContent = t.id;
      row.children[2].textContent = padDisplay(t.origin, 8);
      row.children[3].textContent = t.last_edit;
      row.children[4].textContent = t.title;
      row.title = t.labels ? `labels: ${t.labels}` : '';
      row.addEventListener('click', () => select(i));
      row.addEventListener('dblclick', () => { select(i); openPreview(); });
      listEl.appendChild(row);
    });
    scrollSelectedIntoView();
    renderStatus();
  }

  function renderStatus() {
    const c = state.counts;
    const abs = state.dir ? `${state.root}/${state.dir}` : state.root;
    statusEl.textContent = `todo:${c.todo} done:${c.done} pending:${c.pending} \`${abs}\` ${state.editor}`;
  }

  function scrollSelectedIntoView() {
    const el = listEl.querySelector('.row.selected');
    if (el) el.scrollIntoView({ block: 'nearest' });
  }

  function select(i) {
    if (!state.tasks.length) return;
    const next = Math.max(0, Math.min(state.tasks.length - 1, i));
    const prev = listEl.querySelector('.row.selected');
    if (prev) prev.classList.remove('selected');
    state.selected = next;
    const el = listEl.querySelector(`.row[data-index="${next}"]`);
    if (el) el.classList.add('selected');
    scrollSelectedIntoView();
  }

  function current() {
    return state.tasks[state.selected] || null;
  }

  // ---------- data ----------

  async function load(dir, selectedIndex, selectRel) {
    try {
      const data = await api('GET', `/api/tasks?dir=${encodeURIComponent(dir || '')}`);
      state.dir = data.dir;
      state.isRoot = data.isRoot;
      state.parent = data.parent;
      state.tasks = data.tasks;
      state.counts = data.counts;
      let sel = (typeof selectedIndex === 'number') ? selectedIndex : state.selected;
      if (selectRel) {
        const idx = state.tasks.findIndex(t => t.rel === selectRel);
        if (idx >= 0) sel = idx;
      }
      state.selected = Math.max(0, Math.min(state.tasks.length - 1, sel));
      renderList();
    } catch (e) {
      toast(e.message, true);
    }
  }

  function refresh(selectRel) {
    return load(state.dir, state.selected, selectRel);
  }

  // ---------- actions ----------

  async function toggleStatus(kind) {
    const t = current();
    if (!t) return;
    const next = (t.status === kind) ? 'todo' : kind;
    try {
      await api('POST', '/api/task/status', { rel: t.rel, status: next });
      await refresh(t.rel);
    } catch (e) { toast(e.message, true); }
  }

  function enterFolder() {
    const t = current();
    if (!t) return;
    load(t.rel, 0);
  }

  function goUp() {
    if (state.isRoot) return;
    const leaving = state.dir;
    load(state.parent || '', 0, leaving);
  }

  async function addTask() {
    try {
      const data = await api('POST', '/api/tasks', { dir: state.dir });
      openEditor(data.task, data.content, true);
    } catch (e) { toast(e.message, true); }
  }

  async function editTask() {
    const t = current();
    if (!t) return;
    try {
      const data = await api('GET', `/api/task?rel=${encodeURIComponent(t.rel)}`);
      openEditor(data.task, data.content, false);
    } catch (e) { toast(e.message, true); }
  }

  async function deleteCurrent() {
    const t = current();
    if (!t) return;
    try {
      await api('DELETE', `/api/task?rel=${encodeURIComponent(t.rel)}`);
      closeModal();
      await load(state.dir, Math.max(0, state.selected - 1));
    } catch (e) { toast(e.message, true); }
  }

  async function openInOS(task) {
    const t = task || current();
    if (!t) return;
    try {
      await api('POST', '/api/task/open', { rel: t.rel });
      toast('Opened in file manager');
    } catch (e) { toast(e.message, true); }
  }

  async function quit() {
    try {
      await api('POST', '/api/quit');
    } catch (e) {
      // server may close the connection before replying; treat as quit
    }
    document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
    state.modal = 'quit';
    $('#quit').classList.remove('hidden');
    try { window.close(); } catch (e) { /* only works for script-opened windows */ }
  }

  // ---------- modals ----------

  function showModal(name) {
    state.modal = name;
    $(`#modal-${name}`).classList.remove('hidden');
  }

  function closeModal() {
    if (!state.modal) return;
    $(`#modal-${state.modal}`).classList.add('hidden');
    state.modal = null;
    state.editing = null;
    state.folderTask = null;
    listEl.focus();
  }

  function trimDetails(raw) {
    const lines = (raw || '').split('\n');
    let start = 0, end = lines.length;
    while (start < end && lines[start].trim() === '') start++;
    while (end > start && lines[end - 1].trim() === '') end--;
    return lines.slice(start, end).map(l => l.trim()).join('\n');
  }

  function openPreview() {
    const t = current();
    if (!t) return;
    $('#preview-content').textContent = trimDetails(t.details);
    showModal('preview');
  }

  function openEditor(task, content, isNew) {
    state.editing = { rel: task.rel, isNew, original: content };
    $('#editor-title').textContent = `${isNew ? 'New task' : 'Edit task'}  ${task.rel}/task.txt`;
    const ta = $('#editor-text');
    ta.value = content;
    showModal('editor');
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }

  async function saveEditor() {
    const ed = state.editing;
    if (!ed) return;
    try {
      const data = await api('PUT', '/api/task', { rel: ed.rel, content: $('#editor-text').value });
      closeModal();
      await refresh(data.task.rel);
      toast('Saved');
    } catch (e) { toast(e.message, true); }
  }

  async function cancelEditor() {
    const ed = state.editing;
    if (!ed) return;
    if (ed.isNew && $('#editor-text').value === ed.original) {
      // brand new task with nothing typed: discard it (CLI would leave an empty task behind)
      try { await api('DELETE', `/api/task?rel=${encodeURIComponent(ed.rel)}`); } catch (e) { /* ignore */ }
      closeModal();
      await refresh();
      return;
    }
    if (ed.isNew) {
      // keep the created task even if the user cancels, like the CLI, but reflect it in the list
      closeModal();
      await refresh(ed.rel);
      return;
    }
    closeModal();
  }

  function fmtSize(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
  }

  async function openFolder() {
    const t = current();
    if (!t) return;
    try {
      const data = await api('GET', `/api/task?rel=${encodeURIComponent(t.rel)}`);
      state.folderTask = data.task;
      $('#folder-title').textContent = `${state.root}/${data.task.rel}`;
      const ul = $('#folder-files');
      ul.innerHTML = '';
      const li0 = document.createElement('li');
      const a0 = document.createElement('a');
      a0.href = `/api/file?rel=${encodeURIComponent(data.task.rel + '/task.txt')}`;
      a0.target = '_blank';
      a0.textContent = 'task.txt';
      li0.appendChild(a0);
      ul.appendChild(li0);
      if (!data.files.length) {
        const li = document.createElement('li');
        li.className = 'meta';
        li.textContent = '(no attachments)';
        ul.appendChild(li);
      }
      for (const f of data.files) {
        const li = document.createElement('li');
        if (f.isDir) {
          const span = document.createElement('span');
          span.textContent = f.name + '/';
          li.appendChild(span);
          const meta = document.createElement('span');
          meta.className = 'meta';
          meta.textContent = f.isSubtask ? 'subtask' : 'folder';
          li.appendChild(meta);
        } else {
          const a = document.createElement('a');
          a.href = `/api/file?rel=${encodeURIComponent(f.rel)}`;
          a.target = '_blank';
          a.textContent = f.name;
          li.appendChild(a);
          const meta = document.createElement('span');
          meta.className = 'meta';
          meta.textContent = fmtSize(f.size);
          li.appendChild(meta);
        }
        ul.appendChild(li);
      }
      showModal('folder');
    } catch (e) { toast(e.message, true); }
  }

  function openConfirm() {
    const t = current();
    if (!t) return;
    $('#confirm-text').textContent = `Delete task ${t.id} "${t.title}"? This removes the whole folder.`;
    showModal('confirm');
  }

  // ---------- keyboard ----------

  document.addEventListener('keydown', (ev) => {
    const key = ev.key;
    const mod = ev.ctrlKey || ev.metaKey;

    if (state.modal === 'editor') {
      if (mod && key.toLowerCase() === 's') { ev.preventDefault(); saveEditor(); }
      else if (key === 'Escape') { ev.preventDefault(); cancelEditor(); }
      return;
    }

    if (state.modal === 'confirm') {
      if (key === 'y' || key === 'Enter') { ev.preventDefault(); deleteCurrent(); }
      else if (key === 'n' || key === 'Escape' || key === 'q') { ev.preventDefault(); closeModal(); }
      return;
    }

    if (state.modal === 'preview') {
      if ([' ', 'Escape', 'q', 'Enter'].includes(key)) { ev.preventDefault(); closeModal(); }
      else if (key === 'e' || key === 'i') { ev.preventDefault(); closeModal(); editTask(); }
      return;
    }

    if (state.modal === 'folder') {
      if (['Escape', 'q', 'Enter'].includes(key)) { ev.preventDefault(); closeModal(); }
      else if (key === 'o') { ev.preventDefault(); openInOS(state.folderTask); }
      return;
    }

    if (state.modal === 'quit') return;

    if (state.modal === 'help') {
      if (['Escape', 'q', '?'].includes(key)) { ev.preventDefault(); closeModal(); }
      return;
    }

    if (mod || ev.altKey) return;
    if (ev.target && /^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName)) return;

    switch (key) {
      case 'j': case 'ArrowDown': ev.preventDefault(); select(state.selected + 1); break;
      case 'k': case 'ArrowUp': ev.preventDefault(); select(state.selected - 1); break;
      case 'l': case 'ArrowRight': ev.preventDefault(); enterFolder(); break;
      case 'h': case 'ArrowLeft': ev.preventDefault(); goUp(); break;
      case 'g': ev.preventDefault(); select(0); break;
      case 'G': ev.preventDefault(); select(state.tasks.length - 1); break;
      case 'a': ev.preventDefault(); addTask(); break;
      case 'e': case 'i': ev.preventDefault(); editTask(); break;
      case ' ': ev.preventDefault(); openPreview(); break;
      case 'Enter': ev.preventDefault(); openFolder(); break;
      case 'o': ev.preventDefault(); openInOS(); break;
      case 'x': ev.preventDefault(); toggleStatus('done'); break;
      case 'p': ev.preventDefault(); toggleStatus('pending'); break;
      case 'd': ev.preventDefault(); openConfirm(); break;
      case 'r': ev.preventDefault(); refresh(); break;
      case 'q': ev.preventDefault(); quit(); break;
      case '?': ev.preventDefault(); showModal('help'); break;
      default: break;
    }
  });

  // ---------- mouse ----------

  $('#editor-save').addEventListener('click', saveEditor);
  $('#editor-cancel').addEventListener('click', cancelEditor);
  $('#folder-open').addEventListener('click', () => openInOS(state.folderTask));
  $('#confirm-yes').addEventListener('click', deleteCurrent);
  $('#confirm-no').addEventListener('click', closeModal);

  // click on backdrop closes non-editor modals
  document.querySelectorAll('.modal').forEach(m => {
    m.addEventListener('click', (ev) => {
      if (ev.target === m && state.modal && state.modal !== 'editor') closeModal();
    });
  });

  // ---------- init ----------

  (async function init() {
    try {
      const s = await api('GET', '/api/settings');
      state.root = s.root;
      state.editor = s.editor || '';
      document.title = `taskmgr - ${s.root}`;
    } catch (e) { toast(e.message, true); }
    await load('', 0);
    listEl.focus();
  })();
})();
