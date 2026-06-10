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
    }

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
            inputData[i] = imageData.data[p] / 255;
            inputData[i + area] = imageData.data[p + 1] / 255;
            inputData[i + 2 * area] = imageData.data[p + 2] / 255;
        }

        const tensor = new ort.Tensor("float32", inputData, [1, 3, INPUT_SIZE, INPUT_SIZE]);

        let results;
        try {
            results = await session.run({ images: tensor });
        } catch {
            results = await session.run({ [session.inputNames[0]]: tensor });
        }

        const output = results.output0 || Object.values(results)[0];

        return this.sort_by_lowest_x(
            this.postProcessYOLOPose(output.data, ratio, padX, padY)
        );
    }

    postProcessYOLOPose(raw, scale, padX, padY) {
        const out = [];
        const stride = 12;

        for (let i = 0; i < raw.length / stride; i++) {
            const o = i * stride;
            const conf = raw[o + 4];
            if (conf < 0.25) continue;

            let x1 = (raw[o + 6] - padX) / scale;
            let y1 = (raw[o + 7] - padY) / scale;
            let x2 = (raw[o + 9] - padX) / scale;
            let y2 = (raw[o + 10] - padY) / scale;

            out.push([[x1, y1], [x2, y2]]);
        }

        return out;
    }

    sort_by_lowest_x(kpps) {
        if (!kpps) return [];
        return kpps.sort((a, b) =>
            Math.min(a[0][0], a[1][0]) - Math.min(b[0][0], b[1][0])
        );
    }

    compute_homography(keys, targetH = 1200) {
        this.homography = [];
        this.source = [];
        this.keys = keys;

        if (keys.length < 2) return;

        const limited = keys.slice(0, 7);

        for (let i = 0; i < limited.length - 1; i++) {
            const g1 = limited[i];
            const g2 = limited[i + 1];

            const src = cv.matFromArray(4, 1, cv.CV_32FC2, [
                g1[0][0], g1[0][1],
                g2[0][0], g2[0][1],
                g2[1][0], g2[1][1],
                g1[1][0], g1[1][1]
            ]);

            const dst = cv.matFromArray(4, 1, cv.CV_32FC2, [
                0, 0,
                800, 0,
                800, targetH,
                0, targetH
            ]);

            this.homography.push(cv.getPerspectiveTransform(src, dst));
            this.source.push(src);
        }

        this.scale_factor = this.scale_dict[keys.length] || 1;
    }

    // ================================
    // FIXED + MOBILE OPTIMIZED
    // ================================
    transformImage(videoElement) {

        if (!videoElement || this.homography.length === 0) return null;

        const frameCanvas = document.createElement("canvas");
        frameCanvas.width = videoElement.videoWidth;
        frameCanvas.height = videoElement.videoHeight;

        const ctx = frameCanvas.getContext("2d");
        ctx.drawImage(videoElement, 0, 0);

        const srcMat = cv.imread(frameCanvas);

        let outputParts = [];

        try {
            const warpSize = new cv.Size(
                Math.floor(srcMat.cols * 1.2),
                Math.floor(srcMat.rows * 1.2)
            );

            for (let i = 0; i < this.homography.length; i++) {

                const warped = new cv.Mat();
                cv.warpPerspective(srcMat, warped, this.homography[i], warpSize);

                const pts = new cv.Mat();
                cv.perspectiveTransform(this.source[i], pts, this.homography[i]);

                const data = pts.data32F;

                let minX = Infinity;
                let maxX = -Infinity;

                for (let j = 0; j < data.length; j += 2) {
                    minX = Math.min(minX, data[j]);
                    maxX = Math.max(maxX, data[j]);
                }

                const x0 = Math.max(0, Math.floor(minX));
                const x1 = Math.min(warped.cols, Math.ceil(maxX));

                pts.delete();

                if (x1 <= x0 + 5) {
                    warped.delete();
                    continue;
                }

                const roi = warped.roi(new cv.Rect(x0, 0, x1 - x0, warped.rows));

                const resized = new cv.Mat();
                cv.resize(roi, resized, new cv.Size(roi.cols, this.h));

                roi.delete();
                warped.delete();

                outputParts.push(resized);
            }

            if (outputParts.length === 0) {
                srcMat.delete();
                return null;
            }

            // SAFE CONCAT (manual, no MatVector bugs)
            let combined = outputParts[0];

            for (let i = 1; i < outputParts.length; i++) {
                const next = outputParts[i];

                const dst = new cv.Mat();
                cv.hconcat(combined, next, dst);

                combined.delete();
                next.delete();

                combined = dst;
            }

            const finalH = Math.max(1, Math.round(combined.cols / this.scale_factor));

            const resized = new cv.Mat();
            cv.resize(combined, resized, new cv.Size(combined.cols, finalH));

            const rotated = new cv.Mat();
            cv.rotate(resized, rotated, cv.ROTATE_180);

            const canvas = document.createElement("canvas");
            canvas.width = rotated.cols;
            canvas.height = rotated.rows;

            cv.imshow(canvas, rotated);

            // CLEANUP
            srcMat.delete();
            combined.delete();
            resized.delete();
            rotated.delete();

            return canvas;

        } catch (e) {
            console.error("transformImage failed:", e);

            try { srcMat.delete(); } catch {}

            for (const p of outputParts) {
                try { p.delete(); } catch {}
            }

            return null;
        }
    }
}
