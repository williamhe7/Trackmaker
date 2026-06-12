export class PianoManager {

    constructor(keypointManager) {

        this.keypointManager = keypointManager;

        this.key_number_dict = {
            2: 7,
            3: 14,
            4: 21,
            5: 28,
            6: 35,
            7: 42
        };

        this.wkey_dict = [
            "A","B","C","D","E","F","G"
        ];

        this.wkeys = [];
        this.bkeys = [];
        this.all_keys = [];

        this.middleCIndex = null;
        this.isCalibrated = false;

        this.overlay =
            document.getElementById("key-overlay");
    }

    /* ==========================
       MAIN ENTRY
    ========================== */

    initKeys() {
    
        this.initWKeys();
    
        this.middleCIndex = null;
        this.isCalibrated = false;
    
        this.bkeys = [];
        this.all_keys = [...this.wkeys];
    
        this.spawnMiddleCUI();
    }

    /* ==========================
       WHITE KEYS
    ========================== */

    initWKeys() {

        const numWkeys =
            this.key_number_dict[
                this.keypointManager.keys.length
            ] || 14;

        const keyWidth =
            this.keypointManager.scaled_width /
            numWkeys;

        this.wkeys = [];

        let currentX = 0;

        for (let i = 0; i < numWkeys; i++) {

            this.wkeys.push({
                index: i,
                name: this.wkey_dict[i % 7],
                x: currentX,
                width: keyWidth,
                signature: 0,
                isBlack: false
            });

            currentX += keyWidth;
        }
    }

    /* ==========================
       MIDDLE C UI
    ========================== */

    spawnMiddleCUI() {

        if (!this.overlay) {
            console.error(
                "key-overlay not found"
            );
            return;
        }

        this.overlay.innerHTML = "";
        this.overlay.style.display = "block";

        const numKeys =
            this.wkeys.length;

        console.log(
            "Spawning",
            numKeys,
            "buttons"
        );

        for (let i = 0; i < numKeys; i++) {

            const btn =
                document.createElement("button");

            btn.textContent = i;

            btn.style.position =
                "absolute";

            btn.style.left =
                `${100 * i / numKeys}%`;

            btn.style.width =
                `${100 / numKeys}%`;

            btn.style.bottom = "0px";

            btn.style.height = "40%";

            btn.style.zIndex = "9999";

            btn.style.background =
                "rgba(255,255,255,0.25)";

            btn.style.color =
                "white";

            btn.style.border =
                "1px solid rgba(255,255,255,0.3)";

            btn.style.pointerEvents =
                "auto";

            btn.style.touchAction =
                "manipulation";

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
    }

    /* ==========================
       USER PICKS MIDDLE C
    ========================== */

    setMiddleC(index) {
    
        this.middleCIndex = index;
    
        this.assignSignaturesFromMiddleC();
    
        this.initBKeys();
    
        this.isCalibrated = true;
    
        if (this.overlay) {
            this.overlay.innerHTML = "";
            this.overlay.style.display = "none";
        }
    }

    /* ==========================
       SIGNATURES
    ========================== */

    assignSignatures() {

        const midiNames = [
            "C","C#","D","D#","E",
            "F","F#","G","G#",
            "A","A#","B"
        ];

        for (
            let i = 0;
            i < this.wkeys.length;
            i++
        ) {

            const semitoneOffset =
                i - this.middleCIndex;

            this.wkeys[i].signature =
                60 + semitoneOffset;

            this.wkeys[i].name =
                midiNames[
                    (
                        this.wkeys[i].signature %
                        12
                    + 12
                    ) % 12
                ];
        }
    }

    /* ==========================
       BLACK KEYS
    ========================== */

    initBKeys() {

        this.bkeys = [];
        this.all_keys = [];

        const wkeyWidth =
            this.keypointManager.scaled_width /
            this.wkeys.length;

        const blackOffsets = {
            "C": 0.7,
            "D": 0.7,
            "F": 0.7,
            "G": 0.7,
            "A": 0.7
        };

        for (
            let i = 0;
            i < this.wkeys.length;
            i++
        ) {

            const w =
                this.wkeys[i];

            this.all_keys.push(w);

            const note =
                this.getNoteName(
                    w.signature
                );

            if (
                note === "C" ||
                note === "D" ||
                note === "F" ||
                note === "G" ||
                note === "A"
            ) {

                const b =
                {
                    name:
                        note + "#",

                    signature:
                        w.signature + 1,

                    x:
                        w.x +
                        blackOffsets[note] *
                        wkeyWidth,

                    width:
                        wkeyWidth * 0.5,

                    isBlack:
                        true
                };

                this.bkeys.push(b);
                this.all_keys.push(b);
            }
        }

        console.log(
            "White keys:",
            this.wkeys.length
        );

        console.log(
            "Black keys:",
            this.bkeys.length
        );
    }

    /* ==========================
       UTIL
    ========================== */

    getNoteName(signature) {

        const notes = [
            "C","C#","D","D#","E",
            "F","F#","G","G#",
            "A","A#","B"
        ];

        return notes[
            ((signature % 12) + 12) % 12
        ];
    }
}
