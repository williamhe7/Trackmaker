// pianoManager.js
export class PianoManager {
    constructor(keypointManager) {
        this.keypointManager = keypointManager;
        this.key_number_dict = {2:7, 3:14, 4:21, 5:28, 6:35, 7:42};
        this.wkey_dict = ["A","B","C","D","E","F","G"];
        this.wkeys = [];
        this.bkeys = [];
        this.all_keys = [];
    }

    initKeys() {
        this.initWKeys();
        this.initBKeys();
    }

    initWKeys() {
        const numWkeys = this.key_number_dict[this.keypointManager.keys.length] || 14;
        const keyWidth = this.keypointManager.scaled_width / numWkeys;
        this.wkeys = [];
        let currentX = 0;

        for (let i = 0; i < numWkeys; i++) {
            this.wkeys.push({
                name: this.wkey_dict[i % 7],
                x: currentX,
                width: keyWidth,
                signature: 0
            });
            currentX += keyWidth;
        }

        this.assignSignatures();
    }

    assignSignatures() {
        const midi_dict = { "C":60, "D":62, "E":64, "F":65, "G":67, "A":69, "B":71 };
        const dist_C_dict = { "C":0, "D":1, "E":2, "F":3, "G":4, "A":5, "B":6 };

        const middleWidth = this.keypointManager.scaled_width / 2;
        let middle_C_idx = -1;
        let minDist = Infinity;

        for (let i = 0; i < this.wkeys.length; i++) {
            if (this.wkeys[i].name === "C") {
                const dist = Math.abs(middleWidth - (this.wkeys[i].x + this.wkeys[i].width / 2));
                if (dist < minDist) {
                    minDist = dist;
                    middle_C_idx = i;
                }
            }
        }

        for (let i = 0; i < this.wkeys.length; i++) {
            const note = this.wkeys[i].name;
            const dist_idx = i - (middle_C_idx + dist_C_dict[note]);
            const octave_offset = Math.floor(dist_idx / 7) * 12;
            this.wkeys[i].signature = midi_dict[note] + octave_offset;
        }
    }

    initBKeys() {
        this.bkeys = [];
        this.all_keys = [];
        const wkeyWidth = this.keypointManager.scaled_width / this.wkeys.length;
        const bkeyWidth = wkeyWidth / 2;

        const key_x_dict = { "A":0.766, "C":0.532, "D":0.766, "F":0.532, "G":0.617 };

        for (let i = 0; i < this.wkeys.length - 1; i++) {
            this.all_keys.push(this.wkeys[i]);

            const currSig = this.wkeys[i].signature;
            const nextSig = this.wkeys[i + 1].signature;

            if (nextSig - currSig > 1) {
                const name = this.wkeys[i].name;
                const offset = key_x_dict[name] || 0.6;
                const key_x = this.wkeys[i].x + offset * wkeyWidth;
                const bSig = currSig + 1;
                const bName = this.getNoteName(bSig);

                this.bkeys.push({
                    name: bName,
                    x: key_x,
                    width: bkeyWidth,
                    signature: bSig,
                    isBlack: true
                });
                this.all_keys.push(this.bkeys[this.bkeys.length - 1]);
            }
        }
        this.all_keys.push(this.wkeys[this.wkeys.length - 1]);
    }

    getNoteName(signature) {
        const notes = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
        return notes[signature % 12];
    }
}
