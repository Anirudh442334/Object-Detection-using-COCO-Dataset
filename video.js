/* video.js - upgraded logic for neon AI dashboard */

/* Elements */
const video = document.getElementById('video');
const canvas = document.getElementById('c1');
const ctx = canvas.getContext('2d');

const aiToggle = document.getElementById('aiToggle');
const fpsInput = document.getElementById('fps');
const fpsLabel = document.getElementById('fpsLabel');
const fpsValueEl = document.getElementById('fpsValue');
const objCountEl = document.getElementById('objCount');
const statusText = document.getElementById('statusText');
const aiIndicator = document.getElementById('aiIndicator');
const modelNameEl = document.getElementById('modelName');
const camLabel = document.getElementById('camLabel');
const lastDetectedEl = document.getElementById('lastDetected');

const flipBtn = document.getElementById('flipBtn');
const screenshotBtn = document.getElementById('screenshotBtn');
const pauseBtn = document.getElementById('pauseBtn');
const downloadLogBtn = document.getElementById('downloadLog');
const resetColorsBtn = document.getElementById('resetColors');
const themeToggle = document.getElementById('themeToggle');

let modelIsLoaded = false;
let cameraAvailable = false;
let detectionRunning = false;
let aiEnabled = false;
let paused = false;
let facingMode = 'environment'; // 'user' or 'environment'
let fps = Number(fpsInput.value); // frames per second target
let lastFrameTime = 0;
let detectionInterval = 1000 / fps;
let objectDetector = null;
let lastResults = [];
let colorMap = {}; // label => color
let detectionLog = [];

/* Helper: create neon color from label string for consistent mapping */
function labelToNeon(label) {
  if (colorMap[label]) return colorMap[label];
  // simple hash to hue
  let hash = 0;
  for (let i = 0; i < label.length; i++) hash = label.charCodeAt(i) + ((hash << 5) - hash);
  const hue = Math.abs(hash) % 360;
  // neon-ish HSL
  const color = `hsl(${hue} 100% 60%)`;
  colorMap[label] = color;
  return color;
}

/* Initialize ml5 object detector */
statusText.innerText = 'Loading model...';
objectDetector = ml5.objectDetector('cocossd', {}, () => {
  modelIsLoaded = true;
  modelNameEl.innerText = 'cocossd (ml5)';
  checkReady();
});

/* Camera access */
async function startCamera() {
  // stop existing tracks if any
  if (video.srcObject) {
    video.srcObject.getTracks().forEach(t => t.stop());
  }
  try {
    const constraints = {
      audio: false,
      video: { facingMode }
    };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    cameraAvailable = true;
    video.srcObject = stream;
    await video.play();
    camLabel.innerText = facingMode === 'user' ? 'Front Camera' : 'Rear Camera';
    checkReady();
  } catch (err) {
    cameraAvailable = false;
    console.warn('Camera error:', err);
    statusText.innerText = 'Camera permission required';
    setTimeout(() => startCamera(), 1200);
  }
}
startCamera();

/* Theme toggle */
themeToggle.addEventListener('click', () => {
  document.documentElement.classList.toggle('dark');
});

/* UI handlers */
aiToggle.addEventListener('change', (e) => {
  aiEnabled = e.target.checked;
  updateAiIndicator();
  if (aiEnabled && !detectionRunning) {
    // start detection loop
    detectionRunning = true;
    timerLoop();
  }
});

fpsInput.addEventListener('input', () => {
  fps = Number(fpsInput.value);
  fpsLabel.innerText = fps;
  detectionInterval = 1000 / fps;
});

flipBtn.addEventListener('click', async () => {
  facingMode = facingMode === 'user' ? 'environment' : 'user';
  camLabel.innerText = 'Switching...';
  await startCamera();
  // reset canvas size after new stream
  setResolution();
});

