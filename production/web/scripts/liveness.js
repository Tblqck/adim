import { dropFaceFrame } from './state.js';
import { FaceLandmarker, FilesetResolver } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';

const video        = document.getElementById('vid-face');
const overlay      = document.getElementById('overlay-face');
const ctx          = overlay.getContext('2d');
const toast        = document.getElementById('face-toast');
const instr        = document.getElementById('challenge-instr');
const list         = document.getElementById('challenge-list');
const progress     = document.getElementById('challenge-progress');
const countdownEl  = document.getElementById('countdown-face');
const previewBlock = document.getElementById('face-preview-block');
const previewImg   = document.getElementById('face-preview');
const previewStrip = document.getElementById('face-preview-strip');
const summaryList  = document.getElementById('challenge-summary');
const restartBtn   = document.getElementById('restart-btn');
const loadingLayer     = document.getElementById('model-loading');
const submittingLayer  = document.getElementById('submitting-layer');
const doneLayer        = document.getElementById('done-layer');

// Guard: must have captured ID before reaching liveness
(function () {
  try {
    const raw  = window.sessionStorage.getItem('kyc-flow-v2');
    const sess = raw ? JSON.parse(raw) : {};
    if (!sess.idFrame) window.location.href = 'index.html';
  } catch (_) {}
}());

const CHALLENGES = [
  { type: 'turn_left',  label: 'Turn head left'  },
  { type: 'turn_right', label: 'Turn head right' },
];

const FACE_OUTLINE = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323,
  361, 288, 397, 365, 379, 378, 400, 377, 152, 148,
  176, 149, 150, 136, 172, 58, 132, 93, 234, 127,
  162, 21, 54, 103, 67, 109, 10,
];

const state = {
  model:          null,
  stream:         null,
  raf:            null,
  countdownTimer: null,
  countdownActive: false,
  holdFrames:     0,
  challenges:     CHALLENGES.map(c => ({ ...c, status: 'pending' })),
  idx:            0,
  captureFrames:  [], // one frame per challenge + final
  emitted:        false,
};

buildChallengeList();
init();

async function init() {
  restartBtn.addEventListener('click', () => {
    dropFaceFrame();
    resetState();
    startCamera();
  });

  try {
    await loadModel();
    loadingLayer.classList.add('hidden');
    await startCamera();
  } catch (err) {
    console.error(err);
    toast.textContent = 'Cannot access camera or model. Refresh when permissions are granted.';
  }
}

async function loadModel() {
  const resolver = await FilesetResolver.forVisionTasks(
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
  );
  state.model = await FaceLandmarker.createFromOptions(resolver, {
    baseOptions: {
      modelAssetPath: '/liveness/face_landmarker.task',
      delegate: 'CPU',
    },
    runningMode: 'VIDEO',
    numFaces: 1,
    outputFaceBlendshapes: true,
  });
}

async function startCamera() {
  stopCamera();
  state.countdownActive = false;
  instr.textContent = 'Face your camera — detection starts automatically.';
  toast.textContent = 'Look straight at the camera.';

  state.stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false,
  });

  video.srcObject = state.stream;
  await video.play();
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas, { passive: true });
  loop();
}

function stopCamera() {
  if (state.stream) {
    state.stream.getTracks().forEach(t => t.stop());
    state.stream = null;
  }
  cancelAnimationFrame(state.raf);
  clearInterval(state.countdownTimer);
  state.countdownTimer = null;
}

function resizeCanvas() {
  overlay.width  = video.videoWidth  || overlay.clientWidth;
  overlay.height = video.videoHeight || overlay.clientHeight;
}

function loop() {
  if (!state.model || !video || video.readyState < 2) {
    state.raf = requestAnimationFrame(loop);
    return;
  }

  const result = state.model.detectForVideo(video, performance.now());
  ctx.clearRect(0, 0, overlay.width, overlay.height);

  const hasFace = result?.faceLandmarks?.length;
  if (hasFace) {
    const landmarks = result.faceLandmarks[0];
    const blend     = result.faceBlendshapes?.[0]?.categories || [];
    drawFaceOutline(landmarks);
    handleChallenges(landmarks, blend);
  } else {
    instr.textContent = 'Face not detected — ensure good lighting and remove masks.';
    toast.textContent = 'Face not detected.';
    state.holdFrames  = 0;
    cancelCountdown();
  }

  state.raf = requestAnimationFrame(loop);
}

