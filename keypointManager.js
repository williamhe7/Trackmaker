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
    }

    async get_kpps(videoElement, session) {
        if (!session) return [];
    
        const INPUT_SIZE = 1600;
    
        // Ultralytics LetterBox
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
    
        const ctx = canvas.getContext("2d", {
            willReadFrequently: true
        });
    
        // Ultralytics padding color
        ctx.fillStyle = "rgb(114,114,114)";
        ctx.fillRect(0, 0, INPUT_SIZE, INPUT_SIZE);
    
        ctx.drawImage(
            videoElement,
            padX,
            padY,
            newW,
            newH
        );
    
        const imageData =
            ctx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE);
    
        const area = INPUT_SIZE * INPUT_SIZE;
    
        const inputData =
            new Float32Array(3 * area);
    
        for (let i = 0; i < area; i++) {
    
            const p = i * 4;
    
            inputData[i] =
                imageData.data[p] / 255.0;
    
            inputData[i + area] =
                imageData.data[p + 1] / 255.0;
    
            inputData[i + area * 2] =
                imageData.data[p + 2] / 255.0;
        }
    
        const tensor = new ort.Tensor(
            "float32",
            inputData,
            [1, 3, INPUT_SIZE, INPUT_SIZE]
        );
    
        let results;
    
        try {
            results = await session.run({
                images: tensor
            });
        } catch {
    
            const inputName =
                session.inputNames[0];
    
            results = await session.run({
                [inputName]: tensor
            });
        }
    
        const output =
            results.output0 ||
            Object.values(results)[0];
    
        return this.sort_by_lowest_x(
            this.postProcessYOLOPose(
                output.data,
                ratio,
                padX,
                padY
            )
        );
    }
    
    postProcessYOLOPose(
        rawOutput,
        scale,
        padX,
        padY
    ) {
    
        const detections = [];
    
        const CONF_THRESHOLD = 0.25;
    
        // Your model is [1,300,12]
        const VALUES_PER_DETECTION = 12;
    
        const numDetections =
            Math.floor(
                rawOutput.length /
                VALUES_PER_DETECTION
            );
    
        for (let i = 0; i < numDetections; i++) {
    
            const o =
                i * VALUES_PER_DETECTION;
    
            const conf =
                rawOutput[o + 4];
    
            if (conf < CONF_THRESHOLD)
                continue;
    
            // ONNX outputs coordinates
            // in LETTERBOX space
    
            let kp1x =
                rawOutput[o + 6];
    
            let kp1y =
                rawOutput[o + 7];
    
            let kp2x =
                rawOutput[o + 9];
    
            let kp2y =
                rawOutput[o + 10];
    
            // Undo letterbox
            kp1x = (kp1x - padX) / scale;
            kp1y = (kp1y - padY) / scale;
    
            kp2x = (kp2x - padX) / scale;
            kp2y = (kp2y - padY) / scale;
    
            if (
                !Number.isFinite(kp1x) ||
                !Number.isFinite(kp1y) ||
                !Number.isFinite(kp2x) ||
                !Number.isFinite(kp2y)
            ) {
                continue;
            }
    
            detections.push([
                [kp1x, kp1y],
                [kp2x, kp2y]
            ]);
        }
    
        console.log(
            `Found ${detections.length} key groups`
        );
    
        return detections;
    }

    // Matches Python
    sort_by_lowest_x(kpps) {
        if (!kpps || kpps.length === 0) return [];
        return kpps.sort((a, b) => {
            const minA = Math.min(...a.map(p => p[0]));
            const minB = Math.min(...b.map(p => p[0]));
            return minA - minB;
        });
    }

    // Matches Python
    compute_homography(keys, targetH = 1200) {
        this.homography = [];
        this.source = [];
        this.keys = keys || [];

        if (keys.length < 2) {
            console.warn("Not enough key groups for homography");
            return;
        }

        if (keys.length > 7) keys = keys.slice(0, 7);

        for (let i = 0; i < keys.length - 1; i++) {
            const group1 = keys[i];
            const group2 = keys[i + 1];

            const lt = group1[0];
            const lb = group1[1];
            const rt = group2[0];
            const rb = group2[1];

            const srcPoints = cv.matFromArray(4, 1, cv.CV_32FC2, [
                lt[0], lt[1], rt[0], rt[1], rb[0], rb[1], lb[0], lb[1]
            ]);

            const dstWidth = 800;
            const dstPoints = cv.matFromArray(4, 1, cv.CV_32FC2, [
                0, 0, dstWidth-1, 0, dstWidth-1, targetH-1, 0, targetH-1
            ]);

            const H = cv.getPerspectiveTransform(srcPoints, dstPoints);
            this.homography.push(H);
            this.source.push(srcPoints);
        }

        this.scale_factor = this.scale_dict[keys.length] || 1.0;
        console.log(`✅ Homography computed for ${keys.length} key groups`);
    }

    // Matches Python
    transform_image(videoElement) {
        if (this.keys.length < 2 || this.homography.length === 0) return null;

        const srcMat = cv.imread(videoElement);
        const imgList = [];

        for (let i = 0; i < this.homography.length; i++) {
            const H = this.homography[i];

            const warpedFull = new cv.Mat();
            cv.warpPerspective(srcMat, warpedFull, H, new cv.Size(videoElement.videoWidth * 2, videoElement.videoHeight * 2));

            const srcPointsMat = this.source[i].clone();
            const transformed = new cv.Mat();
            cv.perspectiveTransform(srcPointsMat, transformed, H);

            const data = transformed.data32F;
            let minX = Infinity, maxX = -Infinity;
            for (let j = 0; j < data.length; j += 2) {
                minX = Math.min(minX, data[j]);
                maxX = Math.max(maxX, data[j]);
            }

            const xMin = Math.max(0, Math.floor(minX));
            const xMax = Math.min(warpedFull.cols, Math.ceil(maxX));

            const rect = new cv.Rect(xMin, 0, xMax - xMin, warpedFull.rows);
            const cropped = warpedFull.roi(rect);

            const resized = new cv.Mat();
            cv.resize(cropped, resized, new cv.Size(cropped.cols, this.h), 0, 0, cv.INTER_LINEAR);

            imgList.push(resized);

            warpedFull.delete();
            transformed.delete();
            cropped.delete();
            srcPointsMat.delete();
        }

        let combined = imgList[0];
        for (let i = 1; i < imgList.length; i++) {
            const newCombined = new cv.Mat();
            cv.hconcat(combined, imgList[i], newCombined);
            combined.delete();
            combined = newCombined;
            imgList[i].delete();
        }

        const finalH = Math.round(combined.cols / this.scale_factor);
        const finalResized = new cv.Mat();
        cv.resize(combined, finalResized, new cv.Size(combined.cols, finalH), 0, 0, cv.INTER_CUBIC);

        const rotated = new cv.Mat();
        cv.rotate(finalResized, rotated, cv.ROTATE_180);

        const screenHeightApprox = window.innerHeight * 0.48;
        const scale = screenHeightApprox / rotated.rows;
        this.scaled_width = Math.round(rotated.cols * scale);
        this.scaled_height = Math.round(rotated.rows * scale);

        const finalMat = new cv.Mat();
        cv.resize(rotated, finalMat, new cv.Size(this.scaled_width, this.scaled_height));

        const resultCanvas = document.createElement('canvas');
        resultCanvas.width = this.scaled_width;
        resultCanvas.height = this.scaled_height;
        cv.imshow(resultCanvas, finalMat);

        srcMat.delete();
        combined.delete();
        finalResized.delete();
        rotated.delete();
        finalMat.delete();

        return resultCanvas;
    }
}
