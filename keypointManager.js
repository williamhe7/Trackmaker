// keypointManager.js
export class KeypointManager {
    constructor() {
        this.w = 1600;
        this.h = 1200;

        this.scale_dict = {
            2: 1.07939633,
            3: 2.15879265,
            4: 3.23818898,
            5: 4.31758530,
            6: 5.39698163,
            7: 6.47637795
        };

        this.keys = [];
        this.homography = [];
        this.source = [];
        this.scale_factor = 1;

        this.scaled_width = 800;
        this.scaled_height = 300;

        // optional FPS optimization
        this._cachedWarp = null;
        this._lastKeyHash = null;
    }

    // ----------------------------
    // MODEL INFERENCE (unchanged)
    // ----------------------------
    async get_kpps(videoElement, session) {
        if (!session) return [];

        const INPUT_SIZE = 1600;

        const ratio = Math.min(
            INPUT_SIZE / videoElement.videoWidth,
            INPUT_SIZE / videoElement.videoHeight
        );

        const newW = Math.round(videoElement.videoWidth * ratio);
        const newH = Math.round(videoElement.videoHeight * ratio);

        const padX = (INPUT_SIZE - newW) / 2;
        const padY = (INPUT_SIZE - newH) / 2;

        const canvas = document.createElement("canvas");
        canvas.width = INPUT_SIZE;
        canvas.height = INPUT_SIZE;

        const ctx = canvas.getContext("2d", { willReadFrequently: true });

        ctx.fillStyle = "rgb(114,114,114)";
        ctx.fillRect(0, 0, INPUT_SIZE, INPUT_SIZE);

        ctx.drawImage(videoElement, padX, padY, newW, newH);

        const imageData = ctx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE);

        const area = INPUT_SIZE * INPUT_SIZE;
        const inputData = new Float32Array(3 * area);

        for (let i = 0; i < area; i++) {
            const p = i * 4;
            inputData[i] = imageData.data[p] / 255.0;
            inputData[i + area] = imageData.data[p + 1] / 255.0;
            inputData[i + area * 2] = imageData.data[p + 2] / 255.0;
        }

        const tensor = new ort.Tensor("float32", inputData, [
            1, 3, INPUT_SIZE, INPUT_SIZE
        ]);

        let results;
        try {
            results = await session.run({ images: tensor });
        } catch {
            const inputName = session.inputNames[0];
            results = await session.run({ [inputName]: tensor });
        }

        const output = results.output0 || Object.values(results)[0];

