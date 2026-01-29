const config = require("./config");

// Define the HTML UI structure here
const PANEL_HTML = `
    <style>
        .setting-body { padding: 12px; display: flex; flex-direction: column; gap: 15px; }
        .setting-group { display: flex; flex-direction: column; gap: 5px; }
        .row { display: flex; gap: 10px; }
        sp-textfield, sp-textarea, sp-picker { width: 100%; }
        .half { flex: 1; }
        
        /* UPDATED: Removed 'color: green' and added 'align-self: center' */
        #statusMessage { 
            margin-top: 5px; 
            display: none; 
            align-self: center; 
        }
    </style>
    <div class="setting-body">
        <div class="setting-group">
            <sp-label>API URL</sp-label>
            <sp-textfield id="set_api_url" placeholder="http://127.0.0.1:7860..."></sp-textfield>
        </div>
        <div class="row">
            <div class="setting-group half">
                <sp-label>Width</sp-label>
                <sp-textfield type="number" id="set_width" placeholder="1024"></sp-textfield>
            </div>
            <div class="setting-group half">
                <sp-label>Height</sp-label>
                <sp-textfield type="number" id="set_height" placeholder="1024"></sp-textfield>
            </div>
        </div>
        <div class="row">
            <div class="setting-group half">
                <sp-label>Steps</sp-label>
                <sp-textfield type="number" id="set_steps" placeholder="30"></sp-textfield>
            </div>
            <div class="setting-group half">
                <sp-label>CFG Scale</sp-label>
                <sp-textfield type="number" id="set_cfg" placeholder="7.0" step="0.5"></sp-textfield>
            </div>
        </div>
        <div class="setting-group">
            <sp-label>Sampler Name</sp-label>
            <sp-textfield id="set_sampler" placeholder="Euler a"></sp-textfield>
        </div>
        <div class="setting-group">
            <sp-label>Negative Prompt</sp-label>
            <sp-textarea id="set_neg_prompt" style="height: 100px;"></sp-textarea>
        </div>
        <footer>
            <sp-button id="btnSaveSettings" variant="cta">Save Settings</sp-button>
        </footer>
        <sp-label id="statusMessage"></sp-label>
    </div>
`;

const $ = (root, selector) => root.querySelector(selector);

function loadValues(root) {
    const current = config.getSettings();
    
    // Safety check
    const apiUrl = $(root, "#set_api_url");
    if (!apiUrl) return;

    apiUrl.value = current.API_URL;
    $(root, "#set_width").value = current.width;
    $(root, "#set_height").value = current.height;
    $(root, "#set_steps").value = current.steps;
    $(root, "#set_cfg").value = current.cfg_scale;
    $(root, "#set_sampler").value = current.sampler_name;
    $(root, "#set_neg_prompt").value = current.negative_prompt;
}

function saveValues(root) {
    const newSettings = {
        API_URL: $(root, "#set_api_url").value,
        width: parseInt($(root, "#set_width").value) || 1024,
        height: parseInt($(root, "#set_height").value) || 1024,
        steps: parseInt($(root, "#set_steps").value) || 30,
        cfg_scale: parseFloat($(root, "#set_cfg").value) || 7.0,
        sampler_name: $(root, "#set_sampler").value,
        negative_prompt: $(root, "#set_neg_prompt").value
    };

    config.saveSettings(newSettings);

    const msg = $(root, "#statusMessage");
    msg.textContent = "Settings Saved!";
    msg.style.display = "block";
    
    // Clear any existing timer to prevent flickering
    if (msg.hideTimer) clearTimeout(msg.hideTimer);
    
    msg.hideTimer = setTimeout(() => { 
        msg.style.display = "none"; 
    }, 2000);
}

module.exports = {
    render: (rootNode) => {
        if (rootNode.innerHTML.trim() === "") {
            rootNode.innerHTML = PANEL_HTML;
            const btn = $(rootNode, "#btnSaveSettings");
            if (btn) btn.onclick = () => saveValues(rootNode);
        }
    },
    update: (rootNode) => {
        loadValues(rootNode);
    }
};