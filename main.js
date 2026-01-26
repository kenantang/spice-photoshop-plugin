// TODO: The code does not work when selecting strictly the full image. Fix later.

const { entrypoints } = require("uxp");
const { batchPlay } = require("photoshop").action;
const { app, core } = require("photoshop");
const { localFileSystem: fs, formats } = require("uxp").storage;

// --- 1. CONFIGURATION ---
const API_URL = "http://127.0.0.1:7860/sdapi/v1/img2img";

// --- 2. SETUP ENTRYPOINTS ---
entrypoints.setup({
    commands: {
        showAlert: () => alert("Plugin Loaded")
    },
    panels: {
        vanilla: {
            show(node) {}
        }
    }
});

// --- 3. CORE LOGIC ---
function getExtendedBoundingBox(selectionBounds, docW, docH) {
    let top = selectionBounds.top;
    let left = selectionBounds.left;
    let bottom = selectionBounds.bottom;
    let right = selectionBounds.right;

    // Extend by 64 pixels
    top -= 64;
    bottom += 64;
    left -= 64;
    right += 64;

    // Make Square
    let width = right - left;
    let height = bottom - top;

    if (width < height) {
        const diff = height - width;
        left -= diff / 2;
        right += diff / 2;
    } else if (height < width) {
        const diff = width - height;
        top -= diff / 2;
        bottom += diff / 2;
    }

    // Shift if out of bounds (max 2 passes)
    for (let i = 0; i < 2; i++) {
        if (left < 0) {
            const offset = -left;
            left += offset;
            right += offset;
        } else if (right > docW) {
            const offset = docW - right;
            left += offset;
            right += offset;
        }

        if (top < 0) {
            const offset = -top;
            top += offset;
            bottom += offset;
        } else if (bottom > docH) {
            const offset = docH - bottom;
            top += offset;
            bottom += offset;
        }
    }

    // Crop to image bounds
    return {
        top: Math.max(0, top),
        left: Math.max(0, left),
        bottom: Math.min(docH, bottom),
        right: Math.min(docW, right),
    };
}

// Helper: Fills the active selection with an RGB color using batchPlay
// This bypasses the "selection.fill is not a function" error.
async function fillSelection(r, g, b) {
    await batchPlay(
        [{
            _obj: "fill",
            using: { _enum: "fillContents", _value: "color" },
            color: {
                _obj: "RGBColor",
                red: r,
                green: g,
                blue: b
            },
            opacity: { _unit: "percentUnit", _value: 100 },
            mode: { _enum: "blendMode", _value: "normal" }
        }],
        { synchronousExecution: true }
    );
}

// Helper: Inverts the current selection
async function invertSelection() {
    await batchPlay(
        [{
            _obj: "inverse" 
        }],
        { synchronousExecution: true }
    );
}

async function extractRegionAsBase64(doc, bounds, isMask) {
    let base64Result = "";
    
    const tempFolder = await fs.getTemporaryFolder();
    const fileName = isMask ? "temp_mask.png" : "temp_img.png";
    const tempFile = await tempFolder.createFile(fileName, { overwrite: true });

    await core.executeAsModal(async () => {
        const savedState = doc.activeHistoryState;

        try {
            // --- STEP 1: PREPARE MASK (If needed) ---
            if (isMask) {
                // Create a new empty layer for the mask
                const maskLayer = await doc.layers.add();
                maskLayer.name = "TempMask";

                // 1. Fill "Selected" area with White
                await fillSelection(255, 255, 255);
                
                // 2. Invert selection to the background
                await invertSelection();
                
                // 3. Fill "Background" with Black
                await fillSelection(0, 0, 0);
                
                // 4. Deselect
                await doc.selection.deselect();
            }

            // --- STEP 2: CROP ---
            // We crop AFTER painting the mask so coordinates align
            await doc.crop({
                top: bounds.top, 
                left: bounds.left, 
                bottom: bounds.bottom, 
                right: bounds.right
            });

            // --- STEP 3: SAVE ---
            await doc.saveAs.png(tempFile, { compression: 0 }, true);

        } catch (e) {
            console.error("Extraction error:", e);
            throw e;
        } finally {
            // --- STEP 4: REVERT ---
            if (savedState) {
                doc.activeHistoryState = savedState;
            }
        }
    }, { commandName: isMask ? "Prepare Mask" : "Prepare Image" });

    const arrayBuffer = await tempFile.read({ format: formats.binary });
    base64Result = base64ArrayBuffer(arrayBuffer);
    return base64Result;
}

