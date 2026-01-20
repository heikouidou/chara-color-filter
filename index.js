import { extension_settings, getContext, loadExtensionSettings } from "../../../extensions.js";
import { saveSettingsDebounced, this_chid } from "../../../../script.js";

const extensionName = "chara-color-filter";
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;
const defaultSettings = {};

// ==========================================
// 🎨 Settings & Global Variables
// ==========================================
let currentGlobalColor = { r: 0, g: 0, b: 0 };
let updateTimer = null;
let isBgDirty = true; // Flag for initial execution
let windowHeight = 0;
let canvasFit = $('canvas').css('object-fit');
let charaId = undefined; // To track character changes

// Initialize Settings
loadSettings();

// ==========================================
// 🛠️ Image Processing Functions
// ==========================================

/**
 * 1. Get Average Color from Image URL
 * @param {string} imgUrl 
 * @returns {Promise<{r: number, g: number, b: number}>}
 */
async function getAverageColorFromUrl(imgUrl) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "Anonymous";
        img.src = imgUrl;
        img.onload = () => {
            try {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                canvas.width = 1;
                canvas.height = 1;
                ctx.drawImage(img, 0, 0, 1, 1);
                const data = ctx.getImageData(0, 0, 1, 1).data;
                resolve({ r: data[0], g: data[1], b: data[2] });
            } catch (e) {
                reject(e);
            }
        };
        img.onerror = (e) => reject(e);
    });
}

/**
 * 2. Generate and Apply Filter (Canvas)
 * @param {object} color - {r, g, b}
 * @param {HTMLElement} targetElement - Specific image element (optional)
 * @param {string} objectFit - CSS object-fit property
 * @param {string} blendMode - CSS mix-blend-mode property
 */
