/* ══════════════════════════════════════════════════════════
   PolyEdit — Advanced Polyline Editor  |  script.js
   ══════════════════════════════════════════════════════════ */

// ── STATE ───────────────────────────────────────────────────
const MAX_POLYLINES = 100;

let polylines    = [{ pts: [], color: '#00d4ff', width: 2, ptSize: 5, closed: false }];
let currentLine  = 0;
let mode         = 'draw';
let selectedPt   = null;   // { li, pi }
let history      = [];
let redoStack    = [];
let showGrid     = false;
let snapToGrid   = false;
let gridSize     = 20;
let mousePos     = { x: 0, y: 0 };
let isDragging   = false;

// ── DOM ─────────────────────────────────────────────────────
const canvas      = document.getElementById('canvas');
const ctx         = canvas.getContext('2d');
const tooltip     = document.getElementById('tooltip');
const statusMode  = document.getElementById('statusMode');
const statusCoords= document.getElementById('statusCoords');
const statusPoints= document.getElementById('statusPoints');
const statusMsg   = document.getElementById('statusMsg');
const lineCount   = document.getElementById('lineCount');
const polyList    = document.getElementById('polylineList');
const colorPicker = document.getElementById('colorPicker');
const lineWidthEl = document.getElementById('lineWidth');
const ptSizeEl    = document.getElementById('pointSize');
const widthVal    = document.getElementById('widthVal');
const ptSizeVal   = document.getElementById('ptSizeVal');
const gridToggle  = document.getElementById('gridToggle');
const snapToggle  = document.getElementById('snapToggle');
const closeToggle = document.getElementById('closeToggle');
const gridSizeEl  = document.getElementById('gridSize');
const gridSizeVal = document.getElementById('gridSizeVal');
const toastEl     = document.getElementById('toast');
const fileInput   = document.getElementById('fileInput');

