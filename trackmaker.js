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
let isMidiEnabled = false;

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

    console.log("version 1.351");

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
                width: { ideal: 1600, min: 1280 },
                height: { ideal: 1200, min: 720 },
                aspectRatio: { ideal: 4 / 3 },
                resizeMode: "none"
            }
        });

        const track = stream.getVideoTracks()[0];

        if (track.applyConstraints) {
            try {
                await track.applyConstraints({
                    width: 1600,
                    height: 1200,
                    aspectRatio: 4 / 3
                });
            } catch (e) {
                console.log("applyConstraints failed (normal iOS)", e);
            }
        }

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

    // IMPORTANT: now we require user selection
    buildKeyOverlay();

    isCalibrated = true;
    isMidiEnabled = false;

    document.getElementById('btnMIDI').disabled = true;
    document.getElementById('btnStart').disabled = true;

    updateStatus(`Select Middle C (${kps.length} keys detected)`);
}

/* -------------------- MIDI -------------------- */

function selectMIDI() {

    if (!isMidiEnabled) {
        updateStatus("Select Middle C first");
        return;
    }

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

/* -------------------- KEY OVERLAY -------------------- */

function buildKeyOverlay() {

    const container =
        document.getElementById("key-overlay");

    container.innerHTML = "";

    const whiteKeys =
        pianoManager.wkeys;

    const whiteKeyWidth =
        canvas.width / whiteKeys.length;

    for (let i = 0; i < whiteKeys.length; i++) {

        const btn =
            document.createElement("button");

        btn.style.position = "absolute";

        btn.style.left =
            `${i * whiteKeyWidth}px`;

        btn.style.bottom = "0px";

        btn.style.width =
            `${whiteKeyWidth}px`;

        btn.style.height =
            "220px";

        btn.style.opacity = "0.35";

        btn.style.background =
            "rgba(255,255,255,0.4)";

        btn.style.border =
            "1px solid rgba(0,0,0,0.4)";

        btn.style.color =
            "transparent";

        btn.style.zIndex = "1000";

        btn.style.pointerEvents = "auto";

        btn.onclick = () => {

            console.log(
                "Selected middle C index:",
                i
            );

            pianoManager.setMiddleC(i);

            container.innerHTML = "";

            isMidiEnabled = true;

            document.getElementById(
                "btnMIDI"
            ).disabled = false;

            document.getElementById(
                "btnStart"
            ).disabled = false;

            updateStatus(
                "Middle C selected"
            );
        };

        container.appendChild(btn);
    }
}

/* -------------------- PLAYBACK -------------------- */

function startPlayback() {

    started = true;
    midiManager.startTime = performance.now() / 1000;

    updateStatus('Playback started');

    ["btnWebcam","btnCalibrate","btnMIDI","btnStart"]
        .forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.disabled = true;
                el.hidden = true;
            }
        });
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

/* -------------------- LOOP -------------------- */

function loop() {

    if (!isRunning) return;

    requestAnimationFrame(loop);

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    let pianoCanvas = null;

    if (isCalibrated) {
        pianoCanvas = keypointManager.transformImage(video);
    }

    if (pianoCanvas) {

        const scaleX = canvas.width / pianoCanvas.width;
        const scaleY = (canvas.height * 0.5) / pianoCanvas.height;
        const scale = Math.min(scaleX, scaleY);

        const w = pianoCanvas.width * scale;
        const h = pianoCanvas.height * scale;

        ctx.drawImage(
            pianoCanvas,
            (canvas.width - w) / 2,
            canvas.height * 0.5,
            w,
            h
        );
    } else {

        const vw = video.videoWidth || 1280;
        const vh = video.videoHeight || 720;

        const r = vw / vh;

        let w = canvas.width;
        let h = w / r;

        if (h > canvas.height) {
            h = canvas.height;
            w = h * r;
        }

        ctx.drawImage(
            video,
            (canvas.width - w) / 2,
            (canvas.height - h) / 2,
            w,
            h
        );
    }

    if (started && midiManager?.notes?.length) {
        const t = performance.now() / 1000;
        midiManager.drawVisualization(ctx, canvas.height, t - midiManager.startTime);
    }
}

window.onload = initTrackmaker;
