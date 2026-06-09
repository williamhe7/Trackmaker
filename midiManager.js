// midiManager.js
export class MidiManager {
    constructor(pianoManager, avgSpeed = 150) {
        this.pianoManager = pianoManager;
        this.avgSpeed = avgSpeed;
        this.notes = [];
        this.startTime = null;
    }

    async loadMIDI(file) {
        const arrayBuffer = await file.arrayBuffer();
        const midi = MidiParser.parse(new Uint8Array(arrayBuffer));
        
        this.notes = [];
        // Convert MIDI events to NoteManager objects
        midi.track.forEach(track => {
            let time = 0;
            track.event.forEach(ev => {
                time += ev.deltaTime;
                if (ev.type === 'noteOn' && ev.data[1] > 0) {
                    // Find matching noteOff etc. - simplified
                    this.notes.push({
                        signature: ev.data[0],
                        start: time / midi.timeDivision,
                        end: time / midi.timeDivision + 1, // placeholder
                        length: 100
                    });
                }
            });
        });
        console.log('Loaded', this.notes.length, 'notes');
    }

    drawVisualization(ctx, canvasHeight, currentTime) {
        const keyboardY = canvasHeight * 0.6;
        const noteAreaH = keyboardY;

        ctx.fillStyle = 'rgba(255,80,80,0.85)';
        for (let note of this.notes) {
            const y = (currentTime - note.start) * this.avgSpeed;
            if (y < -note.length || y > noteAreaH) continue;

            const key = this.pianoManager.all_keys.find(k => k.signature === note.signature);
            if (!key) continue;

            const yTop = Math.max(0, y - note.length);
            ctx.fillRect(key.x, yTop, key.width, note.length);
        }
    }
}
