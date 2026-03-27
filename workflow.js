const { core, imaging } = require("photoshop");
const { batchPlay } = require("photoshop").action;
const actions = require("./ps-actions");

// Pure-JS DEFLATE inflate — handles the zlib-wrapped stream in PNG IDAT chunks.
// No DecompressionStream or other Web APIs required.
function inflateZlib(buf) {
    let p = 2, bits = 0, nBits = 0; // skip 2-byte zlib header (CMF + FLG)

    // Read n bits, LSB first
    const read = n => {
        while (nBits < n) { bits = (bits | (buf[p++] << nBits)) >>> 0; nBits += 8; }
        const v = bits & ((1 << n) - 1); bits >>>= n; nBits -= n; return v;
    };

    // RFC 1951 length/distance base values and extra-bit counts
    const LB = [3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258];
    const LE = [0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0];
    const DB = [1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577];
    const DE = [0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13];

    // Build a flat lookup table from canonical Huffman code lengths.
    // Each entry encodes (symbol << 5) | codeLen.
    const makeT = lens => {
        const ml = Math.max(1, ...lens);
        const bc = new Uint16Array(ml + 1);
        for (const l of lens) if (l) bc[l]++;
        const nc = new Uint16Array(ml + 1);
        for (let i = 1; i <= ml; i++) nc[i] = (nc[i-1] + bc[i-1]) << 1;
        const T = new Int32Array(1 << ml).fill(-1);
        for (let s = 0; s < lens.length; s++) {
            const l = lens[s]; if (!l) continue;
            const c = nc[l]++;
            // DEFLATE sends Huffman codes MSB-first through an LSB-first bit stream,
            // so the bit-reversed canonical code is what appears in the accumulator.
            let rev = 0;
            for (let k = 0; k < l; k++) rev |= ((c >> (l-1-k)) & 1) << k;
            // Fill all table slots that share these low-l bits (high bits are don't-cares).
            const fill = 1 << (ml - l), entry = (s << 5) | l;
            for (let i = 0; i < fill; i++) T[rev | (i << l)] = entry;
        }
        return [T, ml];
    };

    const readH = (T, ml) => {
        while (nBits < ml) { bits = (bits | (buf[p++] << nBits)) >>> 0; nBits += 8; }
        const e = T[bits & ((1 << ml) - 1)];
        if (e < 0) throw new Error('bad huffman code');
        const l = e & 31; bits >>>= l; nBits -= l;
        return e >> 5;
    };

    let out = new Uint8Array(1 << 22); // 4 MB initial; grows as needed
    let outLen = 0;

    while (true) {
        const bfinal = read(1), btype = read(2);

        if (btype === 0) {
            // Non-compressed stored block
            bits = 0; nBits = 0; // byte-align
            const len = buf[p] | (buf[p+1] << 8); p += 4; // skip LEN + NLEN
            if (outLen + len > out.length) { const t = new Uint8Array(out.length * 2); t.set(out); out = t; }
            out.set(buf.subarray(p, p + len), outLen); outLen += len; p += len;
        } else {
            let litT, litML, distT, distML;

            if (btype === 1) {
                // Fixed Huffman codes (RFC 1951 §3.2.6)
                const ll = new Array(288);
                for (let i =   0; i <= 143; i++) ll[i] = 8;
                for (let i = 144; i <= 255; i++) ll[i] = 9;
                for (let i = 256; i <= 279; i++) ll[i] = 7;
                for (let i = 280; i <= 287; i++) ll[i] = 8;
                [litT, litML]  = makeT(ll);
                [distT, distML] = makeT(new Array(32).fill(5));
            } else {
                // Dynamic Huffman codes
                const hlit = read(5)+257, hdist = read(5)+1, hclen = read(4)+4;
                const CLO = [16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15];
                const clLens = new Array(19).fill(0);
                for (let i = 0; i < hclen; i++) clLens[CLO[i]] = read(3);
                const [clT, clML] = makeT(clLens);
                const all = [];
                while (all.length < hlit + hdist) {
                    const sym = readH(clT, clML);
                    if      (sym < 16)   { all.push(sym); }
                    else if (sym === 16) { const r = read(2)+3; for (let i=0;i<r;i++) all.push(all[all.length-1]); }
                    else if (sym === 17) { const r = read(3)+3; for (let i=0;i<r;i++) all.push(0); }
                    else                 { const r = read(7)+11; for (let i=0;i<r;i++) all.push(0); }
                }
                [litT, litML]  = makeT(all.slice(0, hlit));
                [distT, distML] = makeT(all.slice(hlit));
            }

            while (true) {
                const sym = readH(litT, litML);
                if (sym === 256) break;
                if (sym < 256) {
                    if (outLen >= out.length) { const t = new Uint8Array(out.length * 2); t.set(out); out = t; }
                    out[outLen++] = sym;
                } else {
                    const li = sym - 257;
                    const len = LB[li] + read(LE[li]);
                    const distSym = readH(distT, distML);
                    const dist = DB[distSym] + read(DE[distSym]);
                    if (outLen + len > out.length) { const t = new Uint8Array(out.length * 2); t.set(out); out = t; }
                    let src = outLen - dist;
                    for (let i = 0; i < len; i++) out[outLen++] = out[src++];
                }
            }
        }
        if (bfinal) break;
    }
    return out.subarray(0, outLen);
}