// ── CANVAS SIZING ───────────────────────────────────────────
function resizeCanvas() {
  const wrapper = document.querySelector('.canvas-wrapper');
  canvas.width  = wrapper.clientWidth;
  canvas.height = wrapper.clientHeight;
  render();
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// ── HISTORY ─────────────────────────────────────────────────
function saveState() {
  history.push(JSON.stringify(polylines));
  if (history.length > 80) history.shift();
  redoStack = [];
}
function undo() {
  if (!history.length) return toast('Nothing to undo', 'error');
  redoStack.push(JSON.stringify(polylines));
  polylines = JSON.parse(history.pop());
  syncCurrentLine();
  refreshAll();
  toast('Undone', 'info');
}
function redo() {
  if (!redoStack.length) return toast('Nothing to redo', 'error');
  history.push(JSON.stringify(polylines));
  polylines = JSON.parse(redoStack.pop());
  syncCurrentLine();
  refreshAll();
  toast('Redone', 'info');
}
function syncCurrentLine() {
  currentLine = Math.min(currentLine, polylines.length - 1);
}

// ── RENDER ──────────────────────────────────────────────────
function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (showGrid) drawGrid();

  polylines.forEach((pl, li) => {
    const isActive = li === currentLine;
    if (!pl.pts.length) return;

    // Shadow / glow on active line
    if (isActive) {
      ctx.shadowColor = pl.color;
      ctx.shadowBlur  = 8;
    }

    // Line
    ctx.beginPath();
    ctx.moveTo(pl.pts[0].x, pl.pts[0].y);
    for (let i = 1; i < pl.pts.length; i++) ctx.lineTo(pl.pts[i].x, pl.pts[i].y);
    if (pl.closed && pl.pts.length > 2) ctx.closePath();
    ctx.strokeStyle = pl.color;
    ctx.lineWidth   = isActive ? pl.width + 0.5 : pl.width * 0.85;
    ctx.lineJoin    = 'round';
    ctx.lineCap     = 'round';
    ctx.stroke();

    ctx.shadowBlur = 0;

    // Points
    pl.pts.forEach((p, pi) => {
      const isSelected = selectedPt && selectedPt.li === li && selectedPt.pi === pi;
      ctx.beginPath();
      ctx.arc(p.x, p.y, isSelected ? pl.ptSize + 3 : pl.ptSize, 0, Math.PI * 2);
      ctx.fillStyle   = isSelected ? '#ffffff' : isActive ? pl.color : adjustAlpha(pl.color, 0.5);
      ctx.fill();
      if (isActive || isSelected) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth   = 1.2;
        ctx.stroke();
      }
    });
  });

  // Live draw preview — ghost segment from last point to mouse
  if (mode === 'draw' && polylines[currentLine].pts.length > 0) {
    const last = polylines[currentLine].pts.at(-1);
    const snap = getSnap(mousePos);
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(snap.x, snap.y);
    ctx.strokeStyle = adjustAlpha(polylines[currentLine].color, 0.35);
    ctx.lineWidth   = 1;
    ctx.setLineDash([5, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  updateStatus();
}

function drawGrid() {
  ctx.strokeStyle = 'rgba(30,45,69,0.9)';
  ctx.lineWidth   = 1;
  for (let x = 0; x < canvas.width; x += gridSize) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
  }
  for (let y = 0; y < canvas.height; y += gridSize) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
  }
  // Origin dot
  ctx.fillStyle = 'rgba(0,212,255,.15)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function adjustAlpha(hex, a) {
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${a})`;
}

// ── SNAP ────────────────────────────────────────────────────
function getSnap(pos) {
  if (!snapToGrid) return pos;
  return {
    x: Math.round(pos.x / gridSize) * gridSize,
    y: Math.round(pos.y / gridSize) * gridSize,
  };
}

// ── NEAREST POINT ───────────────────────────────────────────
function findNearestPoint(pos, radius = 18) {
  let best = null, bestDist = radius;
  polylines.forEach((pl, li) => {
    pl.pts.forEach((p, pi) => {
      const d = Math.hypot(p.x - pos.x, p.y - pos.y);
      if (d < bestDist) { bestDist = d; best = { li, pi }; }
    });
  });
  return best;
}

// Find nearest segment for insert
function findNearestSegment(pos, radius = 14) {
  let best = null, bestDist = radius;
  polylines.forEach((pl, li) => {
    for (let i = 0; i < pl.pts.length - 1; i++) {
      const d = pointToSegmentDist(pos, pl.pts[i], pl.pts[i+1]);
      if (d < bestDist) { bestDist = d; best = { li, pi: i + 1 }; }
    }
  });
  return best;
}

function pointToSegmentDist(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx*dx + dy*dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x-a.x)*dx + (p.y-a.y)*dy) / len2));
  return Math.hypot(p.x - (a.x + t*dx), p.y - (a.y + t*dy));
}

// ── MOUSE EVENTS ─────────────────────────────────────────────
function getPos(e) {
  const rect = canvas.getBoundingClientRect();
  return getSnap({ x: e.clientX - rect.left, y: e.clientY - rect.top });
}

canvas.addEventListener('mousedown', e => {
  if (e.button !== 0) return;
  const pos = getPos(e);

  if (mode === 'draw') {
    saveState();
    polylines[currentLine].pts.push(pos);
    refreshAll();
  }
  if (mode === 'move') {
    selectedPt = findNearestPoint(pos);
    if (selectedPt) {
      saveState();
      isDragging = true;
      canvas.style.cursor = 'grabbing';
    }
  }
  if (mode === 'delete') {
    const pt = findNearestPoint(pos);
    if (pt) {
      saveState();
      polylines[pt.li].pts.splice(pt.pi, 1);
      refreshAll();
      toast(`Point deleted`, 'info');
    }
  }
  if (mode === 'insert') {
    const seg = findNearestSegment(pos);
    if (seg) {
      saveState();
      polylines[seg.li].pts.splice(seg.pi, 0, pos);
      refreshAll();
      toast('Point inserted on segment', 'info');
    } else {
      // Fall back: add to current line end
      saveState();
      polylines[currentLine].pts.push(pos);
      refreshAll();
    }
  }
});

canvas.addEventListener('mousemove', e => {
  const pos  = { x: e.clientX - canvas.getBoundingClientRect().left,
                  y: e.clientY - canvas.getBoundingClientRect().top };
  mousePos = pos;

  // Update coords
  statusCoords.textContent = `X: ${Math.round(pos.x)}  Y: ${Math.round(pos.y)}`;

  // Tooltip
  if (mode === 'move' || mode === 'delete') {
    const pt = findNearestPoint(pos);
    if (pt) {
      tooltip.textContent = `Pt ${pt.pi + 1} — Line ${pt.li + 1}`;
      tooltip.style.left = (pos.x + 14) + 'px';
      tooltip.style.top  = (pos.y - 28) + 'px';
      tooltip.classList.add('visible');
    } else {
      tooltip.classList.remove('visible');
    }
  } else {
    tooltip.classList.remove('visible');
  }

  if (mode === 'move' && isDragging && selectedPt) {
    polylines[selectedPt.li].pts[selectedPt.pi] = getSnap(pos);
    render();
    updatePolyList();
  } else {
    render(); // live preview
  }
});

canvas.addEventListener('mouseup', () => {
  if (isDragging) {
    isDragging = false;
    canvas.style.cursor = 'crosshair';
    updatePolyList();
    toast('Point moved', 'info');
  }
  selectedPt = null;
});

canvas.addEventListener('mouseleave', () => {
  tooltip.classList.remove('visible');
});

// ── KEYBOARD SHORTCUTS ───────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  const key = e.key.toLowerCase();

  if (e.ctrlKey && key === 'z') { e.preventDefault(); undo(); return; }
  if (e.ctrlKey && (key === 'y' || (e.shiftKey && key === 'z'))) { e.preventDefault(); redo(); return; }

  switch (key) {
    case 'b': newPolyline(); break;
    case 'm': setMode('move'); break;
    case 'd': setMode('delete'); break;
    case 'r': refreshCanvas(); break;
    case 'q': clearAll(); break;
    case 'escape': setMode('draw'); break;
  }
});

// ── MODE ─────────────────────────────────────────────────────
function setMode(m) {
  mode = m;
  document.querySelectorAll('.tool-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.mode === m);
  });
  const labels = { draw:'Draw', move:'Move', delete:'Delete', insert:'Insert' };
  const colors = { draw:'draw', move:'move', delete:'delete', insert:'insert' };
  const msgs   = {
    draw:   'Click canvas to add points',
    move:   'Click & drag a vertex to reposition it',
    delete: 'Click a vertex to remove it',
    insert: 'Click on a segment to insert a new point'
  };
  statusMode.innerHTML = `<span class="dot ${colors[m]}"></span> Mode: <strong>${labels[m]}</strong>`;
  setStatusMsg(msgs[m] || '');
  canvas.style.cursor = m === 'move' ? 'grab' : 'crosshair';
  selectedPt = null;
  render();
}

// ── ACTIONS ──────────────────────────────────────────────────
function newPolyline() {
  if (polylines.length >= MAX_POLYLINES) return toast('Max 100 polylines reached!', 'error');
  saveState();
  const colors = ['#00d4ff','#a3e635','#f97316','#e879f9','#fb7185','#facc15','#34d399','#60a5fa'];
  const c = colors[polylines.length % colors.length];
  polylines.push({ pts: [], color: c, width: parseInt(lineWidthEl.value), ptSize: parseInt(ptSizeEl.value), closed: false });
  currentLine = polylines.length - 1;
  colorPicker.value = c;
  setMode('draw');
  refreshAll();
  toast(`New polyline #${currentLine + 1} created`, 'success');
}

