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

    const btn = document.getElementById('btnWebcam');
    if (btn) btn.disabled = true;

    try {

        updateStatus('Requesting Selfie Camera...');

        // Mobile: prefer front camera
        stream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: { exact: "user" },
                width: { ideal: 1280 },
                height: { ideal: 720 }
            }
        });

        console.log("✅ Using front/selfie camera");

    } catch (e) {

        console.warn(
            "Front camera unavailable, trying fallback...",
            e
        );

        try {

            stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                }
            });

            console.log("✅ Using fallback camera");

        } catch (fallbackError) {

            console.error(fallbackError);

            updateStatus(
                '❌ Camera access denied or unavailable'
            );

            if (btn) btn.disabled = false;

            return;
        }
    }

    try {

        video = document.createElement('video');
        video.srcObject = stream;
        video.playsInline = true;
        video.muted = true;

        await video.play();

        isRunning = true;

        document.getElementById(
            'btnCalibrate'
        ).disabled = false;

        updateStatus('✅ Camera Active');

        loop();

    } catch (err) {

        console.error(err);

        updateStatus(
            '❌ Failed to start video stream'
        );

        if (btn) btn.disabled = false;
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

            console.log("notes:", midiManager.notes.length);

            if (midiManager.notes.length > 0) {
                console.log(midiManager.notes[0]);
            }

            updateStatus('MIDI loaded');
        }
    };

    input.click();
}

function startPlayback() {

    console.log(
        "started",
        started,
        midiManager.startTime
    );
    
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

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    let pianoCanvas = null;

    // throttle heavy op (IMPORTANT for mobile FPS)
    if (isCalibrated) {
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

    console.log("notes:", midiManager.notes.length);
    console.log("first note:", midiManager.notes[0]);
    console.log("first key:", pianoManager.all_keys[0]);
    console.log("last key:", pianoManager.all_keys[pianoManager.all_keys.length - 1]);

    
    if (started && midiManager?.notes?.length) {
        const t = performance.now() / 1000;
        midiManager.drawVisualization(ctx, canvas.height, t - midiManager.startTime);
    }
}

window.onload = initTrackmaker;
