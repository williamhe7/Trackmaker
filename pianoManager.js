export class PianoManager {

    constructor(keypointManager) {
        this.keypointManager = keypointManager;

        this.key_number_dict = {
            2: 7, 3: 14, 4: 21, 5: 28, 6: 35, 7: 42
        };

        this.wkeys = [];
        this.bkeys = [];
        this.all_keys = [];

        this.middleCIndex = null;
        this.isCalibrated = false;
    }

    initKeys() {
        this.initWKeys();
        this.middleCIndex = null;
        this.isCalibrated = false;
        this.bkeys = [];
        this.all_keys = [...this.wkeys];

        this.showMiddleCInput();
    }

    initWKeys() {
        const numWkeys = this.key_number_dict[this.keypointManager.keys.length] || 14;
        const keyWidth = this.keypointManager.scaled_width / numWkeys;

        this.wkeys = [];
        let currentX = 0;

        for (let i = 0; i < numWkeys; i++) {
            this.wkeys.push({
                index: i,
                x: currentX,
                width: keyWidth,
                signature: 0,
                isBlack: false
            });
            currentX += keyWidth;
        }
    }

    showMiddleCInput() {
        const panel = document.getElementById('middle-c-panel');
        const input = document.getElementById('middle-c-input');
        const confirmBtn = document.getElementById('middle-c-confirm');

        if (!panel || !input || !confirmBtn) return;

        input.value = Math.floor(this.wkeys.length / 2); // sensible default
        panel.style.display = 'flex';

        confirmBtn.onclick = () => {
            const index = parseInt(input.value);
            if (isNaN(index) || index < 0 || index >= this.wkeys.length) {
                alert(`Please enter a number between 0 and ${this.wkeys.length - 1}`);
                return;
            }
            this.setMiddleC(index);
        };
    }

    setMiddleC(index) {
        console.log("Middle C index =", index);

        this.middleCIndex = index;
        this.assignSignatures();
        this.initBKeys();
        this.isCalibrated = true;

        // Hide panel
        const panel = document.getElementById('middle-c-panel');
        if (panel) panel.style.display = 'none';

        // Enable MIDI and Start buttons
        document.getElementById('btnMIDI').disabled = false;
        document.getElementById('btnStart').disabled = false;

        document.getElementById('status').textContent = 
            `Middle C set to index ${index} • ${this.all_keys.length} keys ready`;
    }

    assignSignatures() {
        const whiteOffsets = [0, 2, 4, 5, 7, 9, 11];

        for (let i = 0; i < this.wkeys.length; i++) {
            const relative = i - this.middleCIndex;
            const octave = Math.floor(relative / 7);
            let pos = relative % 7;
            if (pos < 0) pos += 7;

            const midi = 60 + octave * 12 + whiteOffsets[pos];
            this.wkeys[i].signature = midi;
        }
    }

    initBKeys() {
        this.bkeys = [];
        this.all_keys = [];

        const wkeyWidth = this.keypointManager.scaled_width / this.wkeys.length;

        for (let i = 0; i < this.wkeys.length; i++) {
            const white = this.wkeys[i];
            this.all_keys.push(white);

            const note = this.getNoteName(white.signature);
            const hasBlack = ["C","D","F","G","A"].includes(note);

            if (!hasBlack) continue;

            const black = {
                name: note + "#",
                signature: white.signature + 1,
                x: white.x + wkeyWidth * 0.72,
                width: wkeyWidth * 0.55,
                isBlack: true
            };

            this.bkeys.push(black);
            this.all_keys.push(black);
        }
    }

    getNoteName(signature) {
        const notes = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
        return notes[((signature % 12) + 12) % 12];
    }
}