function refreshCanvas() {
  saveState();
  render();
  toast('Canvas refreshed', 'info');
}

function clearAll() {
  if (!confirm('Clear all polylines? This cannot be undone easily.')) return;
  saveState();
  polylines = [{ pts: [], color: '#00d4ff', width: 2, ptSize: 5, closed: false }];
  currentLine = 0;
  colorPicker.value = '#00d4ff';
  refreshAll();
  toast('Canvas cleared', 'info');
}

function refreshAll() {
  render();
  updatePolyList();
  updateStatus();
}

function updateStatus() {
  const total = polylines.reduce((s, pl) => s + pl.pts.length, 0);
  statusPoints.textContent = `Points: ${total}`;
  lineCount.textContent = `${polylines.length} / ${MAX_POLYLINES}`;
}

// ── POLYLINE LIST ─────────────────────────────────────────────
function updatePolyList() {
  polyList.innerHTML = '';
  polylines.forEach((pl, i) => {
    const el = document.createElement('div');
    el.className = 'poly-item' + (i === currentLine ? ' active' : '');
    el.innerHTML = `
      <div class="poly-dot" style="background:${pl.color}"></div>
      <span class="poly-name">Line ${i+1}</span>
      <span class="poly-pts">${pl.pts.length}pts</span>
      <span class="poly-del" title="Delete polyline">✕</span>
    `;
    el.querySelector('.poly-del').addEventListener('click', ev => {
      ev.stopPropagation();
      if (polylines.length === 1) return toast('Cannot delete the only polyline', 'error');
      saveState();
      polylines.splice(i, 1);
      currentLine = Math.min(currentLine, polylines.length - 1);
      refreshAll();
    });
    el.addEventListener('click', () => {
      currentLine = i;
      colorPicker.value = pl.color;
      lineWidthEl.value = pl.width;
      ptSizeEl.value    = pl.ptSize;
      widthVal.textContent  = pl.width + 'px';
      ptSizeVal.textContent = pl.ptSize + 'px';
      closeToggle.checked = pl.closed;
      updatePolyList();
      render();
    });
    polyList.appendChild(el);
  });
  lineCount.textContent = `${polylines.length} / ${MAX_POLYLINES}`;
}
updatePolyList();

