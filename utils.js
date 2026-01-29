// Calculates the square bounding box with padding
function getExtendedBoundingBox(selectionBounds, docW, docH) {
    let top = selectionBounds.top;
    let left = selectionBounds.left;
    let bottom = selectionBounds.bottom;
    let right = selectionBounds.right;

    // Extend by 64 pixels
    top -= 64; bottom += 64;
    left -= 64; right += 64;

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
            left += offset; right += offset;
        } else if (right > docW) {
            const offset = docW - right;
            left += offset; right += offset;
        }
        if (top < 0) {
            const offset = -top;
            top += offset; bottom += offset;
        } else if (bottom > docH) {
            const offset = docH - bottom;
            top += offset; bottom += offset;
        }
    }

    return {
        top: Math.max(0, Math.round(top)),
        left: Math.max(0, Math.round(left)),
        bottom: Math.min(docH, Math.round(bottom)),
        right: Math.min(docW, Math.round(right)),
    };
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

module.exports = {
    getExtendedBoundingBox,
    base64ArrayBuffer
};