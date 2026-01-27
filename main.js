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

    // These are needed to eliminate shift. 
    // The values here can be multiples of .5,
    // but the active layer bounding box coodinates are always integers.
    top = Math.round(top);
    left = Math.round(left);
    bottom = Math.round(bottom);
    right = Math.round(right);

    console.log("EBB: top, left, bottom right: ", top, left, bottom, right);

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

// Helper: Precisely sets the selection to specific pixel coordinates
async function setSelection(top, left, bottom, right) {
    await batchPlay(
        [{
            _obj: "set",
            _target: [{ _ref: "channel", _enum: "channel", _value: "selection" }],
            to: {
                _obj: "rectangle",
                top: { _unit: "pixelsUnit", _value: top },
                left: { _unit: "pixelsUnit", _value: left },
                bottom: { _unit: "pixelsUnit", _value: bottom },
                right: { _unit: "pixelsUnit", _value: right }
            }
        }],
        { synchronousExecution: true }
    );
}

async function extractRegionAsBase64(doc, bounds, isMask) {
    let base64Result = "";
    
    // We will save this temporary file from a duplicated document
    const tempFolder = await fs.getTemporaryFolder();
    const fileName = isMask ? "temp_mask.png" : "temp_img.png";
    const tempFile = await tempFolder.createFile(fileName, { overwrite: true });

    await core.executeAsModal(async () => {
        // 1. SNAPSHOT: Remember the state so we can undo the mask prep on the main doc
        const initialState = doc.activeHistoryState;

        let tempDoc = null;

        try {
            // --- STEP 1: PREPARE THE VIEW ON THE MAIN DOC ---
            // We paint the mask on the main document first. 
            // Don't worry, we revert this immediately after duplicating.
            if (isMask) {
                // Create a temp layer to hold our black/white mask
                const maskLayer = await doc.layers.add();
                maskLayer.name = "Temp_Generation_Mask";

                // A. Fill the USER SELECTION with White
                // We use your existing selection (marching ants), not just the box
                await fillSelection(255, 255, 255);

                // B. Invert Selection -> Fill the REST with Black
                await invertSelection();
                await fillSelection(0, 0, 0);
                
                // C. Deselect (so the selection outline doesn't interfere)
                await doc.selection.deselect();
            }

            // --- STEP 2: DUPLICATE (FLATTENED) ---
            // This creates a NEW document that looks exactly like your current view.
            // 'true' means "merge all layers", creating a single flat image.
            // This avoids the clipboard entirely.
            tempDoc = await doc.duplicate("Temp_Export_Doc", true);

            // --- STEP 3: REVERT MAIN DOC ---
            // Immediately restore the main document to its original state.
            // The user barely sees the change because we duplicate so fast.
            doc.activeHistoryState = initialState;

            // --- STEP 4: CROP THE TEMP DOC ---
            // Now we working on the hidden/background 'tempDoc'
            await tempDoc.crop({
                top: bounds.top, 
                left: bounds.left, 
                bottom: bounds.bottom, 
                right: bounds.right
            });

            // --- STEP 5: SAVE ---
            // It is already flattened, so we just save.
            await tempDoc.saveAs.png(tempFile, { compression: 0 }, true);

        } catch (e) {
            console.error("Extraction error:", e);
            throw e;
        } finally {
            // Cleanup: Close the temp doc without saving changes
            if (tempDoc) {
                await tempDoc.closeWithoutSaving();
            }
            // Double check we are back to normal on main doc
            if (doc.activeHistoryState !== initialState) {
                doc.activeHistoryState = initialState;
            }
        }
    }, { commandName: isMask ? "Prepare Mask" : "Prepare Image" });

    // Read and convert
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

async function isSelectionStrictlyFull(doc) {
    // 1. Fast Check: If bounds don't match doc size, it's definitely not full
    let b = null;
    try {
        b = doc.selection.bounds;
    } catch (e) { return false; } // No selection at all

    if (!b) return false;
    if (b.width !== doc.width || b.height !== doc.height) return false; 

    // 2. The Inversion Test
    let isFull = false;

    await core.executeAsModal(async () => {
        const savedState = doc.activeHistoryState;
        try {
            await invertSelection(); 
            
            // --- CRITICAL FIX HERE ---
            let invBounds = null;
            try {
                invBounds = doc.selection.bounds;
            } catch (e) {
                // It threw an error -> Selection is empty
                invBounds = null;
            }

            // If invBounds is null, the inverse is empty -> Original was Full.
            if (!invBounds) {
                isFull = true; 
            } else {
                // Inverse has bounds -> Original had holes (not strictly full).
                isFull = false;
            }

        } catch (e) {
            console.error("Check failed", e);
        } finally {
            doc.activeHistoryState = savedState;
        }
    }, { commandName: "Check Full Selection" });

    return isFull;
}

// --- 4. MAIN ACTION ---

async function onGenerate() {
    const doc = app.activeDocument;
    if (!doc) return alert("No document open");
    
    // Get button reference
    const btn = document.getElementById("btnGenerate");

    try {
        selectionBounds = doc.selection.bounds;
        
        // sometimes UXP returns null instead of throwing
        if (!selectionBounds) throw new Error("No selection");
        
    } catch (e) {
        const msg = document.getElementById("statusMessage");
        msg.textContent = "Please make a selection first.";
        msg.style.display = "block";
        
        // Hide it automatically after 3 seconds
        setTimeout(() => { msg.style.display = "none"; }, 3000);
        return; 
    }

    const isFullImage = await isSelectionStrictlyFull(doc);
    if (isFullImage) {
        const msg = document.getElementById("statusMessage");
        msg.textContent = "Full selection causes a bug for inversion.";
        msg.style.display = "block";
        
        // Hide it automatically after 3 seconds
        setTimeout(() => { msg.style.display = "none"; }, 3000);
        return; 
    }

    const startTime = Date.now();

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
        // Use your preferred error handling (alert or status message)
        const msg = document.getElementById("statusMessage");
        if(msg) {
             msg.textContent = "Failed: " + err.message;
             msg.style.display = "block";
        } else {
             alert("Generation Failed: " + err.message);
        }
    } finally {
        // 3. RE-ENABLE BUTTON (Runs whether success or fail)
        const endTime = Date.now();
        const duration = (endTime - startTime) / 1000; // Convert ms to seconds
        
        // Re-enable button
        btn.removeAttribute("disabled");
        
        // Update text to format: "Generate [9.55s]"
        btn.textContent = `Generate [${duration.toFixed(2)}s]`;
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
    
    // 1. Write Base64 to file
    const binary = atob(base64Str);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    await file.write(bytes.buffer, { format: formats.binary });

    await core.executeAsModal(async () => {
        // --- STEP A: OPEN TEMP DOC ---
        // Open the generated result in a new tab
        const tempDoc = await app.open(file);
        const sourceLayer = tempDoc.layers[0]; // The flat image layer

        // --- STEP B: DUPLICATE TO MAIN DOC ---
        // This pushes the layer directly into your original document.
        // It bypasses the clipboard and works regardless of zoom level.
        const newLayer = await sourceLayer.duplicate(doc);

        // --- STEP C: CLOSE TEMP DOC ---
        await tempDoc.closeWithoutSaving();

        // --- STEP D: ALIGN ---
        // Now we are back on the main doc, and 'newLayer' is active.
        
        // 1. Get Current Position (It usually spawns at 0,0 or center)
        const currentPos = await getActiveLayerTopLeft();
        
        // 2. Calculate Offset
        const deltaX = bounds.left - currentPos.left;
        const deltaY = bounds.top - currentPos.top;

        // 3. Move
        // We use the "move" command (Move Tool) instead of "transform" 
        // because "transform" throws errors if the layer is locked or empty.
        if (Math.round(deltaX) !== 0 || Math.round(deltaY) !== 0) {
            await batchPlay(
                [{
                    _obj: "move",
                    _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
                    to: {
                        _obj: "offset",
                        horizontal: { _unit: "pixelsUnit", _value: Math.round(deltaX) },
                        vertical: { _unit: "pixelsUnit", _value: Math.round(deltaY) }
                    }
                }],
                { synchronousExecution: true }
            );
        }

        // --- STEP E: DESELECT EVERYTHING ---
        // This removes the original selection "ants" so you can see the result clearly.
        await doc.selection.deselect();

    }, { commandName: "Place Generated Result" });
}

// Ensure this helper is present and handles potential unit objects
async function getActiveLayerTopLeft() {
    const result = await batchPlay(
        [{
            _obj: "get",
            _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
            _property: [{ _property: "bounds" }]
        }],
        { synchronousExecution: true }
    );

    if (!result[0] || !result[0].bounds) throw new Error("Could not retrieve layer bounds");

    const b = result[0].bounds;
    return {
        top: b.top._value !== undefined ? b.top._value : b.top,
        left: b.left._value !== undefined ? b.left._value : b.left
    };
}

document.getElementById("btnGenerate").addEventListener("click", onGenerate);

// --- 5. PROMPT HISTORY LOGIC ---

// Configuration
const MAX_HISTORY = 50;
const DEBOUNCE_MS = 400;

// State
let promptHistory = [];
let historyIndex = -1;
let debounceTimer = null;

const txtPrompt = document.getElementById("txtPrompt");
const btnUndo = document.getElementById("btnUndo");
const btnRedo = document.getElementById("btnRedo");

// Initialize History with current default value
function initHistory() {
    // 1. Try to get the value property
    let val = txtPrompt.value;
    
    // 2. If empty, grab the text strictly from inside the HTML tags
    if (!val) {
        val = txtPrompt.textContent ? txtPrompt.textContent.trim() : "";
        
        // IMPORTANT: Sync it back to the UI so they match
        if (val) {
            txtPrompt.value = val;
        }
    }

    // 3. Initialize history with the correct starting text
    promptHistory = [val];
    historyIndex = 0;
    
    updateButtons();
}

function updateButtons() {
    // Helper to toggle the class
    const toggleDisabled = (btn, shouldDisable) => {
        if (shouldDisable) {
            btn.classList.add("disabled-btn");
        } else {
            btn.classList.remove("disabled-btn");
        }
    };

    // Apply logic
    toggleDisabled(btnUndo, historyIndex <= 0);
    toggleDisabled(btnRedo, historyIndex >= promptHistory.length - 1);
}

function pushToHistory(val) {
    // If we are in the middle of history and type new stuff, 
    // remove everything after current index
    if (historyIndex < promptHistory.length - 1) {
        promptHistory = promptHistory.slice(0, historyIndex + 1);
    }
    
    // Don't push if identical to current (prevents duplicates)
    if (promptHistory[historyIndex] === val) return;

    promptHistory.push(val);
    if (promptHistory.length > MAX_HISTORY) {
        promptHistory.shift();
    } else {
        historyIndex++;
    }
    updateButtons();
}

// Event Listeners
txtPrompt.addEventListener("input", (e) => {
    // Clear existing timer to reset the debounce window
    clearTimeout(debounceTimer);
    
    const val = txtPrompt.value;
    
    // Set new timer
    debounceTimer = setTimeout(() => {
        pushToHistory(val);
    }, DEBOUNCE_MS);
});

btnUndo.addEventListener("click", () => {
    if (historyIndex > 0) {
        historyIndex--;
        txtPrompt.value = promptHistory[historyIndex];
        updateButtons();
    }
});

btnRedo.addEventListener("click", () => {
    if (historyIndex < promptHistory.length - 1) {
        historyIndex++;
        txtPrompt.value = promptHistory[historyIndex];
        updateButtons();
    }
});

// Initialize on load
initHistory();