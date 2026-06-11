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
            const midiData = MidiParser.parse(new Uint8Array(arrayBuffer));
            
            this.notes = [];
            let currentTime = 0;
            const tempo = 120; // default BPM, can be parsed from meta events if needed
            const ticksPerBeat = midiData.timeDivision || 480;

            for (let track of midiData.track) {
                currentTime = 0;
                let activeNotes = new Map(); // pitch -> start time

                for (let event of track.event) {
                    currentTime += event.deltaTime;

                    if (event.type === 8 || (event.type === 9 && event.data[1] === 0)) { 
                        // Note Off
                        const pitch = event.data[0];
                        if (activeNotes.has(pitch)) {
                            const start = activeNotes.get(pitch);
                            const duration = (currentTime - start) / ticksPerBeat * (tempo / 60);
                            this.notes.push({
                                signature: pitch,
                                start: start / ticksPerBeat * (tempo / 60),
                                end: currentTime / ticksPerBeat * (tempo / 60),
                                length: duration * this.avgSpeed * 1.2 // visual length scaling
                            });
                            activeNotes.delete(pitch);
                        }
                    } else if (event.type === 9 && event.data[1] > 0) {
                        // Note On
                        const pitch = event.data[0];
                        activeNotes.set(pitch, currentTime);
                    }
                }
            }

            // Sort notes by start time
            this.notes.sort((a, b) => a.start - b.start);
            console.log(`✅ Loaded ${this.notes.length} notes from MIDI`);
            
        } catch (e) {
            console.error("MIDI parsing failed:", e);
        }
    }

    drawVisualization(ctx, canvasHeight, currentTime) {
        if (this.startTime === null) return;

        const noteAreaH = canvasHeight * 0.6;
        ctx.save();

        for (let note of this.notes) {
            const yHead = (currentTime - note.start) * this.avgSpeed;
            const yTop = yHead - note.length;

            if (yHead < 0 || yTop > noteAreaH) continue;

            const key = this.pianoManager.all_keys.find(k => k.signature === note.signature);
            if (!key) continue;

            const clampedTop = Math.max(0, yTop);
            const clampedBottom = Math.min(noteAreaH, yHead);

            // Falling note
            ctx.fillStyle = key.isBlack ? 'rgba(220, 50, 50, 0.95)' : 'rgba(255, 80, 80, 0.9)';
            ctx.fillRect(key.x, clampedTop, key.width, clampedBottom - clampedTop);

            // Border
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2;
            ctx.strokeRect(key.x, clampedTop, key.width, clampedBottom - clampedTop);
        }

        ctx.restore();
    }
}
