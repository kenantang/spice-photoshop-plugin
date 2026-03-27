# SPICE Photoshop Plugin

This repository contains the official implementation of [SPICE: A Synergistic, Precise, Iterative, and Customizable Image Editing Workflow](https://github.com/kenantang/spice).  

The free **Photoshop plugin** is the recommended way to use SPICE:
1. It tightly integrates SPICE’s iterative, error-correcting workflow with Photoshop’s powerful editing tools, enabling a seamless and efficient image editing experience.
2. During iterative editing, SPICE guarantees **zero quality degradation and zero pixel shift**, eliminating two fatal flaws of Nano Banana Pro in Photoshop.

The plugin is downloadable from the [Adobe Marketplace](https://exchange.adobe.com/apps/cc/c09047be/spice). You can also directly use the code in this repository, if you have the Adobe UXP Developer Tools on your device.

[02.02.2026] The plugin requires a backend server that runs SPICE. If you are new to Automatic1111 or ComfyUI, you can contact the SPICE paper authors via email for a temporary API link for a trial. If you have any questions regarding the setup, feel free to open a GitHub issue.

## Demonstration

This short demonstration video shows how to use SPICE to repair artifacts on the image, including:
1. Eyes of different sizes
2. Corrupted patterns on the clothes

The video shows that you can simply **select a region**, click the "Generate" button, and the artifacts will automatically be repaired. Note that the prompt can be extremely simple, without specifying what you would like to do ("make eyes the same size" or "repair the scrambled patterns").

https://github.com/user-attachments/assets/d672143b-c508-4758-a006-cff2661ab97c

## Getting Started

Follow the steps below to set up and use the SPICE Photoshop plugin.

### 1. Backend Setup

SPICE requires a backend that supports image inpainting.

- **Supported:** Automatic1111 Web UI  
- **Coming soon:** ComfyUI

To set up the Automatic1111 backend, you need to install the ControlNet extension and download the model as in [this tutorial](https://github.com/kenantang/spice?tab=readme-ov-file#stable-diffusion-models).

Start Automatic1111 with API support enabled:

```bash
./webui.sh --api
```

By default, the Photoshop plugin sends requests to:

```
https://127.0.0.1:7860/
```

and receives edited images from the backend.

### 2. Editing Workflow in Photoshop

Inside Photoshop:

1. Add a **color patch** to the current layer.  
   - The color patch may also be placed on a separate layer.  
   - SPICE always uses the *current visible pixels* as input.
2. Use any **selection tool** to draw:
   - Masks  
   - Context dots
3. Enter a **text prompt**, then click **Generate**.

The edited result will appear as a **new layer** in the document. If you accept the result, you can merge it to the existing layer below. SPICE delivers a smooth and robust editing experience, despite operating as a fully single-layer workflow.

### 3. Controlling Output Quality

SPICE is designed to be controlled with a minimal number of parameters. Two sliders are provided:

- **Denoising Strength**
- **ControlNet Steps**

These two parameters are sufficient to achieve high-quality and controllable results, highlighting one of SPICE’s core advantages: powerful editing with very few knobs.


## Version Notes

- **0.0.6**
  - The input image and mask to the API is now processed as 24-bit PNGs. The previous version used 32-bit PNGs, which led to intermittent errors when selection touched the boundary of the canvas. Stripping off the alpha channel has no effect on generated results, as the backend diffusion model is an RGB-only model.
  - The input image, mask, and output image are all saved locally in the plugin temporary file folder. In the future, this will be updated as an option to support data collection.

- **0.0.5**
  - Fixes full selection issue. With full selection, if the Denoising Strength is set to 100% and the ControlNet Steps is set to 0%, the inpainting is effectively generation from scratch. This fix allows the interface to support both generation and editing, without going back to the Forge interface.
  - Condenses multiple operations into one, when pasting the generated result. Now a single Undo operation can revert the result. GUI flashing should no longer appear, as all moving operations have been replaced.
  - When the cursor moves out of the text box, the hotkeys for Photoshop operations can be immediately used, instead of being captured by the text box.
  - The new pipeline for preparing API inputs seems to have resolved the PPI issue.
  - Displays values in the title of sliders.
  - Updates default positive prompt to be consistent with WAI-illustrious-SDXL v16.0.
  - Shows progress percentage on the Generate button. (The progress API endpoint of Automatic1111 corrupts the current image generation process when called, so progress cannot be queried, unless the Forge backend is used.)

- **0.0.4**
  - Uses the Stable Diffusion WebUI Forge backend for much faster inference. Please do not use the Automatic1111 backend anymore. The installation instructions above will be later updated to reflect this change.
  - GUI flashing is minimized. Now the code avoids most operations in Photoshop viewport to minimize flashing caused by refocusing the viewport.

- **0.0.3**
  - Supports changing parameters in a separate "SPICE Settings" panel. These parameters do not need to be changed frequently, so no sliders are used for them.
  - Adds a reminder message when the backend is not active. The backend can be configured in the settings panel.
  - Uses new icons.

- **0.0.2**
  - Partially fixes full-image selection bug. Now API is not called when the full image is selected.
  - Partially fixes sub-pixel image shift. Now the coordinates are correct, but Photoshop snaps the pasted image to an unwanted grid. The alignment is correct when the zoom level is at the same level when the mask was drawn. Practically, the image shift will not be a problem, as the mask is always drawn at a zoomed-in level.
  - Partially fixes GUI flashing. Now after flashing, the view is still maintained as the same before flashing. This is at least less annoying.
  - Implements error message for no active selection.
  - Supports prompt undo and redo.
  - Supports showing the generation time of the previous run on the button. The progress API interferes with generation and is thus unusable, so no progress bar will be implemented.

- **0.0.1**
  - Initial minimal working version
  - Uses Automatic1111 Web UI as the backend

## Known Issues

All previously known issues have been resolved.

## License

This project is licensed under the  
**Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International License (CC BY-NC-SA 4.0)**.

You are free to:
- Share — copy and redistribute the material in any medium or format  
- Adapt — remix, transform, and build upon the material  

Under the following terms:
- **Attribution** — You must give appropriate credit and indicate if changes were made  
- **NonCommercial** — You may not use the material for commercial purposes  
- **ShareAlike** — If you remix, transform, or build upon the material, you must distribute your contributions under the same license  

Full license text:  
https://creativecommons.org/licenses/by-nc-sa/4.0/
