// Default configuration values
const DEFAULTS = {
    API_URL: "http://127.0.0.1:7860/sdapi/v1/img2img",
    width: 1024,
    height: 1024,
    steps: 30,
    cfg_scale: 7.0,
    negative_prompt: "bad quality, worst quality, worst detail, sketch, censor",
    sampler_name: "Euler a",
    HISTORY: {
        MAX_ITEMS: 50,
        DEBOUNCE_MS: 400
    }
};

const STORAGE_KEY = "spice_plugin_settings";

module.exports = {
    // Helper to get current settings
    getSettings: () => {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (!saved) return DEFAULTS;
            const parsed = JSON.parse(saved);
            return { ...DEFAULTS, ...parsed }; 
        } catch (e) {
            console.error("Error loading settings:", e);
            return DEFAULTS;
        }
    },

    // Helper to save settings
    saveSettings: (newSettings) => {
        const current = module.exports.getSettings();
        const updated = { ...current, ...newSettings };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    },

    HISTORY: DEFAULTS.HISTORY
};