// ── STYLE CONTROLS ────────────────────────────────────────────
colorPicker.addEventListener('input', () => {
  polylines[currentLine].color = colorPicker.value;
  render();
  updatePolyList();
});

document.querySelectorAll('.preset').forEach(p => {
  p.addEventListener('click', () => {
    colorPicker.value = p.dataset.color;
    polylines[currentLine].color = p.dataset.color;
    render();
    updatePolyList();
  });
});

lineWidthEl.addEventListener('input', () => {
  const v = parseInt(lineWidthEl.value);
  polylines[currentLine].width = v;
  widthVal.textContent = v + 'px';
  render();
});

ptSizeEl.addEventListener('input', () => {
  const v = parseInt(ptSizeEl.value);
  polylines[currentLine].ptSize = v;
  ptSizeVal.textContent = v + 'px';
  render();
});

gridToggle.addEventListener('change', () => {
  showGrid = gridToggle.checked;
  render();
});
snapToggle.addEventListener('change', () => { snapToGrid = snapToggle.checked; });
closeToggle.addEventListener('change', () => {
  polylines[currentLine].closed = closeToggle.checked;
  render();
});
gridSizeEl.addEventListener('input', () => {
  gridSize = parseInt(gridSizeEl.value);
  gridSizeVal.textContent = gridSize + 'px';
  if (showGrid) render();
});

// ── TOOLBAR BUTTON EVENTS ─────────────────────────────────────
document.getElementById('drawBtn').onclick   = () => setMode('draw');
document.getElementById('moveBtn').onclick   = () => setMode('move');
document.getElementById('deleteBtn').onclick = () => setMode('delete');
document.getElementById('insertBtn').onclick = () => setMode('insert');
document.getElementById('newLineBtn').onclick = newPolyline;
document.getElementById('refreshBtn').onclick = refreshCanvas;
document.getElementById('undoBtn').onclick   = undo;
document.getElementById('redoBtn').onclick   = redo;