const makeCharaFilter = async (color, targetElement = null, objectFit = 'contain', blendMode = 'None') => {
    // Target identification: Argument > Last child image > ID
    const targetImg = targetElement || document.querySelector('.expression-holder img:last-child') || document.getElementById('expression-image');

    if (!targetImg) return;

    // Cleanup existing filter
    $(targetImg.parentNode).find('.expression-filter-canvas').remove();

    const canvas = document.createElement('canvas');
    canvas.classList.add('expression-filter-canvas'); // Class for identification

    // Copy computed styles from the target image
    const computedStyle = window.getComputedStyle(targetImg);

    // Common CSS styles
    const cssStyles = {
        'position': 'absolute',
        'z-index': 2147483647, // Bring to front
        'top': 0,
        'left': 0,
        'pointer-events': 'none',
        'width': '100%',
        'height': '100%',
        'max-height': computedStyle.maxHeight,
        'max-width': computedStyle.maxWidth,
        'object-fit': objectFit,
        'object-position': computedStyle.objectPosition,
        'visibility': 'visible'
    };

    // Apply Blend Mode settings
    if (blendMode === 'None' || blendMode === undefined) {
        $(canvas).css({
            ...cssStyles,
            'mix-blend-mode': 'normal',
            'opacity': 0
        });
    } else {
        $(canvas).css({
            ...cssStyles,
            'mix-blend-mode': blendMode,
            'opacity': 0.7
        });
    }

    // Save settings
    extension_settings[extensionName].blend_mode_setting = blendMode;
    saveSettingsDebounced();

    // Append to parent
    targetImg.parentNode.appendChild(canvas);

    // Drawing process
    const ctx = canvas.getContext('2d');
    canvas.width = targetImg.naturalWidth || 600;
    canvas.height = targetImg.naturalHeight || 900;

    // Create Silhouette & Fill
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(targetImg, 0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = `rgb(${color.r}, ${color.g}, ${color.b})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
}

/**
 * 3. Wait for Image Load (Event Listener approach)
 * @param {HTMLElement} imgNode 
 * @param {number} timeout 
 */
function waitForImageLoad(imgNode, timeout = 5000) {
    return new Promise((resolve) => {
        if (!imgNode || imgNode.tagName !== 'IMG') return resolve(false);
        if (imgNode.complete && imgNode.naturalWidth > 0) return resolve(true);

        const onLoad = () => { cleanup(); resolve(true); };
        const onError = () => { cleanup(); resolve(false); };
        const cleanup = () => {
            imgNode.removeEventListener('load', onLoad);
            imgNode.removeEventListener('error', onError);
        };

        imgNode.addEventListener('load', onLoad);
        imgNode.addEventListener('error', onError);

        setTimeout(() => {
            if (!imgNode.complete || imgNode.naturalWidth === 0) {
                cleanup();
                resolve(false);
            }
        }, timeout);
    });
}

// ==========================================
// ⚡️ Execution Control (Main Logic)
// ==========================================
async function processFilter(targetImgNode) {
    // Update Background Color if dirty
    if (isBgDirty) {
        const targetBg = document.getElementById('bg1');
        if (targetBg) {
            const bgStyle = targetBg.style.backgroundImage;
            if (bgStyle && bgStyle !== 'none') {
                // Extract URL from style string
                const imgUrl = bgStyle.replace(/^url\(['"]?/, '').replace(/['"]?\)$/, '');
                try {
                    currentGlobalColor = await getAverageColorFromUrl(imgUrl);
                    isBgDirty = false;
                } catch (e) { 
                    console.error("[CharaColorFilter] Background color fetch error:", e); 
                }
            }
        }
    }

    // Apply Filter
    if (targetImgNode) {
        const isReady = await waitForImageLoad(targetImgNode);
        if (isReady) {
            canvasFit = $('#expression-image').css('object-fit');
            await makeCharaFilter(currentGlobalColor, targetImgNode, canvasFit, extension_settings[extensionName].blend_mode_setting);
        }
    }
}

// Debounce Function
function triggerDebounce(node) {
    if (updateTimer) clearTimeout(updateTimer);
    updateTimer = setTimeout(() => {
        processFilter(node);
        updateTimer = null;
    }, 100);
}

// ==========================================
// 👁️ Observers
// ==========================================

// 1. Character Sprite Observer (Detects clones and changes)
const cloneObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
        if (mutation.type === 'childList') {
            
            // Detect Character Change or Home Screen Transition
            if (this_chid !== charaId) {
                // If returned to Home Screen (undefined), hide the filter
                if (this_chid === undefined) {
                    $(".expression-filter-canvas").css('visibility', 'hidden');
                }
                charaId = this_chid;
            }

            // Monitor sprite addition/changes
            mutation.addedNodes.forEach(node => {
                if (node.tagName === 'IMG' && node.classList.contains('expression')) {
                    triggerDebounce(node);
                }
            });
        }
    }
});

// 2. Background Observer (Watches for style changes on bg1)
const bgObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
        if (mutation.attributeName === 'style') {
            isBgDirty = true;
            // Apply to the current image
            const currentImg = document.getElementById('expression-image');
            // Fallback to querySelector if ID not found
            const target = currentImg || document.querySelector('.expression-holder img:last-child');
            if (target) triggerDebounce(target);
        }
    }
});

// Start Observing
cloneObserver.observe(document.body, { childList: true, subtree: true });

const bgElement = document.getElementById('bg1');
if (bgElement) {
    bgObserver.observe(bgElement, { attributes: true, attributeFilter: ['style'] });
}

// Initial Run (For page reload)
const initialImg = document.querySelector('.expression-holder img:last-child');
if (initialImg) triggerDebounce(initialImg);

console.log("✅ Chara Color Filter Loaded");

// Handle resize & virtual keyboard events (Adjust object-fit)
window.addEventListener('resize', function() {
    const height = window.innerHeight;
    if(windowHeight != height){
       canvasFit = $('#expression-image').css('object-fit');
       makeCharaFilter(currentGlobalColor, null, canvasFit, extension_settings[extensionName].blend_mode_setting);
       windowHeight = height; // Update last height
    }
});

// Load Settings logic
async function loadSettings() {
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    if (Object.keys(extension_settings[extensionName]).length === 0) {
        Object.assign(extension_settings[extensionName], defaultSettings);
    }
    
    // Update UI if exists
    $("#chara-color-filter-blend-mode").val(extension_settings[extensionName].blend_mode_setting).trigger("change");
}

// Initialize on Load
jQuery(async () => {
    const settingsHtml = await $.get(`${extensionFolderPath}/ccf_setting.html`);
    $("#extensions_settings").append(settingsHtml);

    // Event Listener for Blend Mode Dropdown
    let blendMode = $('#chara-color-filter-blend-mode');
    blendMode.on('change', function() {
        makeCharaFilter(currentGlobalColor, null, canvasFit, blendMode.find('option:selected').text());
    });
    
    loadSettings();
});
