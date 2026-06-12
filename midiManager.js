// midiManager.js
export class MidiManager {
    constructor(pianoManager, avgSpeed = 150) {
        this.pianoManager = pianoManager;
        this.avgSpeed = avgSpeed;
        this.notes = [];
        this.startTime = null;
    }

    async loadMIDI(file) {
    
        try {
    
            const arrayBuffer = await file.arrayBuffer();
    
            const midiData = MidiParser.parse(
                new Uint8Array(arrayBuffer)
            );
    
            this.notes = [];
    
            const ticksPerBeat =
                midiData.timeDivision || 480;
    
            // -------------------------
            // Detect BPM from MIDI
            // -------------------------
    
            let bpm = 120;
    
            outerLoop:
            for (const track of midiData.track) {
    
                for (const event of track.event) {
    
                    if (
                        event.metaType === 81 &&
                        event.data
                    ) {
    
                        if (
                            typeof event.data === "number"
                        ) {
    
                            bpm =
                                60000000 /
                                event.data;
    
                        } else if (
                            Array.isArray(event.data) &&
                            event.data.length === 3
                        ) {
    
                            const microseconds =
                                (event.data[0] << 16) |
                                (event.data[1] << 8) |
                                event.data[2];
    
                            bpm =
                                60000000 /
                                microseconds;
                        }
    
                        console.log(
                            "Detected BPM:",
                            bpm
                        );
    
                        break outerLoop;
                    }
                }
            }
    
            const secondsPerBeat =
                60 / bpm;
    
            console.log(
                "ticksPerBeat:",
                ticksPerBeat
            );
    
            console.log(
                "secondsPerBeat:",
                secondsPerBeat
            );
    
            let totalEvents = 0;
            let noteOnCount = 0;
            let noteOffCount = 0;
    
            // -------------------------
            // Parse notes
            // -------------------------
    
            for (
                let trackIndex = 0;
                trackIndex < midiData.track.length;
                trackIndex++
            ) {
    
                const track =
                    midiData.track[trackIndex];
    
                let currentTicks = 0;
    
                const activeNotes =
                    new Map();
    
                for (
                    let eventIndex = 0;
                    eventIndex < track.event.length;
                    eventIndex++
                ) {
    
                    const event =
                        track.event[eventIndex];
    
                    totalEvents++;
    
                    currentTicks +=
                        event.deltaTime || 0;
    
                    const type =
                        event.type;
    
                    const data =
                        event.data;
    
                    if (
                        !Array.isArray(data)
                    ) {
                        continue;
                    }
    
                    // -------------------------
                    // NOTE ON
                    // -------------------------
    
                    if (
                        type === 9 &&
                        data.length >= 2 &&
                        data[1] > 0
                    ) {
    
                        noteOnCount++;
    
                        const pitch =
                            data[0];
    
                        activeNotes.set(
                            pitch,
                            currentTicks
                        );
                    }
    
                    // -------------------------
                    // NOTE OFF
                    // -------------------------
    
                    else if (
                        type === 8 ||
                        (
                            type === 9 &&
                            data.length >= 2 &&
                            data[1] === 0
                        )
                    ) {
    
                        noteOffCount++;
    
                        const pitch =
                            data[0];
    
                        if (
                            activeNotes.has(
                                pitch
                            )
                        ) {
    
                            const startTicks =
                                activeNotes.get(
                                    pitch
                                );
    
                            const startSec =
                                (
                                    startTicks /
                                    ticksPerBeat
                                ) *
                                secondsPerBeat;
    
                            const endSec =
                                (
                                    currentTicks /
                                    ticksPerBeat
                                ) *
                                secondsPerBeat;
    
                            this.notes.push({
    
                                signature:
                                    pitch,
    
                                start:
                                    startSec,
    
                                end:
                                    endSec,
    
                                length:
                                    (
                                        endSec -
                                        startSec
                                    ) *
                                    this.avgSpeed
                            });
    
                            activeNotes.delete(
                                pitch
                            );
                        }
                    }
                }
            }
    
            this.notes.sort(
                (a, b) =>
                    a.start - b.start
            );
    
            console.log(
                "Loaded notes:",
                this.notes.length
            );
    
            console.log(
                "Note On events:",
                noteOnCount
            );
    
            console.log(
                "Note Off events:",
                noteOffCount
            );
    
            if (
                this.notes.length > 0
            ) {
    
                console.log(
                    "First note:",
                    this.notes[0]
                );
    
                console.log(
                    "Last note:",
                    this.notes[
                        this.notes.length - 1
                    ]
                );
            }
    
        } catch (e) {
    
            console.error(
                "MIDI parsing failed:",
                e
            );
        }
    }

    drawVisualization(ctx, canvasHeight, currentTime) {
        if (this.startTime === null || !this.pianoManager) return;

        const km = this.pianoManager.keypointManager;
        const drawInfo = km.lastDrawInfo || { 
            drawX: 0, 
            scale: 1, 
            pianoW: km.scaled_width 
        };

        const noteAreaTop = 0;                    // Start from very top
        const noteAreaHeight = canvasHeight * 0.5; // Top half of screen

        ctx.save();

        for (let note of this.notes) {
            const yHead = (currentTime - note.start) * this.avgSpeed;
            const yTop = yHead - note.length;

            if (yHead < 0 || yTop > noteAreaHeight) continue;

            const key = this.pianoManager.all_keys.find(k => k.signature === note.signature);
            if (!key) continue;

            // Convert internal piano coordinates → screen coordinates
            const screenX = drawInfo.drawX + (key.x / drawInfo.pianoW) * (drawInfo.pianoW * drawInfo.scale);
            const screenWidth = (key.width / drawInfo.pianoW) * (drawInfo.pianoW * drawInfo.scale);

            const clampedTop = Math.max(0, yTop);
            const clampedBottom = Math.min(noteAreaHeight, yHead);

            // Falling note
            ctx.fillStyle = key.isBlack ? 'rgba(220, 50, 50, 0.95)' : 'rgba(255, 80, 80, 0.9)';
            ctx.fillRect(screenX, noteAreaTop + clampedTop, screenWidth, clampedBottom - clampedTop);

            // Border
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2;
            ctx.strokeRect(screenX, noteAreaTop + clampedTop, screenWidth, clampedBottom - clampedTop);
        }

        ctx.restore();
    }
}
