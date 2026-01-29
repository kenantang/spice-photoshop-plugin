const { core, app } = require("photoshop");
const { localFileSystem: fs, formats } = require("uxp").storage;
const { base64ArrayBuffer } = require("./utils");
const actions = require("./ps-actions");

async function extractRegionAsBase64(doc, bounds, isMask) {
    let base64Result = "";
    const tempFolder = await fs.getTemporaryFolder();
    const fileName = isMask ? "temp_mask.png" : "temp_img.png";
    const tempFile = await tempFolder.createFile(fileName, { overwrite: true });

    await core.executeAsModal(async () => {
        const initialState = doc.activeHistoryState;
        let tempDoc = null;

        try {
            if (isMask) {
                const maskLayer = await doc.layers.add();
                maskLayer.name = "Temp_Generation_Mask";
                
                await actions.fillSelection(255, 255, 255);
                await actions.invertSelection();
                await actions.fillSelection(0, 0, 0);
                await doc.selection.deselect();
            }

            // Flatten and Duplicate
            tempDoc = await doc.duplicate("Temp_Export_Doc", true);

            // Revert Main Doc
            doc.activeHistoryState = initialState;

            // Crop Temp Doc
            await tempDoc.crop(bounds);
            await tempDoc.saveAs.png(tempFile, { compression: 0 }, true);

        } catch (e) {
            console.error("Extraction error:", e);
            throw e;
        } finally {
            if (tempDoc) await tempDoc.closeWithoutSaving();
            if (doc.activeHistoryState !== initialState) {
                doc.activeHistoryState = initialState;
            }
        }
    }, { commandName: isMask ? "Prepare Mask" : "Prepare Image" });

    const arrayBuffer = await tempFile.read({ format: formats.binary });
    return base64ArrayBuffer(arrayBuffer);
}

async function isSelectionStrictlyFull(doc) {
    let isFull = false;
    // Fast fail checks
    if (!doc.selection || !doc.selection.bounds) return false;
    
    const b = doc.selection.bounds;
    if (b.width !== doc.width || b.height !== doc.height) return false;

    // Deep check
    await core.executeAsModal(async () => {
        const savedState = doc.activeHistoryState;
        try {
            await actions.invertSelection();
            let invBounds = null;
            try { invBounds = doc.selection.bounds; } catch (e) { invBounds = null; }

            isFull = !invBounds; // If inverse is empty, selection was full
        } catch (e) {
            console.error("Check failed", e);
        } finally {
            doc.activeHistoryState = savedState;
        }
    }, { commandName: "Check Full Selection" });

    return isFull;
}

async function placeResultOnLayer(doc, base64Str, bounds) {
    const tempFolder = await fs.getTemporaryFolder();
    const file = await tempFolder.createFile("result.png", { overwrite: true });
    
    // Write Base64
    const binary = atob(base64Str);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    await file.write(bytes.buffer, { format: formats.binary });

    await core.executeAsModal(async () => {
        const tempDoc = await app.open(file);
        const sourceLayer = tempDoc.layers[0];
        
        // Push to main doc
        await sourceLayer.duplicate(doc);
        await tempDoc.closeWithoutSaving();

        // Align
        const currentPos = await actions.getActiveLayerBounds();
        const deltaX = bounds.left - currentPos.left;
        const deltaY = bounds.top - currentPos.top;

        if (Math.round(deltaX) !== 0 || Math.round(deltaY) !== 0) {
            await actions.translateActiveLayer(Math.round(deltaX), Math.round(deltaY));
        }

        await doc.selection.deselect();
    }, { commandName: "Place Generated Result" });
}

module.exports = {
    extractRegionAsBase64,
    isSelectionStrictlyFull,
    placeResultOnLayer
};