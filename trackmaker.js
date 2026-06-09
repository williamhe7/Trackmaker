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

async function initONNX() {
    session = await ort.InferenceSession.create('best_v3.onnx', { executionProviders: ['wasm', 'webgl'] });
    console.log('ONNX model loaded');
}

export async function initTrackmaker() {
    canvas = document.getElementById('canvas');
    ctx = canvas.getContext('2d');
    
    await initONNX();
    
    keypointManager = new KeypointManager();
    pianoManager = new PianoManager(keypointManager);
    midiManager = new MidiManager(pianoManager);

    // Button handlers
    document.getElementById('btnWebcam').onclick = startWebcam;
    document.getElementById('btnMIDI').onclick = selectMIDI;
    document.getElementById('btnCalibrate').onclick = calibrate;
    document.getElementById('btnStart').onclick = startPlayback;
}

async function startWebcam() {
    stream = await navigator.mediaDevices.getUserMedia({video: true});
    video = document.createElement('video');
    video.srcObject = stream;
    await video.play();
    isRunning = true;
    document.getElementById('btnStart').disabled = false;
    loop();
}

async function calibrate() {
    if (!video || !session) return;
    const kps = await keypointManager.getKeypoints(video, session);
    if (kps.length > 1) {
        keypointManager.computeHomography(kps);
        pianoManager.initKeys();
        document.getElementById('status').textContent = `Calibrated with ${kps.length} key groups`;
    }
}

function selectMIDI() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.mid,.midi';
    input.onchange = async e => {
        if (e.target.files[0]) {
            await midiManager.loadMIDI(e.target.files[0]);
        }
    };
    input.click();
}

function startPlayback() {
    started = true;
    midiManager.startTime = performance.now() / 1000;
}

function loop() {
    if (!isRunning) return;

    if (video) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height * 0.6);
        
        if (started) {
            const now = performance.now() / 1000;
            midiManager.drawVisualization(ctx, canvas.height, now - midiManager.startTime);
        }
    }

    requestAnimationFrame(loop);
}

// Auto-init
initTrackmaker();
