// Live race standings, shared by the big screen and the phones.
// Rows are reused so a scrolled list keeps its position as scores change.
export function renderStandings(list, rows, standings, meId = null) {
  const ids = new Set(standings.map((s) => s.id));
  for (const [id, row] of rows) {
    if (!ids.has(id)) {
      row.li.remove();
      rows.delete(id);
    }
  }
  standings.forEach((s, i) => {
    let row = rows.get(s.id);
    if (!row) {
      const li = document.createElement('li');
      const dot = document.createElement('span');
      dot.className = 'dot';
      const name = document.createElement('span');
      name.className = 'name';
      const score = document.createElement('span');
      score.className = 'score';
      li.append(dot, name, score);
      row = { li, dot, name, score };
      rows.set(s.id, row);
    }
    row.dot.style.background = s.color;
    row.li.classList.toggle('me', s.id === meId);
    if (row.name.textContent !== s.name) row.name.textContent = s.name;
    const text = `${s.score} · 💥 ${s.crashes}`;
    if (row.score.textContent !== text) row.score.textContent = text;
    if (list.children[i] !== row.li) list.insertBefore(row.li, list.children[i] ?? null);
  });
}

export function byScore(a, b) {
  return b.score - a.score || a.crashes - b.crashes || a.name.localeCompare(b.name);
}

// Tapping the title hides or shows the list. Each device remembers its choice;
// storage can be blocked (private mode), so it falls back to the default.
export function minimizable(section, toggle, key, startMin = false) {
  const set = (min) => {
    section.classList.toggle('min', min);
    toggle.setAttribute('aria-expanded', String(!min));
  };
  let stored = null;
  try {
    stored = localStorage.getItem(key);
  } catch {
    // use the default
  }
  set(stored == null ? startMin : stored === '1');
  toggle.addEventListener('click', () => {
    const min = !section.classList.contains('min');
    set(min);
    try {
      localStorage.setItem(key, min ? '1' : '0');
    } catch {
      // not remembered, that's fine
    }
  });
}