// Decodes a PNG file (Uint8Array) to raw RGBA pixels. Pure JS, no Web APIs.
function decodePNG(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset);
    let pos = 8; // skip 8-byte PNG signature
    let width, height, colorType;
    const idatParts = [];

    while (pos + 12 <= bytes.length) {
        const len = dv.getUint32(pos);
        const type = String.fromCharCode(bytes[pos+4], bytes[pos+5], bytes[pos+6], bytes[pos+7]);
        if (type === 'IHDR') {
            width     = dv.getUint32(pos + 8);
            height    = dv.getUint32(pos + 12);
            colorType = bytes[pos + 17]; // 2=RGB, 6=RGBA
        } else if (type === 'IDAT') {
            idatParts.push(bytes.slice(pos + 8, pos + 8 + len));
        } else if (type === 'IEND') {
            break;
        }
        pos += 12 + len;
    }

    const totalLen = idatParts.reduce((n, c) => n + c.length, 0);
    const compressed = new Uint8Array(totalLen);
    let off = 0;
    for (const c of idatParts) { compressed.set(c, off); off += c.length; }

    const raw = inflateZlib(compressed);

    const channels = colorType === 6 ? 4 : 3;
    const rowBytes = width * channels;
    const rgba = new Uint8Array(width * height * 4);

    function paeth(a, b, c) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
    }

    let prevRow = new Uint8Array(rowBytes);
    for (let y = 0; y < height; y++) {
        const filter = raw[y * (rowBytes + 1)];
        const src = raw.subarray(y * (rowBytes + 1) + 1, y * (rowBytes + 1) + 1 + rowBytes);
        const out = new Uint8Array(rowBytes);
        for (let x = 0; x < rowBytes; x++) {
            const a = x >= channels ? out[x - channels] : 0;
            const b = prevRow[x];
            const c = x >= channels ? prevRow[x - channels] : 0;
            switch (filter) {
                case 0: out[x] = src[x]; break;
                case 1: out[x] = (src[x] + a) & 0xFF; break;
                case 2: out[x] = (src[x] + b) & 0xFF; break;
                case 3: out[x] = (src[x] + Math.floor((a + b) / 2)) & 0xFF; break;
                case 4: out[x] = (src[x] + paeth(a, b, c)) & 0xFF; break;
            }
        }
        prevRow = out;
        if (channels === 4) {
            rgba.set(out, y * width * 4);
        } else {
            for (let x = 0; x < width; x++) {
                rgba[y * width * 4 + x * 4]     = out[x * 3];
                rgba[y * width * 4 + x * 4 + 1] = out[x * 3 + 1];
                rgba[y * width * 4 + x * 4 + 2] = out[x * 3 + 2];
                rgba[y * width * 4 + x * 4 + 3] = 255;
            }
        }
    }

    return { rgba, width, height };
}

