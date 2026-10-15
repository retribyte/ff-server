#!/usr/bin/env python3
"""
Local GUI editor for the FF4-relevance-scores.md table.

Parses the markdown table (which is split across several repeated
header blocks in the source file), serves an editable, sortable view
of it in your browser, and writes edited scores out to a NEW file —
the source file is never modified.

Also doubles as an editor for FF4's messageBlacklist: each row is matched
(by text, since the row's own "Line" numbering is a separate, unrelated
counter) to a message in the current archive-to-markdown/api/ff4/*.json
output for its episode, giving it a messageNo — the same numbering
discord-json-to-api.py uses for messageBlacklist entries and the site's
GET /episodes/:title/messages/:messageNo. Checking a row's box and saving
writes that messageNo into meta/ff4.json's messageBlacklist array for the
row's episode (creating the array if needed) — this DOES modify meta/ff4.json
in place, unlike the score save above.

Row/message matching is best-effort: the relevance-scores.md table was
generated once against an earlier pipeline output and has since drifted
(attribution fixes reclassify some messages out of OTHER, wording tweaks,
etc). Rows that can't be confidently matched get a disabled checkbox rather
than a guessed messageNo.

Usage:
    python3 ff4_score_editor.py [path/to/FF4-relevance-scores.md]

No third-party dependencies (stdlib only: http.server, webbrowser, json).
"""

import http.server
import json
import re
import sys
import webbrowser
from pathlib import Path

SOURCE = Path(sys.argv[1] if len(sys.argv) > 1 else "FF4-relevance-scores.md")
OUTPUT_DEFAULT = SOURCE.with_name(SOURCE.stem + "-edited" + SOURCE.suffix)

CELL_SPLIT = re.compile(r"(?<!\\)\|")
LINE_NUM = re.compile(r"^\d+$")
EPISODE_HEADER = re.compile(r"^#\s*Episode\s+(\d+)\s*(?:[—–-]\s*(.*))?$")
QUOTE_MAP = str.maketrans({"“": '"', "”": '"', "‘": "'", "’": "'"})

# Sibling repo directory name varies by machine — try both.
def find_site_dir():
    for name in ("ff-site-new", "ff-site"):
        candidate = SOURCE.resolve().parent.parent / name
        if (candidate / "archive-to-markdown" / "meta" / "ff4.json").exists():
            return candidate
    return None


SITE_DIR = find_site_dir()
META_PATH = SITE_DIR / "archive-to-markdown" / "meta" / "ff4.json" if SITE_DIR else None
API_DIR = SITE_DIR / "archive-to-markdown" / "api" / "ff4" if SITE_DIR else None

# Each element of `document` is either:
#   {"type": "raw", "text": "<original line, unchanged on save>"}
#   {"type": "row", "line": int, "speaker": str, "message": str,
#    "score": int, "reasoning": str, "episode": int|None,
#    "blacklistable": bool, "messageNo": int|None, "blacklisted": bool}
document = []

# Populated by load_blacklist_context(): per-episode existing messageBlacklist
# entries that no visible row maps to (must be preserved verbatim on save).
unmapped_existing = {}
# Episodes whose meta messageBlacklist was already non-empty at load time —
# numbering may have shifted if api/ff4 was regenerated since (see module
# docstring / README), so we refuse to add further entries there blind.
untrusted_episodes = set()
episode_titles = {}  # episode_number -> title, from meta/ff4.json


def load():
    document.clear()
    raw_lines = SOURCE.read_text(encoding="utf-8").splitlines()
    cur_ep = None
    for text in raw_lines:
        row = None
        if text.startswith("|"):
            parts = CELL_SPLIT.split(text)
            if len(parts) == 7:
                fields = [p.strip() for p in parts[1:-1]]
                if LINE_NUM.match(fields[0]):
                    m = EPISODE_HEADER.match(fields[2])
                    if m:
                        cur_ep = int(m.group(1))
                    blacklistable = not (fields[1] == "—" and (m or fields[2].strip() == ""))
                    row = {
                        "type": "row",
                        "line": int(fields[0]),
                        "speaker": fields[1],
                        "message": fields[2],
                        "score": fields[3],
                        "reasoning": fields[4],
                        "episode": cur_ep if blacklistable else None,
                        "blacklistable": blacklistable,
                        "messageNo": None,
                        "blacklisted": False,
                    }
        document.append(row if row else {"type": "raw", "text": text})


