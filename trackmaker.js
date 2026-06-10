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

const MODEL_URL = 'best_v3.onnx';

async function initONNX() {
    updateStatus('Loading AI model... (may take 20-40s on mobile)');
    try {
        session = await ort.InferenceSession.create(MODEL_URL, { executionProviders: ['wasm'] });
        updateStatus('✅ Model loaded');
        return true;
    } catch (e) {
        console.error(e);
        updateStatus('❌ Model load failed');
        return false;
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
    document.getElementById('btnCalibrate').onclick = calibrate;
    document.getElementById('btnMIDI').onclick = selectMIDI;
    document.getElementById('btnStart').onclick = startPlayback;
    document.getElementById('fullscreen-btn').onclick = toggleFullscreen;
}

async function startWebcam() {
    const btn = document.getElementById('btnWebcam');
    if (btn) btn.disabled = true;
    
    try {
        updateStatus('Requesting Selfie Camera...');
        
        stream = await navigator.mediaDevices.getUserMedia({ 
            video: { 
                facingMode: { exact: "user" },   // Force Front/Selfie
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
        window.addEventListener('resize', resizeCanvas);
        window.addEventListener('orientationchange', () => setTimeout(resizeCanvas, 300));

        isRunning = true;
        document.getElementById('btnCalibrate').disabled = false;
        updateStatus('✅ Selfie Camera — Rotate phone horizontally for best view');
        loop();
    } catch (e) {
        console.error(e);
        updateStatus('❌ Camera error: ' + e.message);
        if (btn) btn.disabled = false;
    }
}

function resizeCanvas() {
    if (!canvas) return;
    canvas.width = window.innerWidth;
    const topHeight = document.getElementById('top-bar')?.offsetHeight || 140;
    canvas.height = window.innerHeight - topHeight - 8;
}

async function calibrate() {
    if (!video || !session) return;
    updateStatus('Detecting keys...');
    try {
        const kps = await keypointManager.getKeypoints(video, session);
        if (kps?.length >= 2) {
            keypointManager.computeHomography(kps);
            pianoManager.initKeys();
            isCalibrated = true;
            document.getElementById('btnMIDI').disabled = false;
            document.getElementById('btnStart').disabled = false;
            updateStatus(`✅ Calibrated (${kps.length} groups)`);
        } else {
            updateStatus('⚠️ Not enough keys. Try better lighting.');
        }
    } catch (e) {
        console.error(e);
        updateStatus('Detection failed');
    }
}

function selectMIDI() {
    if (!isCalibrated) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.mid,.midi';
    input.onchange = async e => {
        if (e.target.files[0]) await midiManager.loadMIDI(e.target.files[0]);
    };
    input.click();
}

function startPlayback() {
    if (!isCalibrated) return;
    started = true;
    midiManager.startTime = performance.now() / 1000;
    updateStatus('🎵 Playback started');
}

function toggleFullscreen() {
    const container = document.getElementById('canvas-container');
    if (!document.fullscreenElement) {
        container.requestFullscreen({ navigationUI: "hide" }).catch(err => {
            console.error(err);
            alert("Fullscreen not supported on this device");
        });
    } else {
        document.exitFullscreen();
    }
}

document.addEventListener('fullscreenchange', () => {
    setTimeout(resizeCanvas, 200);
});

function loop() {
    if (!isRunning || !video) {
        requestAnimationFrame(loop);
        return;
    }

    ctx.save();
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const vW = video.videoWidth || 1280;
    const vH = video.videoHeight || 720;
    const ratio = vW / vH;

    let drawW = canvas.width;
    let drawH = canvas.height;
    let offsetX = 0;
    let offsetY = 0;

    if (canvas.width / canvas.height > ratio) {
        drawW = canvas.height * ratio;
        offsetX = (canvas.width - drawW) / 2;
    } else {
        drawH = canvas.width / ratio;
        offsetY = (canvas.height - drawH) / 2;
    }

    ctx.drawImage(video, offsetX, offsetY, drawW, drawH);

    if (started && midiManager.notes.length > 0) {
        const currentTime = performance.now() / 1000;
        midiManager.drawVisualization(ctx, canvas.height, currentTime - midiManager.startTime);
    }
    ctx.restore();

    requestAnimationFrame(loop);
}

window.onload = initTrackmaker;
