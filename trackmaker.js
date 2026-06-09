// trackmaker.js
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

async function initONNX() {
    try {
        session = await ort.InferenceSession.create('best_v3.onnx', {
            executionProviders: ['wasm', 'webgl']
        });
        updateStatus('✅ Model ready');
    } catch (e) {
        console.error(e);
        updateStatus('❌ Model load failed');
    }
}

export async function initTrackmaker() {
    canvas = document.getElementById('canvas');
    ctx = canvas.getContext('2d');
    
    await initONNX();
    
    keypointManager = new KeypointManager();
    pianoManager = new PianoManager(keypointManager);
    midiManager = new MidiManager(pianoManager, 180);

    setupUI();
    updateStatus('Tap "Start Camera"');
}

function updateStatus(msg) {
    document.getElementById('status').textContent = msg;
}

function setupUI() {
    document.getElementById('btnWebcam').onclick = startWebcam;
    document.getElementById('btnMIDI').onclick = selectMIDI;
    document.getElementById('btnCalibrate').onclick = calibrate;
    document.getElementById('btnStart').onclick = startPlayback;
}

function enableAfterCalibration() {
    isCalibrated = true;
    document.getElementById('btnMIDI').disabled = false;
    document.getElementById('btnStart').disabled = false;
}

async function startWebcam() {
    try {
        stream = await navigator.mediaDevices.getUserMedia({ 
            video: { 
                facingMode: "user",           // ← Changed to FRONT camera for mobile
                width: { ideal: 1280 },
                height: { ideal: 720 }
            } 
        });
        video = document.createElement('video');
        video.srcObject = stream;
        video.playsInline = true;
        video.muted = true;
        await video.play();

        // Make canvas fill the remaining space
        resizeCanvas();
        window.addEventListener('resize', resizeCanvas);

        isRunning = true;
        document.getElementById('btnCalibrate').disabled = false;
        updateStatus('Camera active (front) — Point at piano and tap Recalibrate');
        loop();
    } catch (e) {
        updateStatus('Camera failed: ' + e.message);
        console.error(e);
    }
}

function resizeCanvas() {
    if (!canvas || !video) return;
    canvas.width = window.innerWidth;
    // Use almost full remaining height
    canvas.height = window.innerHeight - document.getElementById('top-bar').offsetHeight - 20;
}

async function calibrate() {
    if (!video || !session) return;
    updateStatus('Detecting keys...');
    
    const kps = await keypointManager.getKeypoints(video, session);
    if (kps?.length >= 2) {
        keypointManager.computeHomography(kps);
        pianoManager.initKeys();
        enableAfterCalibration();
        updateStatus(`✅ Calibrated (${kps.length} groups)`);
    } else {
        updateStatus('⚠️ Not enough keys. Better lighting/angle needed.');
    }
}

function selectMIDI() {
    if (!isCalibrated) return;
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
    if (!isCalibrated) return;
    started = true;
    midiManager.startTime = performance.now() / 1000;
    updateStatus('🎵 Playback started');
}

function loop() {
    if (!isRunning || !video) {
        requestAnimationFrame(loop);
        return;
    }

    ctx.save();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    const vW = video.videoWidth;
    const vH = video.videoHeight;
    if (vW && vH) {
        const ratio = vW / vH;
        let drawW = canvas.width;
        let drawH = drawW / ratio;
        let offsetY = (canvas.height - drawH) / 2;

        if (drawH > canvas.height) {
            drawH = canvas.height;
            drawW = drawH * ratio;
        }

        ctx.drawImage(video, (canvas.width - drawW)/2, offsetY, drawW, drawH);
    }

    if (started && midiManager.notes.length > 0) {
        const currentTime = performance.now() / 1000;
        midiManager.drawVisualization(ctx, canvas.height, currentTime - midiManager.startTime);
    }
    ctx.restore();

    requestAnimationFrame(loop);
}

window.onload = initTrackmaker;