def rows():
    return [r for r in document if r["type"] == "row"]


def _norm(s):
    return (s or "").strip().translate(QUOTE_MAP)


def _text_matches(md_text, json_text):
    md_text = _norm(md_text)
    json_text = _norm(json_text)
    stripped = md_text.rstrip(".…").rstrip()
    if md_text.endswith("...") or md_text.endswith("…"):
        if not stripped:
            return md_text == json_text
        return json_text.startswith(stripped)
    return md_text == json_text


def _episode_files():
    if not API_DIR or not API_DIR.is_dir():
        return {}
    files = {}
    for f in API_DIR.glob("*.json"):
        head = f.stem.split("_", 1)[0]
        if LINE_NUM.match(head):
            files[int(head)] = f
    return files


def _lcs_align(a_texts, b_texts, matches_fn):
    """Longest-common-subsequence alignment of two ordered text sequences
    under a fuzzy (non-transitive) match predicate. Returns {a-index:
    b-index} for each aligned pair.

    A greedy nearest-in-a-lookahead-window walk (the previous approach here)
    breaks whenever the same text recurs more than once nearby: it can latch
    onto a same-text occurrence that's further away than it looks (OTHER
    messages are sparse, so a handful of list-positions can span a huge
    messageNo gap), which permanently skips every genuine match in between
    for the rest of that stretch. LCS finds the alignment that maximizes
    total matches subject to both sequences staying in order, so it isn't
    fooled by a duplicate text sitting further down the list.

    Because the match predicate is fuzzy (truncated `...` rows only need to
    match a prefix, so one row can satisfy multiple candidates), a match
    isn't always safe to take unconditionally the way plain LCS assumes --
    unlike equality, "a matches b" here doesn't guarantee taking it is never
    worse than skipping it. So this computes max(skip-a, skip-b, take) at
    every cell instead of force-taking on a match, which is the general
    (and here, necessary) form of the DP."""
    n, m = len(a_texts), len(b_texts)
    dp = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n - 1, -1, -1):
        for j in range(m - 1, -1, -1):
            best = dp[i + 1][j] if dp[i + 1][j] > dp[i][j + 1] else dp[i][j + 1]
            if matches_fn(a_texts[i], b_texts[j]):
                take = dp[i + 1][j + 1] + 1
                if take > best:
                    best = take
            dp[i][j] = best
    mapping = {}
    i = j = 0
    while i < n and j < m:
        if matches_fn(a_texts[i], b_texts[j]) and dp[i][j] == dp[i + 1][j + 1] + 1:
            mapping[i] = j
            i += 1
            j += 1
        elif dp[i + 1][j] >= dp[i][j + 1]:
            i += 1
        else:
            j += 1
    return mapping


def match_message_numbers():
    """Assign messageNo to each blacklistable row by LCS-aligning, per
    episode, the row's message text against that episode's OTHER-type
    messages in the current converted output."""
    files = _episode_files()
    by_ep = {}
    for r in rows():
        if r["blacklistable"] and r["episode"] is not None:
            by_ep.setdefault(r["episode"], []).append(r)

    for ep, ep_rows in by_ep.items():
        f = files.get(ep)
        if not f:
            for r in ep_rows:
                r["blacklistable"] = False
            continue
        data = json.loads(f.read_text(encoding="utf-8"))
        other = [
            (i + 1, m.get("text", ""))
            for i, m in enumerate(data["messages"])
            if m.get("type") == "OTHER"
        ]
        other_texts = [text for _, text in other]
        row_texts = [r["message"] for r in ep_rows]
        mapping = _lcs_align(row_texts, other_texts, _text_matches)
        for idx, r in enumerate(ep_rows):
            if idx in mapping:
                r["messageNo"] = other[mapping[idx]][0]
            else:
                r["blacklistable"] = False