// Encodes raw RGBA pixels into a 24-bit RGB PNG and returns a base64 string.
// Uses only typed arrays — no canvas or browser globals required.
function encodeRGBAtoPNG(rgba, width, height) {
    // CRC32 lookup table
    const crcTable = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) c = (c & 1) ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
        crcTable[i] = c;
    }
    function crc32(buf) {
        let c = 0xFFFFFFFF;
        for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
        return (c ^ 0xFFFFFFFF) >>> 0;
    }

    function u32be(v) {
        return new Uint8Array([(v >>> 24) & 0xFF, (v >>> 16) & 0xFF, (v >>> 8) & 0xFF, v & 0xFF]);
    }

    function buildChunk(type, data) {
        const t = new Uint8Array([type.charCodeAt(0), type.charCodeAt(1), type.charCodeAt(2), type.charCodeAt(3)]);
        const body = new Uint8Array(4 + data.length);
        body.set(t); body.set(data, 4);
        const out = new Uint8Array(4 + 4 + data.length + 4);
        out.set(u32be(data.length));
        out.set(t, 4);
        out.set(data, 8);
        out.set(u32be(crc32(body)), 8 + data.length);
        return out;
    }

    // IHDR: width, height, 8-bit RGB
    const ihdr = new Uint8Array(13);
    new DataView(ihdr.buffer).setUint32(0, width);
    new DataView(ihdr.buffer).setUint32(4, height);
    ihdr[8] = 8; ihdr[9] = 2; // bit depth=8, color type=RGB

    // Raw scanlines: prepend filter byte 0 (None) to each row, strip alpha
    const rowBytes = width * 3;
    const raw = new Uint8Array(height * (rowBytes + 1));
    for (let y = 0; y < height; y++) {
        raw[y * (rowBytes + 1)] = 0;
        for (let x = 0; x < width; x++) {
            const src = (y * width + x) * 4;
            const dst = y * (rowBytes + 1) + 1 + x * 3;
            raw[dst]     = rgba[src];
            raw[dst + 1] = rgba[src + 1];
            raw[dst + 2] = rgba[src + 2];
        }
    }

    // Adler-32 checksum over raw data
    let s1 = 1, s2 = 0;
    for (let i = 0; i < raw.length; i++) { s1 = (s1 + raw[i]) % 65521; s2 = (s2 + s1) % 65521; }

    // Deflate: uncompressed store blocks (BTYPE=00), max 65535 bytes each
    const blockMax = 65535;
    const numBlocks = Math.max(1, Math.ceil(raw.length / blockMax));
    const deflate = new Uint8Array(raw.length + numBlocks * 5);
    let dPos = 0;
    for (let b = 0; b < numBlocks; b++) {
        const start = b * blockMax;
        const end = Math.min(start + blockMax, raw.length);
        const len = end - start;
        deflate[dPos++] = b === numBlocks - 1 ? 1 : 0; // BFINAL | BTYPE=00
        deflate[dPos++] = len & 0xFF;
        deflate[dPos++] = (len >>> 8) & 0xFF;
        deflate[dPos++] = (~len) & 0xFF;
        deflate[dPos++] = ((~len) >>> 8) & 0xFF;
        deflate.set(raw.subarray(start, end), dPos);
        dPos += len;
    }

    // Zlib wrapper: CMF=0x78 FLG=0x01 (valid: (0x78*256+0x01)%31===0)
    const zlib = new Uint8Array(2 + deflate.length + 4);
    zlib[0] = 0x78; zlib[1] = 0x01;
    zlib.set(deflate, 2);
    new DataView(zlib.buffer).setUint32(2 + deflate.length, (s2 << 16) | s1);

    // Assemble PNG
    const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const parts = [sig, buildChunk('IHDR', ihdr), buildChunk('IDAT', zlib), buildChunk('IEND', new Uint8Array(0))];
    const total = parts.reduce((n, p) => n + p.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const p of parts) { out.set(p, off); off += p.length; }

    // Base64 encode in chunks to avoid call-stack limits
    let b64 = '';
    const chunkSize = 8192;
    for (let i = 0; i < out.length; i += chunkSize) {
        b64 += String.fromCharCode.apply(null, out.subarray(i, i + chunkSize));
    }
    return btoa(b64);
}

