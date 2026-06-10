import { KeypointManager } from './keypointManager.js';
import { PianoManager } from './pianoManager.js';
import { MidiManager } from './midiManager.js';

let session = null;
let video = null;
let stream = null;
let canvas, ctx;

let keypointManager, pianoManager, midiManager;

let isRunning = false;
let started = false;
let isCalibrated = false;

let loopStarted = false;

const MODEL_URL = 'https://williamhe7.github.io/trackmaker/best_v3.onnx';

// --------------------
// INIT ONNX
// --------------------
async function initONNX() {
    updateStatus('Loading AI model...');

    try {
        session = await ort.InferenceSession.create(MODEL_URL, {
            executionProviders: ['wasm'],
            graphOptimizationLevel: 'basic'
        });

        updateStatus('Model loaded');
        return true;
    } catch (e) {
        console.error(e);
        updateStatus('Model failed to load');
        return false;
    }
}

// --------------------
// SAFE CV WAIT (IMPORTANT FIX)
// --------------------
function waitForCV() {
    return new Promise(resolve => {
        const check = () => {
            if (window.cv && cv.Mat) {
                resolve();
            } else {
                setTimeout(check, 50);
            }
        };
        check();
    });
}

// --------------------
// INIT APP
// --------------------
export async function initTrackmaker() {

    canvas = document.getElementById('canvas');
    ctx = canvas.getContext('2d');

    if (!canvas || !ctx) {
        console.error("Canvas not found");
        return;
    }

    await waitForCV(); // 🔥 CRITICAL FIX

    const modelLoaded = await initONNX();

    keypointManager = new KeypointManager();
    pianoManager = new PianoManager(keypointManager);
    midiManager = new MidiManager(pianoManager, 180);

    setupUI();

    updateStatus(modelLoaded
        ? 'Ready — Start Camera'
        : 'Model failed'
    );
}

// --------------------
// UI SAFE BINDING
// --------------------
function setupUI() {
    const btnCam = document.getElementById('btnWebcam');
    const btnCal = document.getElementById('btnCalibrate');
    const btnMidi = document.getElementById('btnMIDI');
    const btnStart = document.getElementById('btnStart');

    if (!btnCam) {
        console.error("UI buttons not found");
        return;
    }

    btnCam.onclick = startWebcam;
    btnCal.onclick = calibrate;
    btnMidi.onclick = selectMIDI;
    btnStart.onclick = startPlayback;
}

// --------------------
// CAMERA
// --------------------
async function startWebcam() {
    const btn = document.getElementById('btnWebcam');
    if (btn) btn.disabled = true;

    try {
        updateStatus('Starting camera...');

        stream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: "user",
                width: { ideal: 1280 },
                height: { ideal: 720 }
            }
        });

        video = document.createElement('video');
        video.srcObject = stream;
        video.playsInline = true;
        video.muted = true;

        await video.play();

        resizeCanvas();

        if (!loopStarted) {
            loopStarted = true;
            loop();
        }

        isRunning = true;

        updateStatus('Camera ready');

    } catch (e) {
        console.error(e);
        updateStatus('Camera failed');
        if (btn) btn.disabled = false;
    }
}

// --------------------
// RESIZE
// --------------------
function resizeCanvas() {
    if (!canvas) return;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}

// --------------------
// CALIBRATE
// --------------------
async function calibrate() {
    if (!video || !session) {
        updateStatus('Not ready');
        return;
    }

    updateStatus('Calibrating...');

    try {
        const kps = await keypointManager.get_kpps(video, session);

        if (!kps || kps.length < 2) {
            updateStatus('Not enough keys');
            return;
        }

        keypointManager.compute_homography(kps, keypointManager.h);
        pianoManager.initKeys();

        isCalibrated = true;

        updateStatus(`Calibrated: ${kps.length} groups`);

    } catch (e) {
        console.error(e);
        updateStatus('Calibration failed');
    }
}

// --------------------
// LOOP (SAFE)
// --------------------
function loop() {

    if (!loopStarted) return;

    requestAnimationFrame(loop);

    if (!isRunning || !video) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    let frame = null;

    try {
        if (isCalibrated) {
            frame = keypointManager.transformImage(video);
        }

        if (frame) {
            const x = (canvas.width - frame.width) / 2;
            const y = canvas.height - frame.height;
            ctx.drawImage(frame, x, y);
        } else {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        }

        if (started && midiManager.notes.length) {
            const t = performance.now() / 1000;
            midiManager.drawVisualization(ctx, canvas.height, t - midiManager.startTime);
        }

    } catch (e) {
        console.error("loop error:", e);
    }
}

// --------------------
function selectMIDI() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.mid,.midi';

    input.onchange = async e => {
        if (e.target.files[0]) {
            await midiManager.loadMIDI(e.target.files[0]);
            updateStatus('MIDI loaded');
        }
    };

    input.click();
}

function startPlayback() {
    started = true;
    midiManager.startTime = performance.now() / 1000;
}

function updateStatus(msg) {
    const el = document.getElementById('status');
    if (el) el.textContent = msg;
}

window.onload = initTrackmaker;