def load_blacklist_context():
    """Read meta/ff4.json's existing messageBlacklist entries, mark them
    checked on any row that maps to them, and stash any that don't map to
    a visible row so save() can preserve them."""
    unmapped_existing.clear()
    untrusted_episodes.clear()
    episode_titles.clear()
    if not META_PATH:
        return
    meta = json.loads(META_PATH.read_text(encoding="utf-8"))
    by_ep_rows = {}
    for r in rows():
        if r["blacklistable"] and r["messageNo"] is not None:
            by_ep_rows.setdefault(r["episode"], {})[r["messageNo"]] = r

    for ep in meta.get("episodes", []):
        num = ep.get("episode_number")
        episode_titles[num] = ep.get("title")
        existing = set(ep.get("messageBlacklist") or [])
        if not existing:
            continue
        mapped_rows = by_ep_rows.get(num, {})
        matched_nos = set()
        for no, r in mapped_rows.items():
            if no in existing:
                r["blacklisted"] = True
                matched_nos.add(no)
        leftover = existing - matched_nos
        if leftover:
            unmapped_existing[num] = leftover
        # We can't verify api/ff4 was regenerated *after* this blacklist was
        # last applied, so a non-empty existing list means we can't trust
        # messageNo alignment for this episode without stronger evidence.
        untrusted_episodes.add(num)


def save(edits, out_path):
    by_line = {r["idx"]: r["score"] for r in edits}
    i = 0
    out_lines = []
    for item in document:
        if item["type"] == "raw":
            out_lines.append(item["text"])
        else:
            score = by_line.get(i, item["score"])
            out_lines.append(
                f"| {item['line']} | {item['speaker']} | {item['message']} | {score} | {item['reasoning']} |"
            )
            i += 1
    Path(out_path).write_text("\n".join(out_lines) + "\n", encoding="utf-8")


EPISODE_NUM_FIELD = re.compile(r'"episode_number"\s*:\s*(-?\d+)\s*(?=[,\n\s}])')
BLACKLIST_FIELD = re.compile(r'"messageBlacklist"\s*:\s*\[[^\]]*\]')


def _patch_episode_block(text, episode_number, new_list):
    """Text-level surgery on one episode object in meta/ff4.json's raw
    source, so a save only touches that episode's messageBlacklist line(s)
    -- a full json.load()/json.dumps() round-trip would reformat unrelated
    hand-formatted JSON elsewhere in the file (e.g. personaTimeline's
    one-line entries) into a giant, unreviewable diff."""
    matches = [
        m for m in EPISODE_NUM_FIELD.finditer(text) if int(m.group(1)) == episode_number
    ]
    if len(matches) != 1:
        raise RuntimeError(
            f'expected exactly one "episode_number": {episode_number} in meta/ff4.json, '
            f"found {len(matches)}"
        )
    m = matches[0]
    obj_start = text.rfind("{", 0, m.start())
    obj_end = text.find("}", m.end())
    if obj_start == -1 or obj_end == -1:
        raise RuntimeError(f"could not locate object bounds for episode {episode_number}")
    block = text[obj_start : obj_end + 1]

    line_start = text.rfind("\n", 0, obj_start) + 1
    base_indent = text[line_start:obj_start]
    field_indent = base_indent + "    "

    if new_list:
        new_field = '"messageBlacklist": [' + ", ".join(str(n) for n in new_list) + "]"
        if BLACKLIST_FIELD.search(block):
            new_block = BLACKLIST_FIELD.sub(new_field, block, count=1)
        else:
            close_idx = block.rfind("}")
            pre = block[:close_idx].rstrip()
            if not pre.endswith(","):
                pre += ","
            new_block = pre + "\n" + field_indent + new_field + "\n" + base_indent + "}"
    else:
        new_block = re.sub(r",?\s*\n\s*" + BLACKLIST_FIELD.pattern, "", block, count=1)

    json.loads(new_block)  # fail loudly rather than write out malformed JSON
    return text[:obj_start] + new_block + text[obj_end + 1 :]