screenshotBtn.addEventListener('click', () => {
  // produce a download of the canvas
  const link = document.createElement('a');
  link.download = `neon-detect-${Date.now()}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
});

pauseBtn.addEventListener('click', () => {
  paused = !paused;
  pauseBtn.innerText = paused ? '▶ Resume' : '⏯ Pause';
  if (!paused && aiEnabled && !detectionRunning) {
    detectionRunning = true;
    timerLoop();
  }
});

resetColorsBtn.addEventListener('click', () => {
  colorMap = {};
  console.info('Color map reset');
});

downloadLogBtn.addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(detectionLog, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `detection-log-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

/* Utility: check both model and camera ready */
function checkReady() {
  if (modelIsLoaded && cameraAvailable) {
    statusText.innerText = 'Ready — toggle AI to begin';
    aiToggle.disabled = false;
    setResolution();
    // set indicator to idle (red)
    updateAiIndicator();
    // start the loop but detection only runs when aiEnabled
    if (!detectionRunning) {
      detectionRunning = true;
      timerLoop();
    }
  }
}

/* Set canvas size to match video proportionally */
function setResolution() {
  if (!video.videoWidth || !video.videoHeight) return;
  // width adapt to parent container (canvas element's CSS sets width:100%)
  const maxWidth = canvas.clientWidth || video.videoWidth;
  // compute factor from actual video width
  const factor = maxWidth / video.videoWidth;
  canvas.width = Math.round(video.videoWidth * factor);
  canvas.height = Math.round(video.videoHeight * factor);
}

/* Draw frame and optionally run detection */
let isDetecting = false;

async function runDetection() {
  if (!objectDetector || isDetecting) return;
  isDetecting = true;
  try {
    // ml5 objectDetector.detect accepts an image/canvas/video DOM node
    objectDetector.detect(canvas, (err, results) => {
      isDetecting = false;
      if (err) {
        console.error('Detect error', err);
        return;
      }
      lastResults = results || [];
      // update UI
      objCountEl.innerText = lastResults.length;
      if (lastResults.length) {
        lastDetectedEl.innerText = `${lastResults[0].label} (${(lastResults[0].confidence*100).toFixed(0)}%)`;
      } else {
        lastDetectedEl.innerText = '—';
      }
      // append to log with timestamp
      detectionLog.push({ t: Date.now(), results: lastResults.map(r => ({ label: r.label, confidence: r.confidence })) });
    });
  } catch (e) {
    isDetecting = false;
    console.error('runDetection error', e);
  }
}

/* Draw overlays based on lastResults */
function drawOverlays() {
  // draw the video frame as base
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  if (!lastResults || !lastResults.length) return;

  ctx.lineWidth = Math.max(2, Math.round(canvas.width / 360));
  ctx.font = `${Math.max(12, Math.round(canvas.width / 45))}px Inter, Arial`;
  ctx.textBaseline = 'top';

  lastResults.forEach(res => {
    const { label, confidence, x, y, width, height } = res;
    const color = labelToNeon(label);

    // shadow / glow
    ctx.shadowBlur = 18;
    ctx.shadowColor = color;

    // stroke box
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.rect(x, y, width, height);
    ctx.stroke();

    // label background
    const labelText = `${label} ${(confidence * 100).toFixed(1)}%`;
    const padding = 6;
    const textWidth = ctx.measureText(labelText).width;
    ctx.shadowBlur = 0;

    // filled translucent rect behind text
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(x + 2, Math.max(2, y - 24), textWidth + padding, 20);

    // text
    // draw text with neon stroke/glow effect
    ctx.fillStyle = color;
    ctx.fillText(labelText, x + 6, Math.max(4, y - 22));
  });

  // reset shadow
  ctx.shadowBlur = 0;
}

/* Main loop - uses time delta to roughly match fps */
function timerLoop(timestamp) {
  if (!lastFrameTime) lastFrameTime = timestamp || performance.now();
  const now = timestamp || performance.now();
  const elapsed = now - lastFrameTime;

  if (elapsed >= detectionInterval) {
    lastFrameTime = now - (elapsed % detectionInterval);

    // draw the frame (video will be drawn by drawOverlays)
    if (video.readyState >= 2) {
      setResolution();
      // draw image base
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      // If AI enabled and not paused, run detection (async)
      if (aiEnabled && !paused && modelIsLoaded) {
        // kick detection (detection draws overlays later after results)
        runDetection();
      }

      // draw overlays (they use lastResults)
      drawOverlays();
    }
  }

  // update counters
  fpsValueEl.innerText = fps;
  // animate ai indicator
  updateAiIndicator();

  // schedule next frame
  if (detectionRunning) {
    requestAnimationFrame(timerLoop);
  }
}

/* AI indicator update */
function updateAiIndicator() {
  if (aiEnabled && !paused && modelIsLoaded) {
    aiIndicator.classList.add('ai-active');
    statusText.innerText = 'AI Active';
  } else if (paused && aiEnabled) {
    aiIndicator.classList.remove('ai-active');
    aiIndicator.style.background = '#f59e0b'; // amber for paused
    statusText.innerText = 'Paused';
  } else {
    aiIndicator.classList.remove('ai-active');
    aiIndicator.style.background = '#ef4444'; // red idle
    statusText.innerText = modelIsLoaded ? 'Ready — toggle AI' : 'Loading model...';
  }
}

/* When the page becomes visible again, ensure loop resumes */
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && detectionRunning === false && aiEnabled) {
    detectionRunning = true;
    timerLoop();
  }
});

/* Handle window resize */
window.addEventListener('resize', () => {
  setResolution();
});

/* Safety: stop camera on unload */
window.addEventListener('beforeunload', () => {
  if (video.srcObject) video.srcObject.getTracks().forEach(t => t.stop());
});

/* Kick off a small warm-up draw loop (until model+camera ready) */
(function warmup() {
  // keep a light loop to show loading until camera+model ready
  if (!cameraAvailable || !modelIsLoaded) {
    // draw a dark frame
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width || 640, canvas.height || 480);
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, canvas.width || 640, 30);
    requestAnimationFrame(warmup);
  } else {
    // both ready — show them
    statusText.innerText = 'Ready — toggle AI to begin';
    aiToggle.disabled = false;
    // start actual loop
    if (!detectionRunning) {
      detectionRunning = true;
      timerLoop();
    }
  }
})();