// ── SAVE / LOAD ───────────────────────────────────────────────
document.getElementById('saveJsonBtn').onclick = () => {
  const data = JSON.stringify({ polylines }, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = 'polylines.json';
  a.click();
  URL.revokeObjectURL(url);
  toast('Saved as polylines.json', 'success');
};

document.getElementById('loadBtn').onclick = () => fileInput.click();
fileInput.addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const parsed = JSON.parse(ev.target.result);
      if (parsed.polylines) {
        saveState();
        polylines   = parsed.polylines;
        currentLine = 0;
        refreshAll();
        toast('Polylines loaded!', 'success');
      } else throw new Error();
    } catch { toast('Invalid file format', 'error'); }
  };
  reader.readAsText(file);
  fileInput.value = '';
});

// ── EXPORT AS PNG ─────────────────────────────────────────────
document.getElementById('saveImgBtn').onclick = () => {
  // Create off-screen canvas with white/dark bg
  const offscreen = document.createElement('canvas');
  offscreen.width  = canvas.width;
  offscreen.height = canvas.height;
  const oc = offscreen.getContext('2d');

  // Dark background
  oc.fillStyle = '#080c18';
  oc.fillRect(0, 0, offscreen.width, offscreen.height);

  if (showGrid) {
    oc.strokeStyle = 'rgba(30,45,69,0.9)';
    oc.lineWidth = 1;
    for (let x = 0; x < offscreen.width; x += gridSize) {
      oc.beginPath(); oc.moveTo(x,0); oc.lineTo(x, offscreen.height); oc.stroke();
    }
    for (let y = 0; y < offscreen.height; y += gridSize) {
      oc.beginPath(); oc.moveTo(0,y); oc.lineTo(offscreen.width, y); oc.stroke();
    }
  }

  polylines.forEach(pl => {
    if (!pl.pts.length) return;
    oc.beginPath();
    oc.moveTo(pl.pts[0].x, pl.pts[0].y);
    for (let i = 1; i < pl.pts.length; i++) oc.lineTo(pl.pts[i].x, pl.pts[i].y);
    if (pl.closed && pl.pts.length > 2) oc.closePath();
    oc.strokeStyle = pl.color;
    oc.lineWidth   = pl.width;
    oc.lineJoin    = 'round'; oc.lineCap = 'round';
    oc.shadowColor = pl.color; oc.shadowBlur = 6;
    oc.stroke();
    oc.shadowBlur = 0;
    pl.pts.forEach(p => {
      oc.beginPath();
      oc.arc(p.x, p.y, pl.ptSize, 0, Math.PI * 2);
      oc.fillStyle = pl.color;
      oc.fill();
    });
  });

  // Watermark
  oc.font      = '13px Space Mono, monospace';
  oc.fillStyle = 'rgba(0,212,255,0.3)';
  oc.textAlign = 'right';
  oc.fillText('PolyEdit v2.0', offscreen.width - 14, offscreen.height - 12);

  offscreen.toBlob(blob => {
    const url = URL.createObjectURL(blob);
    const a   = document.createElement('a');
    a.href    = url;
    a.download = 'polylines.png';
    a.click();
    URL.revokeObjectURL(url);
    toast('Exported as polylines.png', 'success');
  }, 'image/png');
};

// ── TOAST ─────────────────────────────────────────────────────
function toast(msg, type = 'info') {
  toastEl.textContent = msg;
  toastEl.className   = `toast ${type} show`;
  clearTimeout(toastEl._t);
  toastEl._t = setTimeout(() => { toastEl.classList.remove('show'); }, 2200);
}

function setStatusMsg(msg) { statusMsg.textContent = msg; }

// ── INIT ──────────────────────────────────────────────────────
setMode('draw');
updatePolyList();
setStatusMsg('Click canvas to add points  •  Press B to begin a new polyline');