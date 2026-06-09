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
    updateStatus('Loading AI model (this may take 10-30s on mobile)...');
    try {
        session = await ort.InferenceSession.create('best_v3.onnx', {
            executionProviders: ['wasm'],   // Force WASM for better mobile stability
            graphOptimizationLevel: 'basic'
        });
        updateStatus('✅ Model loaded successfully');
        return true;
    } catch (e) {
        console.error('ONNX Load Error:', e);
        updateStatus('❌ Model failed to load. Try on desktop or refresh.');
        return false;
    }
}

export async function initTrackmaker() {
    canvas = document.getElementById('canvas');
    ctx = canvas.getContext('2d');
    
    const success = await initONNX();
    
    keypointManager = new KeypointManager();
    pianoManager = new PianoManager(keypointManager);
    midiManager = new MidiManager(pianoManager, 180);

    setupUI();
    if (success) {
        updateStatus('✅ Ready — Tap "Start Camera"');
    }
}

function updateStatus(msg) {
    const statusEl = document.getElementById('status');
    if (statusEl) statusEl.textContent = msg;
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
                facingMode: { exact: "user" },
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

        isRunning = true;
        document.getElementById('btnCalibrate').disabled = false;
        updateStatus('✅ Selfie Camera Active — Point at piano and tap Recalibrate');
        loop();
    } catch (e) {
        console.error('Camera Error:', e);
        updateStatus('❌ Camera error: ' + e.message);
        if (btn) btn.disabled = false;
    }
}

function resizeCanvas() {
    if (!canvas) return;
    canvas.width = window.innerWidth;
    const topBar = document.getElementById('top-bar');
    const topHeight = topBar ? topBar.offsetHeight : 140;
    canvas.height = window.innerHeight - topHeight - 10;
}

async function calibrate() {
    if (!video || !session) {
        updateStatus('Camera or model not ready');
        return;
    }
    updateStatus('Detecting piano keys...');
    
    try {
        const kps = await keypointManager.getKeypoints(video, session);
        if (kps && kps.length >= 2) {
            keypointManager.computeHomography(kps);
            pianoManager.initKeys();
            isCalibrated = true;
            document.getElementById('btnMIDI').disabled = false;
            document.getElementById('btnStart').disabled = false;
            updateStatus(`✅ Calibrated with ${kps.length} key groups`);
        } else {
            updateStatus('⚠️ Not enough keys detected. Try better lighting.');
        }
    } catch (e) {
        console.error(e);
        updateStatus('Detection failed — check console');
    }
}

// Other functions (selectMIDI, startPlayback, toggleFullscreen, loop) remain the same as previous version
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

function toggleFullscreen() {
    const container = document.getElementById('canvas-container');
    if (!document.fullscreenElement) {
        container.requestFullscreen().catch(() => {});
    } else {
        document.exitFullscreen();
    }
}

document.addEventListener('fullscreenchange', () => setTimeout(resizeCanvas, 100));

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
    let drawH = drawW / ratio;
    let offsetY = (canvas.height - drawH) / 2;

    if (drawH > canvas.height) {
        drawH = canvas.height;
        drawW = drawH * ratio;
    }

    ctx.drawImage(video, (canvas.width - drawW)/2, offsetY, drawW, drawH);

    if (started && midiManager.notes.length > 0) {
        const currentTime = performance.now() / 1000;
        midiManager.drawVisualization(ctx, canvas.height, currentTime - midiManager.startTime);
    }
    ctx.restore();

    requestAnimationFrame(loop);
}

window.onload = initTrackmaker;