function drawFaceOutline(landmarks) {
  if (!landmarks || !landmarks.length) return;
  const w = overlay.width  || video.videoWidth  || 0;
  const h = overlay.height || video.videoHeight || 0;
  if (!w || !h) return;
  const pts = FACE_OUTLINE
    .map(i => landmarks[i])
    .filter(Boolean)
    .map(l => ({ x: l.x * w, y: l.y * h }));
  if (pts.length < 3) return;

  ctx.save();
  ctx.strokeStyle = 'rgba(94,255,208,0.95)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

function handleChallenges(landmarks, blend) {
  const current = state.challenges[state.idx];

  if (!current) {
    cancelCountdown();
    instr.textContent = 'Capturing final frame…';
    toast.textContent = 'Capturing final frame…';
    captureFinalAndEmit();
    return;
  }

  instr.textContent = current.label;
  toast.textContent = current.label;

  if (checkChallenge(current.type, landmarks, blend)) {
    state.holdFrames++;
    if (state.holdFrames >= 4) completeChallenge(current.type);
  } else {
    state.holdFrames = 0;
  }
}

function completeChallenge(type) {
  // Capture a frame right as the challenge is satisfied
  const frame = snapFrame();
  state.captureFrames.push({ type, label: formatLabel(type), data: frame, captured_at: new Date().toISOString() });
  addPreviewThumb(frame, formatLabel(type));

  state.challenges[state.idx].status = 'done';
  state.idx        += 1;
  state.holdFrames  = 0;
  updateChallengeUI();
}

function beginCountdown() {
  state.countdownActive = true;
  let value = 2;
  countdownEl.textContent = value;
  countdownEl.classList.add('show');
  state.countdownTimer = setInterval(() => {
    value -= 1;
    if (value <= 0) {
      cancelCountdown();
      captureFinalAndEmit();
    } else {
      countdownEl.textContent = value;
    }
  }, 900);
}

function cancelCountdown() {
  clearInterval(state.countdownTimer);
  state.countdownTimer  = null;
  state.countdownActive = false;
  countdownEl.classList.remove('show');
}

function snapFrame() {
  const canvas = document.createElement('canvas');
  canvas.width  = video.videoWidth;
  canvas.height = video.videoHeight;
  const cctx = canvas.getContext('2d');
  cctx.save();
  cctx.scale(-1, 1);
  cctx.drawImage(video, -canvas.width, 0, canvas.width, canvas.height);
  cctx.restore();
  return canvas.toDataURL('image/jpeg', 0.92);
}

function captureFinalAndEmit() {
  if (state.emitted) return;
  state.emitted = true;

  // Final centered frame
  const finalFrame = snapFrame();
  state.captureFrames.push({ type: 'final', label: 'Final frame', data: finalFrame, captured_at: new Date().toISOString() });
  addPreviewThumb(finalFrame, 'Final');

  // Show preview
  previewImg.src = finalFrame;
  summaryList.innerHTML = '';
  state.challenges.forEach(ch => {
    const li = document.createElement('li');
    li.textContent = `${ch.label}: ${ch.status === 'done' ? '✔' : 'pending'}`;
    summaryList.appendChild(li);
  });
  previewBlock.hidden = false;

  stopCamera();
  if (submittingLayer) submittingLayer.classList.remove('hidden');

  emit();
}

function addPreviewThumb(dataUrl, label) {
  if (!previewStrip) return;
  const img = document.createElement('img');
  img.src   = dataUrl;
  img.alt   = label;
  img.title = label;
  previewStrip.appendChild(img);
}

function readSession() {
  try {
    const raw = window.sessionStorage.getItem('kyc-flow-v2');
    return raw ? JSON.parse(raw) : {};
  } catch (_) { return {}; }
}

async function emit() {
  const sess = readSession();

  const faceFrames = state.captureFrames.map(f => f.data).filter(Boolean);

  const payload = {
    mode:            'id+liveness',
    country:         sess.country      || null,
    doc_type:        sess.docType      || null,
    id_frame:        sess.idFrame      || null,
    id_frame_back:   sess.idFrameBack  || null,
    id_quality:      sess.idMeta       || null,
    id_quality_back: sess.idMetaBack   || null,
    face_frame:      faceFrames[0]     || null,
    face_frames:     faceFrames,
    capture_pack:    state.captureFrames.map(f => ({
      type:        f.type,
      label:       f.label,
      captured_at: f.captured_at,
    })),
    captured_at: state.captureFrames[0]?.captured_at || new Date().toISOString(),
    challenges:  state.challenges.map(ch => ({ type: ch.type, label: ch.label, status: ch.status })),
    device: {
      userAgent: navigator.userAgent,
      timezone:  Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
  };

  window.dispatchEvent(new CustomEvent('liveness:captured', { detail: payload }));

  if (window.LIVENESS_ENDPOINT) {
    fetch(window.LIVENESS_ENDPOINT, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    }).catch(err => console.warn('save error (non-fatal):', err));
  }

  const result = await sendToVerify(payload);
  showDone(result);
}

function showDone(result) {
  if (submittingLayer) submittingLayer.classList.add('hidden');

  const iconEl    = document.getElementById('result-icon');
  const verdictEl = document.getElementById('result-verdict');
  const scoreEl   = document.getElementById('result-score');
  const detailsEl = document.getElementById('result-details');

  if (result) {
    const v       = (result.overall_verdict || '').toLowerCase();
    const passed  = v.includes('pass') || result.verified === true;
    const tampered = v.includes('tampered');

    if (iconEl) {
      iconEl.textContent = tampered ? '⚠' : passed ? '✓' : '✗';
      iconEl.style.color = tampered ? '#ffcc00' : passed ? '#5effe0' : '#ff6b6b';
    }
    if (verdictEl) verdictEl.textContent = v.replace(/_/g, ' ').toUpperCase() || 'Complete';
    if (scoreEl && result.overall_score != null)
      scoreEl.textContent = `Score: ${(result.overall_score * 100).toFixed(0)}%`;

    if (detailsEl) {
      // MRZ fields take priority; fall back to ocr_fields
      const mrz = (result.mrz || {}).fields || {};
      const ocr = result.ocr_fields || {};
      const f   = (key, ...aliases) => {
        for (const k of [key, ...aliases]) {
          const val = mrz[k] || ocr[k];
          if (val) return val;
        }
        return null;
      };

      const rows = [];
      const surname = f('surname', 'last_name');
      const given   = f('given_names', 'given_name', 'first_name');
      if (surname || given) rows.push(['Name', [surname, given].filter(Boolean).join(' ')]);

      const docNo  = f('doc_number', 'document_number', 'id_number');
      const dob    = f('birth_date', 'date_of_birth', 'dob');
      const expiry = f('expiry_date', 'date_of_expiry', 'expiry');
      const nat    = f('nationality', 'country');

      if (docNo)  rows.push(['Doc No', docNo]);
      if (dob)    rows.push(['Date of birth', dob]);
      if (expiry) rows.push(['Expiry', expiry]);
      if (nat)    rows.push(['Nationality', nat]);

      // Verification sub-scores
      rows.push(['', '']);
      if (result.face?.score != null)
        rows.push(['Face match', `${(result.face.score * 100).toFixed(0)}%`]);
      if (result.liveness?.is_live != null)
        rows.push(['Liveness', result.liveness.is_live ? 'live ✓' : 'spoof ✗']);
      rows.push(['Tamper check', tampered ? '⚠ flagged' : 'clean ✓']);

      detailsEl.innerHTML = rows
        .map(([k, v]) => k === ''
          ? '<hr style="border-color:rgba(255,255,255,0.1);margin:0.4rem 0">'
          : `<div style="display:flex;justify-content:space-between;gap:1rem">
               <span style="opacity:0.5">${k}</span>
               <span style="font-weight:600;text-align:right">${v}</span>
             </div>`)
        .join('');
    }
  }

  if (doneLayer) doneLayer.classList.remove('hidden');
}

async function sendToVerify(payload) {
  const url = window.VERIFY_API_URL;
  if (!url) return null;

  try {
    const fd = new FormData();
    fd.append('country', normalizeCountry(payload.country));
    fd.append('doc_type', payload.doc_type || payload.docType || 'national_id');
    fd.append('mode', '3');
    fd.append('user_ref', (payload.device && payload.device.userAgent) || 'web');
    fd.append('issue_year', String((payload.id_quality || {}).issue_year || 2025));

    appendDataUri(fd, 'id_image', payload.id_frame, 'id_front.jpg');
    if (payload.id_frame_back) appendDataUri(fd, 'id_image_back', payload.id_frame_back, 'id_back.jpg');

    (payload.face_frames || []).slice(0, 5).forEach((uri, i) => {
      appendDataUri(fd, 'liveness_frames', uri, `frame_${i + 1}.jpg`);
    });

    const resp = await fetch(url, { method: 'POST', body: fd });
    return await resp.json();
  } catch (err) {
    console.error('verify error', err);
    return null;
  }
}

function appendDataUri(fd, field, uri, filename) {
  const blob = dataUriToBlob(uri);
  if (blob) fd.append(field, blob, filename);
}

function dataUriToBlob(uri) {
  if (!uri || typeof uri !== 'string') return null;
  const parts = uri.split(',');
  if (parts.length < 2) return null;
  const mime = (parts[0].match(/data:(.*?);base64/) || [])[1] || 'image/jpeg';
  try {
    const bin = atob(parts[1]);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  } catch (_) {
    return null;
  }
}

function normalizeCountry(country) {
  if (typeof country === 'string') return country;
  if (country && typeof country === 'object') return country.code2 || country.code3 || country.name || '';
  return '';
}

function checkChallenge(type, landmarks, blend) {
  if (type === 'turn_left' || type === 'turn_right') {
    const yaw = computeYaw(landmarks);
    return type === 'turn_left' ? yaw > 16 : yaw < -16;
  }
  return false;
}

function computeYaw(landmarks) {
  const le  = landmarks[33].x;
  const re  = landmarks[263].x;
  const w   = Math.abs(re - le) + 1e-3;
  const mid = (le + re) / 2;
  return ((landmarks[4].x - mid) / w) * 90;
}

function formatLabel(type) {
  return type.split('_').map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
}

function buildChallengeList() {
  list.innerHTML = '';
  state.challenges.forEach((ch, idx) => {
    const div = document.createElement('div');
    div.className = 'challenge-item' + (idx === 0 ? ' active' : '');
    div.id        = `challenge-${idx}`;
    div.textContent = ch.label;
    list.appendChild(div);
  });
  updateChallengeUI();
}

function updateChallengeUI() {
  const done = state.challenges.filter(ch => ch.status === 'done').length;
  progress.style.width = `${(done / state.challenges.length) * 100}%`;
  state.challenges.forEach((ch, idx) => {
    const el = document.getElementById(`challenge-${idx}`);
    if (!el) return;
    el.classList.toggle('done',   ch.status === 'done');
    el.classList.toggle('active', idx === state.idx && ch.status !== 'done');
  });
}

function resetState() {
  cancelAnimationFrame(state.raf);
  clearInterval(state.countdownTimer);
  state.countdownTimer  = null;
  state.countdownActive = false;
  state.holdFrames      = 0;
  state.idx             = 0;
  state.challenges      = CHALLENGES.map(c => ({ ...c, status: 'pending' }));
  state.captureFrames   = [];
  state.emitted         = false;
  buildChallengeList();
  previewBlock.hidden = true;
  if (previewStrip) previewStrip.innerHTML = '';
  if (doneLayer) doneLayer.classList.add('hidden');
}
