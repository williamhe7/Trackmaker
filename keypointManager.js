// keypointManager.js
export class KeypointManager {
    constructor() {
        this.w = 1600;
        this.h = 1200;
        this.scale_dict = { 2: 1.07939633, 3: 2.15879265, 4: 3.23818898, 5: 4.31758530, 6: 5.39698163, 7: 6.47637795 };
        this.keys = [];
        this.homography = [];
        this.source = [];
        this.scale_factor = 1;
        this.scaled_width = 1000;
        this.scaled_height = 800;
    }

    async getKeypoints(videoElement, session) {
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
        const results = await session.run({ images: tensor });   // or 'input.1' if needed

        console.log("Raw ONNX output keys:", Object.keys(results));
        const outputTensor = results.output0 || results.output || Object.values(results)[0];
        const rawOutput = outputTensor.data;

        return this.postProcessYOLOPose(rawOutput, inputSize);
    }

    postProcessYOLOPose(rawOutput, imgSize = 1600) {
        // Typical YOLO Pose output shape without NMS: [1, (5 + nKeypoints*3), nAnchors]
        // Example: 5 (box+conf+cls) + 6 keypoints * 3 (x,y,conf) = 23 values
        const numAnchors = 8400; // common for 1600px input
        const valuesPerAnchor = Math.floor(rawOutput.length / numAnchors); 

        console.log(`Pose output format: ${rawOutput.length} values → ${valuesPerAnchor} per anchor`);

        const detections = [];
        const confThreshold = 0.25;

        for (let i = 0; i < numAnchors; i++) {
            const offset = i * valuesPerAnchor;
            const confidence = rawOutput[offset + 4]; // usually objectness/confidence

            if (confidence < confThreshold) continue;

            // Extract keypoints (after bbox + conf + class)
            const kpts = [];
            const kptStart = 5; // adjust if needed (bbox=4 + obj + cls)

            for (let k = 0; k < 6; k++) {  // assuming 6 keypoints (adjust to your model)
                const xIdx = kptStart + k * 3;
                const yIdx = xIdx + 1;
                const visIdx = yIdx + 1;

                const x = rawOutput[offset + xIdx] * imgSize;
                const y = rawOutput[offset + yIdx] * imgSize;
                const vis = rawOutput[offset + visIdx];

                if (vis > 0.5) {
                    kpts.push([x, y]);
                }
            }

            if (kpts.length >= 2) {
                detections.push(kpts);
            }
        }

        const sorted = this.sortByLowestX(detections);
        console.log(`Found ${sorted.length} keypoint groups`);
        return sorted;
    }

    sortByLowestX(kpps) {
        return kpps.sort((a, b) => {
            const minA = Math.min(...a.map(p => p[0]));
            const minB = Math.min(...b.map(p => p[0]));
            return minA - minB;
        });
    }

    // ... rest of the class (computeHomography, transformImage) stays the same as before
    computeHomography(keys, targetH = 1200) {
        this.homography = [];
        this.source = [];
        this.keys = keys || [];

        if (keys.length < 2) return;

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
    }

    // Full port of transformImage using OpenCV.js
    transformImage(frameMat) {
        if (this.homography.length === 0) return frameMat;

        const h = this.h;
        const imgList = [];

        for (let i = 0; i < this.homography.length; i++) {
            const H = this.homography[i];
            const src = this.source[i];

            // Warp full image
            let warped = new cv.Mat();
            cv.warpPerspective(frameMat, warped, H, new cv.Size(this.w * 2, h * 2), cv.INTER_LINEAR);

            // Project source points to find crop region
            let transformed = new cv.Mat();
            cv.perspectiveTransform(src, transformed, H);

            const pts = transformed.data32F;
            let xMin = Math.max(0, Math.floor(Math.min(pts[0], pts[2], pts[4], pts[6])));
            let xMax = Math.min(warped.cols, Math.ceil(Math.max(pts[0], pts[2], pts[4], pts[6])));

            // Crop
            let rect = new cv.Rect(xMin, 0, xMax - xMin, warped.rows);
            let cropped = warped.roi(rect);

            // Resize height
            let resized = new cv.Mat();
            cv.resize(cropped, resized, new cv.Size(cropped.cols, h), 0, 0, cv.INTER_LINEAR);

            imgList.push(resized);

            // Cleanup
            warped.delete(); cropped.delete(); transformed.delete();
        }

        if (imgList.length === 0) return frameMat;

        // Horizontal concat
        let combined = imgList[0];
        for (let j = 1; j < imgList.length; j++) {
            let temp = new cv.Mat();
            cv.hconcat(combined, imgList[j], temp);
            combined.delete();
            combined = temp;
            imgList[j].delete();
        }

        // Final resize + rotate 180
        let finalH = Math.round(combined.cols / this.scale_factor);
        let resizedFinal = new cv.Mat();
        cv.resize(combined, resizedFinal, new cv.Size(combined.cols, finalH), 0, 0, cv.INTER_CUBIC);

        let rotated = new cv.Mat();
        cv.rotate(resizedFinal, rotated, cv.ROTATE_180);

        // Scale to screen (simplified)
        this.scaled_width = Math.round(rotated.cols * 0.6);
        this.scaled_height = Math.round(rotated.rows * 0.6);

        let finalMat = new cv.Mat();
        cv.resize(rotated, finalMat, new cv.Size(this.scaled_width, this.scaled_height));

        // Cleanup
        combined.delete(); resizedFinal.delete(); rotated.delete();

        return finalMat;
    }
}