def save_blacklist(entries, expected_mtime=None):
    """entries: list of {"ep": int, "messageNo": int} currently checked in
    the UI. Merges with any pre-existing entries the UI couldn't map to a
    visible row, then writes meta/ff4.json in place.

    expected_mtime: the file's mtime as of when the page that's saving was
    loaded. If someone else (another tab, a script) has written the file
    since, this save's "every episode the UI knows about" full-state
    overwrite would silently clobber those changes -- reject it instead of
    guessing. None skips the check (server-side/scripted callers that just
    re-read the file themselves)."""
    if not META_PATH:
        raise RuntimeError("could not locate ff-site/ff-site-new's meta/ff4.json")
    if expected_mtime is not None:
        actual = META_PATH.stat().st_mtime
        if abs(actual - expected_mtime) > 1e-6:
            raise RuntimeError(
                "meta/ff4.json changed since this page loaded (another tab or process "
                "saved in the meantime) — reload the page and redo your checks before saving"
            )

    checked_by_ep = {}
    for e in entries:
        checked_by_ep.setdefault(e["ep"], set()).add(e["messageNo"])

    # Every episode the UI displayed rows for is in scope for this save —
    # not just ones with a checked box — so unchecking every box in an
    # episode still clears its messageBlacklist instead of being silently
    # skipped (nothing in `entries` would otherwise reference it at all).
    doc_episodes = {r["episode"] for r in rows() if r["episode"] is not None}

    text = META_PATH.read_text(encoding="utf-8")
    meta = json.loads(text)  # only for reading current per-episode state
    by_num = {ep.get("episode_number"): ep for ep in meta.get("episodes", [])}

    touched = []
    for num in sorted(doc_episodes | set(unmapped_existing)):
        ep = by_num.get(num)
        if ep is None:
            continue
        new_set = set(checked_by_ep.get(num, set())) | unmapped_existing.get(num, set())
        if new_set == set(ep.get("messageBlacklist") or []):
            continue
        text = _patch_episode_block(text, num, sorted(new_set))
        touched.append(num)

    if touched:
        json.loads(text)  # whole-file sanity check before touching disk
        META_PATH.write_text(text, encoding="utf-8")
    return touched, META_PATH.stat().st_mtime