        return this.sort_by_lowest_x(
            this.postProcessYOLOPose(output.data, ratio, padX, padY)
        );
    }

    postProcessYOLOPose(rawOutput, scale, padX, padY) {
        const detections = [];
        const CONF_THRESHOLD = 0.25;
        const VALUES_PER_DETECTION = 12;

        const numDetections = Math.floor(rawOutput.length / VALUES_PER_DETECTION);

        for (let i = 0; i < numDetections; i++) {
            const o = i * VALUES_PER_DETECTION;

            const conf = rawOutput[o + 4];
            if (conf < CONF_THRESHOLD) continue;

            let kp1x = rawOutput[o + 6];
            let kp1y = rawOutput[o + 7];
            let kp2x = rawOutput[o + 9];
            let kp2y = rawOutput[o + 10];

            kp1x = (kp1x - padX) / scale;
            kp1y = (kp1y - padY) / scale;
            kp2x = (kp2x - padX) / scale;
            kp2y = (kp2y - padY) / scale;

            if (![kp1x, kp1y, kp2x, kp2y].every(Number.isFinite)) continue;

            detections.push([[kp1x, kp1y], [kp2x, kp2y]]);
        }

        return detections;
    }

    sort_by_lowest_x(kpps) {
        return (kpps || []).sort((a, b) => {
            const minA = Math.min(a[0][0], a[1][0]);
            const minB = Math.min(b[0][0], b[1][0]);
            return minA - minB;
        });
    }

    // ----------------------------
    // HOMOGRAPHY (FIXED)
    // ----------------------------
    compute_homography(keys, targetH = 1200) {
        this.homography = [];
        this.source = [];
        this.keys = keys || [];

        if (this.keys.length < 2) return;

        const capped = this.keys.slice(0, 7);

        for (let i = 0; i < capped.length - 1; i++) {
            const g1 = capped[i];
            const g2 = capped[i + 1];

            const lt = g1[0];
            const lb = g1[1];
            const rt = g2[0];
            const rb = g2[1];

            const src = cv.matFromArray(4, 1, cv.CV_32FC2, [
                lt[0], lt[1],
                rt[0], rt[1],
                rb[0], rb[1],
                lb[0], lb[1]
            ]);

            // ✅ SAME AS PYTHON (dynamic width!)
            const width = Math.max(
                Math.hypot(rt[0] - lt[0], rt[1] - lt[1]),
                Math.hypot(rb[0] - lb[0], rb[1] - lb[1])
            );

            const dst = cv.matFromArray(4, 1, cv.CV_32FC2, [
                0, 0,
                width - 1, 0,
                width - 1, targetH - 1,
                0, targetH - 1
            ]);

            const H = cv.getPerspectiveTransform(src, dst);

            this.homography.push(H);
            this.source.push(src);

            dst.delete();
        }

        this.scale_factor = this.scale_dict[capped.length] || 1.0;
    }

    // ----------------------------
    // TRANSFORM (FIXED + FASTER)
    // ----------------------------
    transformImage(videoElement) {
        if (
            !videoElement ||
            this.keys.length < 2 ||
            this.homography.length === 0
        ) return null;

        const frameCanvas = document.createElement("canvas");
        frameCanvas.width = videoElement.videoWidth;
        frameCanvas.height = videoElement.videoHeight;

        const ctx = frameCanvas.getContext("2d");
        ctx.drawImage(videoElement, 0, 0);

        const src = cv.imread(frameCanvas);

        const pieces = [];
        let combined = null;

        try {
            for (let i = 0; i < this.homography.length; i++) {

                const warped = new cv.Mat();
                cv.warpPerspective(
                    src,
                    warped,
                    this.homography[i],
                    new cv.Size(src.cols * 2, src.rows * 2)
                );

                const t = new cv.Mat();
                cv.perspectiveTransform(this.source[i], t, this.homography[i]);

                const pts = t.data32F;

                let minX = Infinity, maxX = -Infinity;
                for (let p = 0; p < pts.length; p += 2) {
                    minX = Math.min(minX, pts[p]);
                    maxX = Math.max(maxX, pts[p]);
                }

                const x0 = Math.max(0, Math.floor(minX));
                const x1 = Math.min(warped.cols, Math.ceil(maxX));

                if (x1 <= x0 + 5) {
                    warped.delete();
                    t.delete();
                    continue;
                }

                const roi = warped.roi(new cv.Rect(x0, 0, x1 - x0, warped.rows));

                const resized = new cv.Mat();
                cv.resize(roi, resized, new cv.Size(roi.cols, this.h));

                pieces.push(resized);

                roi.delete();
                warped.delete();
                t.delete();
            }

            if (!pieces.length) {
                src.delete();
                return null;
            }

            const matVec = new cv.MatVector();
            for (const p of pieces) matVec.push_back(p);

            combined = new cv.Mat();
            cv.hconcat(matVec, combined);

            matVec.delete();

            const finalH = Math.max(
                1,
                Math.round(combined.cols / this.scale_factor)
            );

            const resized = new cv.Mat();
            cv.resize(combined, resized, new cv.Size(combined.cols, finalH));

            const rotated = new cv.Mat();
            cv.rotate(resized, rotated, cv.ROTATE_180);

            const out = document.createElement("canvas");
            out.width = rotated.cols;
            out.height = rotated.rows;

            cv.imshow(out, rotated);

            // cleanup
            src.delete();
            combined.delete();
            resized.delete();
            rotated.delete();

            for (const p of pieces) p.delete();

            return out;

        } catch (e) {
            console.error("transformImage failed:", e);

            try { src.delete(); } catch {}
            try { combined?.delete(); } catch {}

            for (const p of pieces) {
                try { p.delete(); } catch {}
            }

            return null;
        }
    }
}
