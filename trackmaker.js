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

let frameCounter = 0;
let lastFrameTime = 0;
let fps = 0;

const MODEL_URL = 'https://williamhe7.github.io/trackmaker/best_v3.onnx';

/* -------------------- INIT -------------------- */

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

export async function initTrackmaker() {
    canvas = document.getElementById('canvas');
    ctx = canvas.getContext('2d');

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    window.addEventListener('orientationchange', () => setTimeout(resizeCanvas, 300));

    await initONNX();

    keypointManager = new KeypointManager();
    pianoManager = new PianoManager(keypointManager);
    midiManager = new MidiManager(pianoManager, 180);

    setupUI();
    updateStatus('Ready');
}

function resizeCanvas() {
    if (!canvas) return;

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}

/* -------------------- UI -------------------- */

function setupUI() {
    document.getElementById('btnWebcam').onclick = startWebcam;
    document.getElementById('btnCalibrate').onclick = calibrate;
    document.getElementById('btnMIDI').onclick = selectMIDI;
    document.getElementById('btnStart').onclick = startPlayback;
    document.getElementById('fullscreen-btn').onclick = toggleFullscreen;
}

function updateStatus(msg) {
    const el = document.getElementById('status');
    if (el) el.textContent = msg;
}

/* -------------------- CAMERA -------------------- */

async function startWebcam() {
    try {
        updateStatus('Starting camera...');

        stream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: 'environment',
                width: { ideal: 1280 },
                height: { ideal: 720 }
            }
        });

        video = document.createElement('video');
        video.srcObject = stream;
        video.playsInline = true;
        video.muted = true;
        await video.play();

        isRunning = true;

        document.getElementById('btnCalibrate').disabled = false;

        updateStatus('Camera active');

        loop();

    } catch (e) {
        console.error(e);
        updateStatus('Camera failed');
    }
}

/* -------------------- CALIBRATE -------------------- */

async function calibrate() {
    if (!video || !session) return;

    updateStatus('Calibrating...');

    const kps = await keypointManager.get_kpps(video, session);

    if (!kps || kps.length < 2) {
        updateStatus('Not enough keypoints');
        return;
    }

    keypointManager.keys = kps;
    keypointManager.compute_homography(kps);

    pianoManager.initKeys();

    isCalibrated = true;

    document.getElementById('btnMIDI').disabled = false;
    document.getElementById('btnStart').disabled = false;

    updateStatus(`Calibrated (${kps.length})`);
}

/* -------------------- MIDI -------------------- */

function selectMIDI() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.mid,.midi';

    input.onchange = async (e) => {
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
    updateStatus('Playback started');
}

/* -------------------- FULLSCREEN -------------------- */

function toggleFullscreen() {
    const el = document.getElementById('canvas-container');

    if (!document.fullscreenElement) {
        el.requestFullscreen().catch(() => {});
    } else {
        document.exitFullscreen();
    }
}

/* -------------------- MAIN LOOP (FPS STABLE) -------------------- */

function loop() {
    if (!isRunning) return;

    requestAnimationFrame(loop);

    frameCounter++;

    const now = performance.now();
    if (now - lastFrameTime > 1000) {
        fps = frameCounter;
        frameCounter = 0;
        lastFrameTime = now;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    let pianoCanvas = null;

    // throttle heavy op (IMPORTANT for mobile FPS)
    if (isCalibrated && frameCounter % 2 === 0) {
        pianoCanvas = keypointManager.transformImage(video);
    }

    if (pianoCanvas) {
        const scale = Math.min(
            canvas.width / pianoCanvas.width,
            canvas.height / pianoCanvas.height
        ) * 1.1;

        const w = pianoCanvas.width * scale;
        const h = pianoCanvas.height * scale;

        ctx.drawImage(
            pianoCanvas,
            (canvas.width - w) / 2,
            canvas.height - h,
            w,
            h
        );
    } else {
        // fallback camera view
        const vw = video.videoWidth || 1280;
        const vh = video.videoHeight || 720;

        const r = vw / vh;

        let w = canvas.width;
        let h = w / r;

        if (h > canvas.height) {
            h = canvas.height;
            w = h * r;
        }

        ctx.drawImage(video, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
    }

    if (started && midiManager?.notes?.length) {
        const t = performance.now() / 1000;
        midiManager.drawVisualization(ctx, canvas.height, t - midiManager.startTime);
    }
}

window.onload = initTrackmaker;