function base64ArrayBuffer(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

// --- 4. MAIN ACTION ---

async function onGenerate() {
    const doc = app.activeDocument;
    if (!doc) return alert("No document open");
    
    // Get button reference
    const btn = document.getElementById("btnGenerate");

    try {
        const check = doc.selection.bounds; 
    } catch(e) {
        return alert("Please make a selection first.");
    }

    // 3. DISABLE BUTTON & UPDATE TEXT
    btn.setAttribute("disabled", "true"); // Disable button
    const originalText = btn.textContent;
    btn.textContent = "Generating...";     // Provide feedback

    const promptVal = document.getElementById("txtPrompt").value;
    const denoiseVal = parseFloat(document.getElementById("slideDenoise").value);
    const controlStepVal = parseFloat(document.getElementById("slideControlEnd").value);

    const bounds = getExtendedBoundingBox(doc.selection.bounds, doc.width, doc.height);

    try {
        const maskImgB64 = await extractRegionAsBase64(doc, bounds, true);
        const initImgB64 = await extractRegionAsBase64(doc, bounds, false);

        const payload = {
            "prompt": promptVal,
            "negative_prompt": "bad quality, worst quality, worst detail, sketch, censor",
            "init_images": [`data:image/png;base64,${initImgB64}`],
            "mask": `data:image/png;base64,${maskImgB64}`,
            "denoising_strength": denoiseVal,
            "inpaint_full_res": 1,
            "inpaint_full_res_padding": 32,
            "inpainting_fill": 1,
            "width": 1024,
            "height": 1024,
            "steps": 30,
            "cfg_scale": 7,
            "sampler_name": "Euler a",
            "alwayson_scripts": {
                "ControlNet": {
                    "args": [
                        {
                            "enabled": true,
                            "module": "canny",
                            "model": "diffusers_xl_canny_mid",
                            "weight": 1.0,
                            "resize_mode": "Crop and Resize",
                            "control_mode": "My prompt is more important",
                            "guidance_start": 0.0,
                            "guidance_end": controlStepVal 
                        }
                    ]
                },
                "Soft inpainting": {
                    "args": [{ "enabled": true }]
                }
            }
        };

        console.log("Sending request to API...");
        const response = await fetch(API_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        if (!response.ok) throw new Error(`API Error: ${response.status}`);
        
        const json = await response.json();
        const resultB64 = json.images ? json.images[0] : null;
        
        if (!resultB64) throw new Error("No image returned from API");

        await placeResultOnLayer(doc, resultB64, bounds);

    } catch (err) {
        console.error(err);
        alert("Generation Failed: " + err.message);
    } finally {
        // 3. RE-ENABLE BUTTON (Runs whether success or fail)
        btn.removeAttribute("disabled");
        btn.textContent = originalText;
    }
}

// Helper: Get the bounds of the currently selected layer directly from Photoshop core
async function getActiveLayerBoundsBP() {
    const result = await batchPlay(
        [{
            _obj: "get",
            _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
            _property: [{ _property: "bounds" }]
        }],
        { synchronousExecution: true }
    );

    if (!result[0] || !result[0].bounds) {
        throw new Error("Could not retrieve layer bounds via BatchPlay");
    }

    const b = result[0].bounds;
    // Returns object with properties like { _unit: "pixelsUnit", _value: 100 }
    return {
        top: b.top._value,
        left: b.left._value,
        bottom: b.bottom._value,
        right: b.right._value
    };
}

// Helper: Move the currently selected layer by X and Y pixels
async function translateActiveLayerBP(x, y) {
  await batchPlay(
    [{
        _obj: "transform", // Do NOT use move here, as move has undesired behaviors with half pixels.
        _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
        freeTransformCenterState: { _enum: "quadCenterState", _value: "QCSAverage" },
        offset: {
            _obj: "offset",
            horizontal: { _unit: "pixelsUnit", _value: x },
            vertical: { _unit: "pixelsUnit", _value: y }
        },
        _options: { dialogOptions: "dontDisplay" }
    }],
    { synchronousExecution: true }
  );
}

async function placeResultOnLayer(doc, base64Str, bounds) {
    const tempFolder = await fs.getTemporaryFolder();
    const file = await tempFolder.createFile("result.png", { overwrite: true });
    
    // 1. Write the Base64 string to a file
    const binary = atob(base64Str);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    await file.write(bytes.buffer, { format: formats.binary });

    const token = fs.createSessionToken(file);

    await core.executeAsModal(async () => {
        // A. Place the file (Smart Object created at document center)
        await batchPlay([{
            _obj: "placeEvent",
            ID: 6,
            null: { _path: token, _kind: "local" },
            freeTransformCenterState: { _enum: "quadCenterState", _value: "QCSAverage" },
            offset: { _obj: "offset", horizontal: { _unit: "pixelsUnit", _value: 0 }, vertical: { _unit: "pixelsUnit", _value: 0 } }
        }], { synchronousExecution: true });

        // B. Measure Smart Object Position (BEFORE Rasterizing)
        // This captures the precise sub-pixel location (e.g., 512.5)
        const currentBounds = await getActiveLayerBoundsBP();
        
        // C. Calculate Offset
        const deltaX = bounds.left - currentBounds.left;
        const deltaY = bounds.top - currentBounds.top;

        // D. Move the Smart Object
        await translateActiveLayerBP(deltaX, deltaY);
        
    }, { commandName: "Place Generated Result" });
}

document.getElementById("btnGenerate").addEventListener("click", onGenerate);