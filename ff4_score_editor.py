#!/usr/bin/env python3
"""
Local GUI editor for the FF4-relevance-scores.md table.

Parses the markdown table (which is split across several repeated
header blocks in the source file), serves an editable, sortable view
of it in your browser, and writes edited scores out to a NEW file —
the source file is never modified.

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

# Each element of `document` is either:
#   {"type": "raw", "text": "<original line, unchanged on save>"}
#   {"type": "row", "line": int, "speaker": str, "message": str,
#    "score": int, "reasoning": str}
document = []


def load():
    document.clear()
    raw_lines = SOURCE.read_text(encoding="utf-8").splitlines()
    for text in raw_lines:
        row = None
        if text.startswith("|"):
            parts = CELL_SPLIT.split(text)
            if len(parts) == 7:
                fields = [p.strip() for p in parts[1:-1]]
                if LINE_NUM.match(fields[0]):
                    row = {
                        "type": "row",
                        "line": int(fields[0]),
                        "speaker": fields[1],
                        "message": fields[2],
                        "score": fields[3],
                        "reasoning": fields[4],
                    }
        document.append(row if row else {"type": "raw", "text": text})


def rows():
    return [r for r in document if r["type"] == "row"]


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


PAGE = """<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>FF4 Relevance Score Editor</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 0; background: #1e1e1e; color: #ddd; }
  #toolbar { position: sticky; top: 0; background: #2a2a2a; padding: 10px 14px; display: flex;
             gap: 10px; align-items: center; border-bottom: 1px solid #444; z-index: 2; }
  #toolbar input[type=text] { padding: 5px 8px; border-radius: 4px; border: 1px solid #555;
             background: #1e1e1e; color: #ddd; width: 320px; }
  button { padding: 6px 14px; border-radius: 4px; border: 1px solid #555; background: #3a3a3a;
           color: #ddd; cursor: pointer; }
  button:hover { background: #4a4a4a; }
  #status { color: #8f8; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #3a3a3a; padding: 4px 8px; text-align: left; font-size: 13px; vertical-align: top; }
  th { position: sticky; top: 45px; background: #2a2a2a; cursor: pointer; user-select: none; z-index: 1; }
  th:hover { background: #3a3a3a; }
  th.sorted::after { content: attr(data-arrow); margin-left: 4px; }
  td.line, td.score { text-align: center; width: 60px; }
  td.speaker { width: 110px; }
  td.reasoning { width: 260px; color: #aaa; }
  tr:nth-child(even) { background: #242424; }
  input.score-input { width: 42px; text-align: center; background: #1e1e1e; color: #fff;
             border: 1px solid #555; border-radius: 3px; padding: 3px; font-size: 13px; }
  input.score-input:focus { border-color: #7ab; outline: none; }
  input.score-input.dirty { border-color: #e0a030; background: #332a1a; }
</style>
</head>
<body>
<div id="toolbar">
  <button id="saveBtn">Save to new file</button>
  <input type="text" id="outPath" value="__OUTPUT_DEFAULT__">
  <span id="status"></span>
</div>
<table id="tbl">
  <thead>
    <tr>
      <th data-key="line" data-type="num">Line</th>
      <th data-key="speaker" data-type="str">Speaker</th>
      <th data-key="message" data-type="str">Message</th>
      <th data-key="score" data-type="num">Score</th>
      <th data-key="reasoning" data-type="str">Reasoning</th>
    </tr>
  </thead>
  <tbody id="tbody"></tbody>
</table>
<script>
let rows = __ROWS_JSON__; // each has idx (stable original index) + fields
let sortKey = null, sortDir = 1;

function render() {
  const tbody = document.getElementById('tbody');
  tbody.innerHTML = '';
  const frag = document.createDocumentFragment();
  for (const r of rows) {
    const tr = document.createElement('tr');
    tr.innerHTML =
      `<td class="line">${r.line}</td>` +
      `<td class="speaker">${escapeHtml(r.speaker)}</td>` +
      `<td class="message">${escapeHtml(r.message)}</td>` +
      `<td class="score"><input class="score-input" type="text" inputmode="numeric"
            data-idx="${r.idx}" value="${escapeHtml(r.score)}"></td>` +
      `<td class="reasoning">${escapeHtml(r.reasoning)}</td>`;
    frag.appendChild(tr);
  }
  tbody.appendChild(frag);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
}

document.querySelectorAll('th').forEach(th => {
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
  if (!e.target.classList.contains('score-input')) return;
  const idx = e.target.dataset.idx;
  const row = rows.find(r => String(r.idx) === idx);
  if (row) row.score = e.target.value.trim();
  e.target.classList.add('dirty');
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
            }
            for i, r in enumerate(rows())
        ]
        html = PAGE.replace("__ROWS_JSON__", json.dumps(payload))
        html = html.replace("__OUTPUT_DEFAULT__", str(OUTPUT_DEFAULT))
        body = html.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if self.path != "/api/save":
            self.send_error(404)
            return
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
        payload = json.dumps(result).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


def main():
    if not SOURCE.exists():
        print(f"Source file not found: {SOURCE}", file=sys.stderr)
        sys.exit(1)
    load()
    print(f"Loaded {len(rows())} scored rows from {SOURCE}")
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
