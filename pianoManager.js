export class PianoManager {
    constructor(keypointManager) {
        this.keypointManager = keypointManager;

        this.key_number_dict = {2:7, 3:14, 4:21, 5:28, 6:35, 7:42};
        this.wkey_dict = ["A","B","C","D","E","F","G"];

        this.wkeys = [];
        this.bkeys = [];
        this.all_keys = [];

        // NEW: UI + calibration state
        this.middleCIndex = null;
        this.isCalibrated = false;

        this.overlay = document.getElementById("key-overlay");
    }

    /* -----------------------------
        MAIN ENTRY
    ----------------------------- */
    initKeys() {
        this.initWKeys();
        this.initBKeys();

        // reset calibration every time
        this.middleCIndex = null;
        this.isCalibrated = false;

        this.spawnMiddleCUI();
    }

    /* -----------------------------
        WHITE KEYS
    ----------------------------- */
    initWKeys() {
        const numWkeys =
            this.key_number_dict[this.keypointManager.keys.length] || 14;

        const keyWidth =
            this.keypointManager.scaled_width / numWkeys;

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
    }

    /* -----------------------------
        BLACK KEYS
    ----------------------------- */
    initBKeys() {
        this.bkeys = [];
        this.all_keys = [];

        const wkeyWidth =
            this.keypointManager.scaled_width / this.wkeys.length;

        const bkeyWidth = wkeyWidth / 2;

        const key_x_dict = {
            "A":0.766,
            "C":0.532,
            "D":0.766,
            "F":0.532,
            "G":0.617
        };

        for (let i = 0; i < this.wkeys.length - 1; i++) {
            this.all_keys.push(this.wkeys[i]);

            const currSig = this.wkeys[i].signature;
            const nextSig = this.wkeys[i + 1].signature;

            if (nextSig - currSig > 1) {

                const name = this.wkeys[i].name;
                const offset = key_x_dict[name] || 0.6;

                const key_x =
                    this.wkeys[i].x + offset * wkeyWidth;

                const bSig = currSig + 1;

                this.bkeys.push({
                    name: this.getNoteName(bSig),
                    x: key_x,
                    width: bkeyWidth,
                    signature: bSig,
                    isBlack: true
                });

                this.all_keys.push(
                    this.bkeys[this.bkeys.length - 1]
                );
            }
        }

        this.all_keys.push(
            this.wkeys[this.wkeys.length - 1]
        );
    }

    /* -----------------------------
        STEP 1: UI SELECTION
    ----------------------------- */
    spawnMiddleCUI() {
    
        if (!this.overlay) return;
    
        this.overlay.innerHTML = "";
        this.overlay.style.display = "block";
    
        const numKeys = this.wkeys.length;
    
        for (let i = 0; i < numKeys; i++) {
    
            const key = this.wkeys[i];
    
            const btn = document.createElement("button");
    
            btn.textContent =
                key.name === "C"
                    ? `C (${i})`
                    : key.name;
    
            btn.style.position = "absolute";
    
            btn.style.left =
                `${100 * i / numKeys}%`;
    
            btn.style.width =
                `${100 / numKeys}%`;
    
            btn.style.bottom = "0px";
    
            btn.style.height = "45%";
    
            btn.style.zIndex = "9999";
    
            btn.style.opacity = "0.5";
    
            btn.style.background =
                "rgba(255,255,255,0.25)";
    
            btn.style.color = "white";
    
            btn.style.border =
                "1px solid rgba(255,255,255,0.3)";
    
            btn.style.fontSize = "14px";
    
            btn.style.pointerEvents = "auto";
    
            btn.style.touchAction = "manipulation";
    
            btn.addEventListener(
                "pointerdown",
                (e) => {
    
                    e.preventDefault();
    
                    console.log(
                        "Selected middle C:",
                        i
                    );
    
                    this.setMiddleC(i);
                }
            );
    
            this.overlay.appendChild(btn);
        }
    
        console.log(
            "Spawned",
            numKeys,
            "middle-C buttons"
        );
    }

    /* -----------------------------
        STEP 2: USER SELECTS MIDDLE C
    ----------------------------- */
    setMiddleC(index) {
        this.middleCIndex = index;
        this.isCalibrated = true;

        if (this.overlay) {
            this.overlay.style.display = "none";
            this.overlay.innerHTML = "";
        }

        this.assignSignaturesFromMiddleC();
        this.initBKeys();

        console.log("Middle C set at index:", index);
    }

    /* -----------------------------
        SIGNATURE MAPPING
    ----------------------------- */
    assignSignaturesFromMiddleC() {
        const midi_dict = {
            "C":60, "D":62, "E":64,
            "F":65, "G":67, "A":69, "B":71
        };

        const dist_C_dict = {
            "C":0, "D":1, "E":2,
            "F":3, "G":4, "A":5, "B":6
        };

        const middle_C_idx = this.middleCIndex;

        for (let i = 0; i < this.wkeys.length; i++) {

            const note = this.wkeys[i].name;

            const dist_idx =
                i - (middle_C_idx + dist_C_dict[note]);

            const octave_offset =
                Math.floor(dist_idx / 7) * 12;

            this.wkeys[i].signature =
                midi_dict[note] + octave_offset;
        }
    }

    /* -----------------------------
        UTIL
    ----------------------------- */
    getNoteName(signature) {
        const notes = [
            "C","C#","D","D#","E","F",
            "F#","G","G#","A","A#","B"
        ];

        return notes[signature % 12];
    }
}
