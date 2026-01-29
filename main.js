const { entrypoints } = require("uxp");
const { app } = require("photoshop");

const config = require("./config");
const utils = require("./utils");
const workflow = require("./workflow");
const settingsController = require("./settings");

// --- UI & HISTORY LOGIC ---
let promptHistory = [];
let historyIndex = -1;
let debounceTimer = null;

function showStatusMessage(text) {
    const msg = document.getElementById("statusMessage");
    if (!msg) return; 
    
    msg.textContent = text;
    msg.style.display = "block";
    
    if (msg.hideTimer) clearTimeout(msg.hideTimer);
    msg.hideTimer = setTimeout(() => {
        msg.style.display = "none";
    }, 3000);
}

async function isBackendOnline(fullApiUrl) {
    try {
        const rootUrl = new URL(fullApiUrl).origin;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 1500);

        const response = await fetch(rootUrl, { 
            method: "GET",
            signal: controller.signal 
        });

        clearTimeout(timeoutId);
        return true; 
    } catch (e) {
        return false;
    }
}

function initHistory(txtPrompt) {
    let val = txtPrompt.value || (txtPrompt.textContent ? txtPrompt.textContent.trim() : "");
    if (val) txtPrompt.value = val;
    promptHistory = [val];
    historyIndex = 0;
    updateButtons();
}

function updateButtons() {
    const btnUndo = document.getElementById("btnUndo");
    const btnRedo = document.getElementById("btnRedo");
    
    btnUndo.classList.toggle("disabled-btn", historyIndex <= 0);
    btnRedo.classList.toggle("disabled-btn", historyIndex >= promptHistory.length - 1);
}

function setupEventListeners() {
    const txtPrompt = document.getElementById("txtPrompt");
    const btnGenerate = document.getElementById("btnGenerate");
    const btnUndo = document.getElementById("btnUndo");
    const btnRedo = document.getElementById("btnRedo");

    txtPrompt.addEventListener("input", () => {
        clearTimeout(debounceTimer);
        const val = txtPrompt.value;
        debounceTimer = setTimeout(() => {
            if (promptHistory[historyIndex] !== val) {
                if (historyIndex < promptHistory.length - 1) {
                    promptHistory = promptHistory.slice(0, historyIndex + 1);
                }
                promptHistory.push(val);
                if (promptHistory.length > config.HISTORY.MAX_ITEMS) promptHistory.shift();
                else historyIndex++;
                updateButtons();
            }
        }, config.HISTORY.DEBOUNCE_MS);
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

    btnGenerate.addEventListener("click", onGenerate);
    initHistory(txtPrompt);
}

// --- MAIN GENERATION CONTROLLER ---
async function onGenerate() {
    const doc = app.activeDocument;
    if (!doc) return alert("No document open");

    // LOAD SETTINGS DYNAMICALLY
    const settings = config.getSettings();

    const btn = document.getElementById("btnGenerate");
    
    // 1. CHECK BACKEND CONNECTION
    const isOnline = await isBackendOnline(settings.API_URL);
    if (!isOnline) {
        showStatusMessage("Backend is offline or unreachable.");
        return; 
    }

    // 2. CHECK SELECTION
    let selectionBounds;
    try {
        if (!doc.selection || !doc.selection.bounds) throw new Error("No selection");
        selectionBounds = doc.selection.bounds;
    } catch (e) {
        showStatusMessage("Please make a selection first.");
        return;
    }

    // 3. CHECK FULL SELECTION BUG
    if (await workflow.isSelectionStrictlyFull(doc)) {
        showStatusMessage("Full selection causes a bug for inversion.");
        return;
    }

    const startTime = Date.now();
    btn.setAttribute("disabled", "true");
    btn.textContent = "Generating...";

    try {
        const promptVal = document.getElementById("txtPrompt").value;
        const denoiseVal = parseFloat(document.getElementById("slideDenoise").value);
        const controlStepVal = parseFloat(document.getElementById("slideControlEnd").value);
        
        const bounds = utils.getExtendedBoundingBox(doc.selection.bounds, doc.width, doc.height);

        const maskImgB64 = await workflow.extractRegionAsBase64(doc, bounds, true);
        const initImgB64 = await workflow.extractRegionAsBase64(doc, bounds, false);

        // API Call using dynamic settings
        const payload = {
            "prompt": promptVal,
            "negative_prompt": settings.negative_prompt,
            "init_images": [`data:image/png;base64,${initImgB64}`],
            "mask": `data:image/png;base64,${maskImgB64}`,
            "denoising_strength": denoiseVal,
            "inpaint_full_res": 1,
            "inpaint_full_res_padding": 32,
            "inpainting_fill": 1,
            "width": settings.width,
            "height": settings.height,
            "steps": settings.steps,
            "cfg_scale": settings.cfg_scale,
            "sampler_name": settings.sampler_name,
            "alwayson_scripts": {
                "ControlNet": {
                    "args": [{
                        "enabled": true,
                        "module": "canny",
                        "model": "diffusers_xl_canny_mid",
                        "weight": 1.0,
                        "resize_mode": "Crop and Resize",
                        "control_mode": "My prompt is more important",
                        "guidance_start": 0.0,
                        "guidance_end": controlStepVal 
                    }]
                },
                "Soft inpainting": { "args": [{ "enabled": true }] }
            }
        };

        const response = await fetch(settings.API_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        if (!response.ok) throw new Error(`API Error: ${response.status}`);
        const json = await response.json();
        const resultB64 = json.images ? json.images[0] : null;

        if (!resultB64) throw new Error("API returned no image data.");

        await workflow.placeResultOnLayer(doc, resultB64, bounds);

    } catch (err) {
        console.error(err);
        showStatusMessage("Failed: " + err.message);
    } finally {
        const duration = (Date.now() - startTime) / 1000;
        btn.removeAttribute("disabled");
        btn.textContent = `Generate [${duration.toFixed(2)}s]`;
    }
}


entrypoints.setup({
    commands: {
        showAlert: () => alert("Plugin Loaded")
    },
    panels: {
        vanilla: {
            show(node) {
                setupEventListeners();
            }
        },
        settings: {
            // "create" runs ONCE when the panel is first created
            create(node) {
                settingsController.render(node);
            },
            // "show" runs EVERY TIME the panel becomes visible
            show(node) {
                // Just in case create didn't fire (rare bug), we ensure render
                settingsController.render(node);
                // Then we load the latest values
                settingsController.update(node);
            }
        }
    }
});