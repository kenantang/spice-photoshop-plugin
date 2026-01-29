const { batchPlay } = require("photoshop").action;

async function fillSelection(r, g, b) {
    await batchPlay([{
        _obj: "fill",
        using: { _enum: "fillContents", _value: "color" },
        color: { _obj: "RGBColor", red: r, green: g, blue: b },
        opacity: { _unit: "percentUnit", _value: 100 },
        mode: { _enum: "blendMode", _value: "normal" }
    }], { synchronousExecution: true });
}

async function invertSelection() {
    await batchPlay([{ _obj: "inverse" }], { synchronousExecution: true });
}

async function setSelection(top, left, bottom, right) {
    await batchPlay([{
        _obj: "set",
        _target: [{ _ref: "channel", _enum: "channel", _value: "selection" }],
        to: {
            _obj: "rectangle",
            top: { _unit: "pixelsUnit", _value: top },
            left: { _unit: "pixelsUnit", _value: left },
            bottom: { _unit: "pixelsUnit", _value: bottom },
            right: { _unit: "pixelsUnit", _value: right }
        }
    }], { synchronousExecution: true });
}

async function translateActiveLayer(x, y) {
    await batchPlay([{
        _obj: "move", // Using move for placement alignment
        _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
        to: {
            _obj: "offset",
            horizontal: { _unit: "pixelsUnit", _value: x },
            vertical: { _unit: "pixelsUnit", _value: y }
        }
    }], { synchronousExecution: true });
}

async function getActiveLayerBounds() {
    const result = await batchPlay([{
        _obj: "get",
        _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
        _property: [{ _property: "bounds" }]
    }], { synchronousExecution: true });

    if (!result[0] || !result[0].bounds) throw new Error("Could not retrieve layer bounds");
    const b = result[0].bounds;
    
    // Normalize return values
    return {
        top: b.top._value !== undefined ? b.top._value : b.top,
        left: b.left._value !== undefined ? b.left._value : b.left,
        bottom: b.bottom._value !== undefined ? b.bottom._value : b.bottom,
        right: b.right._value !== undefined ? b.right._value : b.right
    };
}

module.exports = {
    fillSelection,
    invertSelection,
    setSelection,
    translateActiveLayer,
    getActiveLayerBounds
};