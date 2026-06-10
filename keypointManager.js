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

    // Matches Python naming
    async get_kpps(videoElement, session) {
        if (!session) return [];

        const inputSize = 1600;
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = inputSize;
        tempCanvas.height = inputSize;
        const tctx = tempCanvas.getContext('2d', { willReadFrequently: true });
        tctx.drawImage(videoElement, 0, 0, inputSize, inputSize);

        const imageData = tctx.getImageData(0, 0, inputSize, inputSize);
        const data = new Float32Array(3 * inputSize * inputSize);

        for (let i = 0; i < inputSize * inputSize; i++) {
            const idx = i * 4;
            data[i] = imageData.data[idx] / 255.0;
            data[i + inputSize * inputSize] = imageData.data[idx + 1] / 255.0;
            data[i + 2 * inputSize * inputSize] = imageData.data[idx + 2] / 255.0;
        }

        const tensor = new ort.Tensor('float32', data, [1, 3, inputSize, inputSize]);
        
        let results;
        try {
            results = await session.run({ images: tensor });
        } catch (e) {
            results = await session.run({ "input.1": tensor });
        }

        const outputTensor = results.output0 || results.output || Object.values(results)[0];
        const rawOutput = outputTensor.data;

        const kpps = this.postProcessYOLOPose(rawOutput, inputSize);
        return this.sort_by_lowest_x(kpps);
    }

    // Updated for 2 keypoints per group
    postProcessYOLOPose(rawOutput, imgSize = 1600) {
        console.log(`Total output values: ${rawOutput.length}`);

        const detections = [];
        const confThreshold = 0.40;        // Higher to reduce false positives on placebo
        const valuesPerDetection = 11;     // 4(bbox) + 1(obj) + 1(cls) + 2kpts*3 = 11
        const kptStart = 6;                // After bbox + obj + cls
        const numKeypoints = 2;            // ← This is what you trained for

        const numDetections = Math.floor(rawOutput.length / valuesPerDetection);
        console.log(`Raw detections: ${numDetections} | valuesPerDetection=${valuesPerDetection}`);

        for (let i = 0; i < numDetections; i++) {
            const offset = i * valuesPerDetection;
            const confidence = rawOutput[offset + 4];

            if (confidence < confThreshold) continue;

            const kpts = [];
            
            for (let k = 0; k < numKeypoints; k++) {
                const base = kptStart + k * 3;
                const x = rawOutput[offset + base] * imgSize;
                const y = rawOutput[offset + base + 1] * imgSize;
                const vis = rawOutput[offset + base + 2];

                if (vis > 0.5 && x > 20 && y > 20 && x < imgSize - 20 && y < imgSize - 20) {
                    kpts.push([x, y]);
                }
            }

            if (kpts.length >= 2) {
                detections.push(kpts);
            }
        }

        const clustered = this.clusterDetections(detections);
        console.log(`✅ Final valid keypoint groups: ${clustered.length}`);
        console.log("📍 Pose Keypoints Array:", JSON.stringify(clustered, null, 2));

        return clustered;
    }

    clusterDetections(detections) {
        if (detections.length <= 7) return detections;

        const groups = [];
        const threshold = 90; // horizontal clustering

        for (const det of detections) {
            const centerX = (det[0][0] + det[1][0]) / 2;
            let added = false;
            for (const g of groups) {
                const gCenterX = (g[0][0] + g[1][0]) / 2;
                if (Math.abs(centerX - gCenterX) < threshold) {
                    added = true;
                    break;
                }
            }
            if (!added) groups.push(det);
        }
        return groups.slice(0, 7);
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
