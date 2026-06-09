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
let lastDetectionTime = 0;

async function initONNX() {
    try {
        session = await ort.InferenceSession.create('best_v3.onnx', {
            executionProviders: ['wasm', 'webgl'],
            graphOptimizationLevel: 'all'
        });
        console.log('✅ ONNX model loaded successfully');
    } catch (e) {
        console.error('ONNX load failed:', e);
    }
}

export async function initTrackmaker() {
    canvas = document.getElementById('canvas');
    ctx = canvas.getContext('2d', { willReadFrequently: true });
    
    await initONNX();
    
    keypointManager = new KeypointManager();
    pianoManager = new PianoManager(keypointManager);
    midiManager = new MidiManager(pianoManager, 180); // slightly faster fall speed

    setupUI();
    console.log('🚀 Trackmaker initialized');
}

function setupUI() {
    document.getElementById('btnWebcam').onclick = startWebcam;
    document.getElementById('btnMIDI').onclick = selectMIDI;
    document.getElementById('btnCalibrate').onclick = calibrate;
    document.getElementById('btnStart').onclick = startPlayback;
}

async function startWebcam() {
    try {
        stream = await navigator.mediaDevices.getUserMedia({ 
            video: { width: 1280, height: 720 } 
        });
        video = document.createElement('video');
        video.srcObject = stream;
        await video.play();
        isRunning = true;
        document.getElementById('btnStart').disabled = false;
        document.getElementById('status').textContent = 'Webcam started — click Recalibrate';
        loop();
    } catch (e) {
        alert('Webcam error: ' + e.message);
    }
}

async function calibrate() {
    if (!video || !session) return;
    document.getElementById('status').textContent = 'Detecting keypoints...';
    
    const kps = await keypointManager.getKeypoints(video, session);
    if (kps && kps.length >= 2) {
        keypointManager.computeHomography(kps);
        pianoManager.initKeys();
        document.getElementById('status').textContent = 
            `✅ Calibrated! Detected ${kps.length} key groups`;
    } else {
        document.getElementById('status').textContent = '⚠️ Not enough keypoints detected. Try better lighting/angle.';
    }
}

function selectMIDI() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.mid,.midi';
    input.onchange = async (e) => {
        if (e.target.files[0]) {
            await midiManager.loadMIDI(e.target.files[0]);
            document.getElementById('status').textContent = 'MIDI loaded';
        }
    };
    input.click();
}

function startPlayback() {
    if (!started) {
        started = true;
        midiManager.startTime = performance.now() / 1000;
        document.getElementById('status').textContent = '🎵 Playback started!';
    }
}

function loop() {
    if (!isRunning) return;

    if (video) {
        // Draw raw webcam (or transformed if calibrated)
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height * 0.6);

        if (keypointManager.homography.length > 0) {
            // TODO: Use transformed frame when full pipeline is stable
            // const frameMat = cv.imread(canvas); // advanced path
        }

        if (started && midiManager.notes.length > 0) {
            const currentTime = performance.now() / 1000;
            midiManager.drawVisualization(ctx, canvas.height, currentTime - midiManager.startTime);
        }

        // Periodic recalibration
        if (Date.now() - lastDetectionTime > 8000) {
            lastDetectionTime = Date.now();
            // Throttled background detection can go here
        }
    }

    requestAnimationFrame(loop);
}

// Auto start
window.onload = initTrackmaker;