PAGE = """<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>FF4 Relevance Score Editor</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 0; background: #1e1e1e; color: #ddd; }
  #toolbar { position: sticky; top: 0; background: #2a2a2a; padding: 10px 14px; display: flex;
             gap: 10px; align-items: center; border-bottom: 1px solid #444; z-index: 2; flex-wrap: wrap; }
  #toolbar input[type=text] { padding: 5px 8px; border-radius: 4px; border: 1px solid #555;
             background: #1e1e1e; color: #ddd; width: 320px; }
  button { padding: 6px 14px; border-radius: 4px; border: 1px solid #555; background: #3a3a3a;
           color: #ddd; cursor: pointer; }
  button:hover { background: #4a4a4a; }
  #status, #blStatus { color: #8f8; }
  #warning { color: #e0a030; padding: 6px 14px; font-size: 13px; background: #2a2418;
             border-bottom: 1px solid #444; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #3a3a3a; padding: 4px 8px; text-align: left; font-size: 13px; vertical-align: top; }
  th { position: sticky; top: 45px; background: #2a2a2a; cursor: pointer; user-select: none; z-index: 1; }
  th:hover { background: #3a3a3a; }
  th.nosort { cursor: default; }
  th.nosort:hover { background: #2a2a2a; }
  th.sorted::after { content: attr(data-arrow); margin-left: 4px; }
  td.line, td.score, td.blacklist { text-align: center; width: 60px; }
  td.speaker { width: 110px; }
  td.reasoning { width: 260px; color: #aaa; }
  tr:nth-child(even) { background: #242424; }
  input.score-input { width: 42px; text-align: center; background: #1e1e1e; color: #fff;
             border: 1px solid #555; border-radius: 3px; padding: 3px; font-size: 13px; }
  input.score-input:focus { border-color: #7ab; outline: none; }
  input.score-input.dirty { border-color: #e0a030; background: #332a1a; }
  input.bl-checkbox { width: 16px; height: 16px; cursor: pointer; }
</style>
</head>
<body>
<div id="toolbar">
  <button id="saveBtn">Save scores to new file</button>
  <input type="text" id="outPath" value="__OUTPUT_DEFAULT__">
  <span id="status"></span>
  <span style="flex: 1"></span>
  <button id="saveBlBtn">Save blacklist to meta/ff4.json</button>
  <span id="blStatus"></span>
</div>
__WARNING_BANNER__
<table id="tbl">
  <thead>
    <tr>
      <th data-key="line" data-type="num">Line</th>
      <th data-key="speaker" data-type="str">Speaker</th>
      <th data-key="message" data-type="str">Message</th>
      <th data-key="score" data-type="num">Score</th>
      <th data-key="reasoning" data-type="str">Reasoning</th>
      <th class="nosort">Blacklist</th>
    </tr>
  </thead>
  <tbody id="tbody"></tbody>
</table>
<script>
let rows = __ROWS_JSON__; // each has idx (stable original index) + fields
let sortKey = null, sortDir = 1;
let metaMtime = __META_MTIME__; // meta/ff4.json's mtime as of this page load

function render() {
  const tbody = document.getElementById('tbody');
  tbody.innerHTML = '';
  const frag = document.createDocumentFragment();
  // Rows that can't be matched to a messageNo (already attributed elsewhere,
  // or their text has changed since this table was generated) aren't
  // blacklist-editable -- hidden entirely rather than shown with a locked
  // checkbox, since there's nothing actionable to do with them here.
  for (const r of rows) {
    if (!r.blacklistable) continue;
    const tr = document.createElement('tr');
    const blCell = `<input type="checkbox" class="bl-checkbox" data-idx="${r.idx}" ${r.blacklisted ? 'checked' : ''}>`;
    tr.innerHTML =
      `<td class="line">${r.line}</td>` +
      `<td class="speaker">${escapeHtml(r.speaker)}</td>` +
      `<td class="message">${escapeHtml(r.message)}</td>` +
      `<td class="score"><input class="score-input" type="text" inputmode="numeric"
            data-idx="${r.idx}" value="${escapeHtml(r.score)}"></td>` +
      `<td class="reasoning">${escapeHtml(r.reasoning)}</td>` +
      `<td class="blacklist">${blCell}</td>`;
    frag.appendChild(tr);
  }
  tbody.appendChild(frag);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
}

document.querySelectorAll('th[data-key]').forEach(th => {
  th.addEventListener('click', () => {
    const key = th.dataset.key, type = th.dataset.type;
    if (sortKey === key) sortDir *= -1; else { sortKey = key; sortDir = 1; }
    document.querySelectorAll('th').forEach(h => h.classList.remove('sorted'));
    th.classList.add('sorted');
    th.dataset.arrow = sortDir === 1 ? '▲' : '▼';
    rows.sort((a, b) => {
      let av = a[key], bv = b[key];
      if (type === 'num') { av = parseFloat(av) || 0; bv = parseFloat(bv) || 0; }
      else { av = String(av).toLowerCase(); bv = String(bv).toLowerCase(); }
      if (av < bv) return -1 * sortDir;
      if (av > bv) return 1 * sortDir;
      return 0;
    });
    render();
  });
});

document.getElementById('tbody').addEventListener('change', e => {
  if (e.target.classList.contains('score-input')) {
    const idx = e.target.dataset.idx;
    const row = rows.find(r => String(r.idx) === idx);
    if (row) row.score = e.target.value.trim();
    e.target.classList.add('dirty');
    return;
  }
  if (e.target.classList.contains('bl-checkbox') && !e.target.disabled) {
    const idx = e.target.dataset.idx;
    const row = rows.find(r => String(r.idx) === idx);
    if (row) row.blacklisted = e.target.checked;
  }
});

document.getElementById('tbody').addEventListener('keydown', e => {
  if (!e.target.classList.contains('score-input')) return;
  if (e.key === 'Enter') {
    e.preventDefault();
    e.target.blur();
    focusAdjacentScore(e.target, 1);
  }
  // Tab is left to native browser behavior: since score inputs are the
  // only focusable elements in the table, Tab already jumps straight to
  // the next score cell in current (sorted) display order.
});

function focusAdjacentScore(current, delta) {
  const inputs = Array.from(document.querySelectorAll('.score-input'));
  const i = inputs.indexOf(current);
  const next = inputs[i + delta];
  if (next) { next.focus(); next.select(); }
}

document.getElementById('saveBtn').addEventListener('click', async () => {
  const out = document.getElementById('outPath').value.trim();
  const status = document.getElementById('status');
  const edits = rows.map(r => ({ idx: r.idx, score: r.score }));
  status.textContent = 'Saving...';
  try {
    const res = await fetch('/api/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ out, edits }),
    });
    const data = await res.json();
    if (data.ok) {
      status.textContent = 'Saved to ' + data.path;
      document.querySelectorAll('.score-input').forEach(i => i.classList.remove('dirty'));
    } else {
      status.textContent = 'Error: ' + data.error;
    }
  } catch (err) {
    status.textContent = 'Error: ' + err;
  }
});

document.getElementById('saveBlBtn').addEventListener('click', async () => {
  const status = document.getElementById('blStatus');
  const entries = rows
    .filter(r => r.blacklistable && r.blacklisted)
    .map(r => ({ ep: r.episode, messageNo: r.messageNo }));
  status.textContent = 'Saving...';
  try {
    const res = await fetch('/api/blacklist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries, metaMtime }),
    });
    const data = await res.json();
    if (data.ok) {
      metaMtime = data.metaMtime;
      status.textContent = data.touched.length
        ? `Saved — wrote messageBlacklist for episode(s): ${data.touched.join(', ')}`
        : 'No changes — meta/ff4.json already matches the checked boxes';
    } else {
      status.textContent = 'Error: ' + data.error;
    }
  } catch (err) {
    status.textContent = 'Error: ' + err;
  }
});

render();
</script>
</body>
</html>
"""


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass  # keep terminal quiet

    def do_GET(self):
        if self.path != "/":
            self.send_error(404)
            return
        payload = [
            {
                "idx": i,
                "line": r["line"],
                "speaker": r["speaker"],
                "message": r["message"],
                "score": r["score"],
                "reasoning": r["reasoning"],
                "episode": r["episode"],
                "messageNo": r["messageNo"],
                "blacklistable": r["blacklistable"] and r["messageNo"] is not None,
                "blacklisted": r["blacklisted"],
            }
            for i, r in enumerate(rows())
        ]
        html = PAGE.replace("__ROWS_JSON__", json.dumps(payload))
        html = html.replace("__OUTPUT_DEFAULT__", str(OUTPUT_DEFAULT))
        meta_mtime = META_PATH.stat().st_mtime if META_PATH else "null"
        html = html.replace("__META_MTIME__", str(meta_mtime))
        if untrusted_episodes:
            names = ", ".join(
                f"{ep} ({episode_titles.get(ep, '?')})" for ep in sorted(untrusted_episodes)
            )
            banner = (
                '<div id="warning">Warning: these episodes already had messageBlacklist '
                "entries on load, so messageNo alignment for them couldn't be independently "
                "verified (numbering shifts if api/ff4 was regenerated after those entries "
                f"were added) — double-check before adding more: {escape_html(names)}</div>"
            )
        else:
            banner = ""
        html = html.replace("__WARNING_BANNER__", banner)
        body = html.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if self.path == "/api/save":
            self._handle_save()
        elif self.path == "/api/blacklist":
            self._handle_blacklist()
        else:
            self.send_error(404)

    def _handle_save(self):
        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length))
        out_path = body.get("out") or str(OUTPUT_DEFAULT)
        edits = body.get("edits", [])
        try:
            for e in edits:
                if not LINE_NUM.match(str(e.get("score", "")).strip()):
                    raise ValueError(f"row idx {e['idx']}: score {e.get('score')!r} is not an integer")
            save(edits, out_path)
            result = {"ok": True, "path": out_path}
        except Exception as exc:  # noqa: BLE001 - surface any failure to the UI
            result = {"ok": False, "error": str(exc)}
        self._write_json(result)

    def _handle_blacklist(self):
        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length))
        entries = body.get("entries", [])
        expected_mtime = body.get("metaMtime")
        try:
            touched, new_mtime = save_blacklist(entries, expected_mtime)
            result = {"ok": True, "touched": touched, "metaMtime": new_mtime}
        except Exception as exc:  # noqa: BLE001 - surface any failure to the UI
            result = {"ok": False, "error": str(exc)}
        self._write_json(result)

    def _write_json(self, result):
        payload = json.dumps(result).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


def escape_html(s):
    return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def main():
    if not SOURCE.exists():
        print(f"Source file not found: {SOURCE}", file=sys.stderr)
        sys.exit(1)
    load()
    print(f"Loaded {len(rows())} scored rows from {SOURCE}")
    if META_PATH:
        match_message_numbers()
        load_blacklist_context()
        matched = sum(1 for r in rows() if r["blacklistable"] and r["messageNo"] is not None)
        print(f"Matched {matched}/{len(rows())} rows to messageNo via {API_DIR}")
        print(f"Blacklist writes will go to {META_PATH}")
        if untrusted_episodes:
            print(
                f"WARNING: episodes {sorted(untrusted_episodes)} already had messageBlacklist "
                "entries — see in-page warning banner"
            )
    else:
        print(
            "WARNING: could not locate ff-site-new/ff-site's archive-to-markdown/meta/ff4.json "
            "— blacklist editing disabled, scores-only mode",
            file=sys.stderr,
        )
    server = http.server.HTTPServer(("127.0.0.1", 0), Handler)
    port = server.server_address[1]
    url = f"http://127.0.0.1:{port}/"
    print(f"Serving at {url} (Ctrl+C to stop)")
    webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
