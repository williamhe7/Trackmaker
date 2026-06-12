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

const MODEL_URL = 'https://williamhe7.github.io/trackmaker/best_v3.onnx';

/* -------------------- INIT -------------------- */

async function initONNX() {
    updateStatus('Loading model...');
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

    console.log("version 1.5 SAFE");

    canvas = document.getElementById('canvas');
    ctx = canvas.getContext('2d');

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    window.addEventListener('orientationchange', () =>
        setTimeout(resizeCanvas, 300)
    );

    await initONNX();

    keypointManager = new KeypointManager();
    pianoManager = new PianoManager(keypointManager);
    midiManager = new MidiManager(pianoManager, 180);

    setupUI();
    updateStatus('Ready');
}

/* -------------------- CANVAS -------------------- */

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

    const btn = document.getElementById('btnWebcam');
    if (btn) btn.disabled = true;

    try {
        updateStatus('Requesting Camera...');

        stream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: "user",
                width: { ideal: 1600 },
                height: { ideal: 1200 },
                aspectRatio: { ideal: 4 / 3 }
            }
        });

    } catch (e) {
        console.error(e);
        updateStatus('Camera failed');
        if (btn) btn.disabled = false;
        return;
    }

    video = document.createElement('video');
    video.srcObject = stream;
    video.playsInline = true;
    video.muted = true;

    await video.play();

    isRunning = true;

    document.getElementById('btnCalibrate').disabled = false;

    updateStatus('Camera Active');

    loop();
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

    console.log("Select MIDI clicked");

    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".mid,.midi";

    input.onchange = async (e) => {

        if (!e.target.files.length) return;

        await midiManager.loadMIDI(e.target.files[0]);

        updateStatus("MIDI loaded");
    };

    input.click();
}

/* -------------------- PLAYBACK -------------------- */

function startPlayback() {

    started = true;

    midiManager.startTime = performance.now() / 1000;

    updateStatus('Playback started');

    document.getElementById('btnWebcam')?.remove();
    document.getElementById('btnCalibrate')?.remove();
    document.getElementById('btnMIDI')?.remove();
    document.getElementById('btnStart')?.remove();
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

/* -------------------- MAIN LOOP -------------------- */

function drawCamera() {

    if (!video) return;

    const vw = video.videoWidth || 1600;
    const vh = video.videoHeight || 1200;

    const scale = Math.max(
        canvas.width / vw,
        canvas.height / vh
    );

    const w = vw * scale;
    const h = vh * scale;

    ctx.drawImage(
        video,
        (canvas.width - w) / 2,
        (canvas.height - h) / 2,
        w,
        h
    );
}

function drawCalibratedCamera() {

    if (!video || !isCalibrated || !keypointManager?.transformImage) {
        drawCamera();
        return;
    }

    const frame = keypointManager.transformImage(video);

    if (!frame) {
        drawCamera();
        return;
    }

    const scale = Math.max(
        canvas.width / frame.width,
        canvas.height / frame.height
    );

    const w = frame.width * scale;
    const h = frame.height * scale;

    ctx.drawImage(
        frame,
        (canvas.width - w) / 2,
        (canvas.height - h) / 2,
        w,
        h
    );
}

function loop() {

    if (!isRunning) return;

    requestAnimationFrame(loop);

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    /* ---------------- CAMERA ---------------- */

    if (!started) {

        // FULL SCREEN CAMERA MODE (IMPORTANT FIX)
        drawCalibratedCamera();

    } else {

        // SPLIT VIEW MODE

        const mid = canvas.height * 0.5;

        /* TOP: camera / transformed view */
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, canvas.width, mid);
        ctx.clip();

        drawCalibratedCamera();

        ctx.restore();

        /* BOTTOM: MIDI */
        if (midiManager?.notes?.length) {

            const t = performance.now() / 1000;

            midiManager.drawVisualization(
                ctx,
                canvas.height,
                t - midiManager.startTime
            );
        }
    }
}

window.onload = initTrackmaker;