async function extractRegionAsBase64(doc, bounds, isMask) {
    const width = bounds.right - bounds.left;
    const height = bounds.bottom - bounds.top;
    // rawPixels is populated inside the modal, before history is reverted,
    // so we hold a safe JS copy rather than a potentially-stale PS reference.
    let rawPixels, numComponents;

    await core.executeAsModal(async () => {
        const initialState = doc.activeHistoryState;
        try {
            // Mirror the original logic exactly:
            //   isMask=true  → add a fully-opaque white/black mask layer on top,
            //                   then stamp-visible so the composite = the mask.
            //   isMask=false → stamp-visible gives the flat composite image.
            // In both cases the stamp layer becomes the read target.
            if (isMask) {
                const maskLayer = await doc.layers.add();
                maskLayer.name = "Temp_Generation_Mask";
                await actions.fillSelection(255, 255, 255);
                await actions.invertSelection();
                await actions.fillSelection(0, 0, 0);
            }

            await batchPlay(
                [{ _obj: "mergeVisible", duplicate: true }],
                { synchronousExecution: true }
            );
            const targetLayerId = doc.activeLayers[0].id;

            const pixelInfo = await imaging.getPixels({
                documentID: doc.id,
                layerID: targetLayerId,
                sourceBounds: { left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom },
                componentSize: 8,
                colorSpace: "RGB",
                applyAlpha: false
            });

            // pixelInfo.imageData is a PhotoshopImageData instance.
            // Call .getData() on it to get the raw ArrayBuffer.
            // We requested colorSpace:"RGB" applyAlpha:false → always 3 channels.
            const imgData = pixelInfo.imageData;
            const rawBuffer = await imgData.getData();

            rawPixels = new Uint8Array(rawBuffer);
            numComponents = rawPixels.length / (width * height); // actual channel count from buffer
        } catch (e) {
            console.error("Extraction error:", e);
            throw e;
        } finally {
            doc.activeHistoryState = initialState;
        }
    }, { commandName: isMask ? "Prepare Mask" : "Prepare Image" });

    // Build RGBA array for the PNG encoder (always 4 channels)
    const rgba = new Uint8Array(width * height * 4);
    if (numComponents === 4) {
        rgba.set(rawPixels);
    } else { // 3 components (RGB) — add full alpha
        for (let i = 0, j = 0; i < rawPixels.length; i += 3, j += 4) {
            rgba[j]     = rawPixels[i];
            rgba[j + 1] = rawPixels[i + 1];
            rgba[j + 2] = rawPixels[i + 2];
            rgba[j + 3] = 255;
        }
    }

    return encodeRGBAtoPNG(rgba, width, height);
}

function makeWhiteMaskBase64(width, height) {
    const rgba = new Uint8Array(width * height * 4).fill(255);
    return encodeRGBAtoPNG(rgba, width, height);
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
    // Decode the base64 PNG directly in JS — no temp document opened,
    // so Photoshop never switches active document and the viewport stays put.
    const binary = atob(base64Str);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    const { rgba, width: resultWidth, height: resultHeight } = decodePNG(bytes);

    await core.executeAsModal(async (executionContext) => {
        const suspensionID = await executionContext.hostControl.suspendHistory({
            documentID: doc.id,
            name: "SPICE"
        });

        try {
            const newLayer = await doc.layers.add({ name: "SPICE Result" });

            const imgData = await imaging.createImageDataFromBuffer(rgba, {
                width: resultWidth,
                height: resultHeight,
                components: 4,
                colorSpace: "RGB"
            });

            await imaging.putPixels({
                documentID: doc.id,
                layerID: newLayer.id,
                targetBounds: {
                    left: bounds.left,
                    top: bounds.top,
                    right: bounds.left + resultWidth,
                    bottom: bounds.top + resultHeight
                },
                imageData: imgData
            });

            await doc.selection.deselect();

            await executionContext.hostControl.resumeHistory(suspensionID, true);
        } catch (e) {
            await executionContext.hostControl.resumeHistory(suspensionID, false);
            throw e;
        }
    }, { commandName: "SPICE" });
}

module.exports = {
    extractRegionAsBase64,
    isSelectionStrictlyFull,
    makeWhiteMaskBase64,
    placeResultOnLayer
};