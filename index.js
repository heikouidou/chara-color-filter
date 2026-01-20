import { extension_settings, getContext, loadExtensionSettings } from "../../../extensions.js";

import { saveSettingsDebounced, this_chid } from "../../../../script.js";

const extensionName = "chara-color-filter";
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;
const extensionSettings = extension_settings[extensionName];
const defaultSettings = {};

// ==========================================
// 🎨 設定 & グローバル変数
// ==========================================
let currentGlobalColor = { r: 0, g: 0, b: 0 };
let updateTimer = null;
let isBgDirty = true; // 初回実行用フラグ
let windowHeight = 0;
let canvasFit = $('canvas').css('object-fit');
let charaId = undefined;
loadSettings();

// ==========================================
// 🛠️ 画像処理関数
// ==========================================

// 1. 画像URLから平均色を取得
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

// 2. フィルター(Canvas)の生成と適用
const makeCharaFilter = async (color, targetElement = null, objectFit = 'contain', blendMode = 'None') => {
    // ターゲット特定：引数優先 > 末っ子画像 > ID指定
    const targetImg = targetElement || document.querySelector('.expression-holder img:last-child') || document.getElementById('expression-image');

    if (!targetImg) return;

    // 既存のフィルター削除（掃除）
    $(targetImg.parentNode).find('.expression-filter-canvas').remove();

    const canvas = document.createElement('canvas');
    canvas.classList.add('expression-filter-canvas'); // 識別用クラス

    // 本体のスタイルをカンニング
    const computedStyle = window.getComputedStyle(targetImg);
;
    // Canvas設定
    if (blendMode == 'None' || blendMode == undefined){
        $(canvas).css({
            'mix-blend-mode': 'normal',
            'opacity': 0,
            'position': 'absolute',
            'z-index': 2147483647, // 最前面へ
            'top': 0,
            'left': 0,
            'pointer-events': 'none',
            'width': '100%',
            'height': '100%',
            // 本体の表示設定をコピー
            'max-height': computedStyle.maxHeight,
            'max-width': computedStyle.maxWidth,
            'object-fit': objectFit,
            'object-position': computedStyle.objectPosition,
            'visibility': 'visible'
        });
    }
    else {
        $(canvas).css({
            'mix-blend-mode': blendMode,
            'opacity': 0.7,
            'position': 'absolute',
            'z-index': 2147483647, // 最前面へ
            'top': 0,
            'left': 0,
            'pointer-events': 'none',
            'width': '100%',
            'height': '100%',
            // 本体の表示設定をコピー
            'max-height': computedStyle.maxHeight,
            'max-width': computedStyle.maxWidth,
            'object-fit': objectFit,
            'object-position': computedStyle.objectPosition,
            'visibility': 'visible'
        })
    }
    extension_settings[extensionName].blend_mode_setting = blendMode;
    console.log('setting:' + extension_settings[extensionName].blend_mode_setting);
    saveSettingsDebounced();
    // 親要素に追加
    targetImg.parentNode.appendChild(canvas);

    // 描画処理
    const ctx = canvas.getContext('2d');
    canvas.width = targetImg.naturalWidth || 600;
    canvas.height = targetImg.naturalHeight || 900;

    // シルエット作成 & 塗りつぶし
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(targetImg, 0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = `rgb(${color.r}, ${color.g}, ${color.b})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
}

// 3. 画像ロード待機（イベントリスナー式）
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
// ⚡️ 実行制御（司令塔）
// ==========================================
async function processFilter(targetImgNode) {
    // 背景色更新
    if (isBgDirty) {
        const targetBg = document.getElementById('bg1');
        if (targetBg) {
            const bgStyle = targetBg.style.backgroundImage;
            if (bgStyle && bgStyle !== 'none') {
                const imgUrl = bgStyle.replace(/^url\(['"]?/, '').replace(/['"]?\)$/, '');
                try {
                    currentGlobalColor = await getAverageColorFromUrl(imgUrl);
                    isBgDirty = false;
                } catch (e) { console.error("背景色取得エラー", e); }
            }
        }
    }

    // フィルター適用
    if (targetImgNode) {
        const isReady = await waitForImageLoad(targetImgNode);
        if (isReady) {
            canvasFit = $('#expression-image').css('object-fit');
            await makeCharaFilter(currentGlobalColor, targetImgNode, canvasFit, extension_settings[extensionName].blend_mode_setting);
        }
    }
}

// デバウンス処理
function triggerDebounce(node) {
    if (updateTimer) clearTimeout(updateTimer);
    updateTimer = setTimeout(() => {
        processFilter(node);
        updateTimer = null;
    }, 100);
}

// ==========================================
// 👁️ 監視設定（Observer）
// ==========================================

// 1. 立ち絵監視（クローン検知）
const cloneObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
        if (mutation.type === 'childList') {

            // ホーム画面に遷移したらフィルターも消す
            const watchTarget = { id: this_chid };
            function watchValue(obj, prop, func) {
                let value = obj[prop];
                Object.defineProperty(obj, prop, {
                    get: () => value,
                    set: newValue => {
                        const oldValue = value;
                        value = newValue;
                        func(oldValue, newValue);
                    },
                    configurable: true
                })
            };
            function isCharaChange(){
                if(this_chid != charaId){
                    if(this_chid == undefined){
                        $(".expression-filter-canvas").css('visibility', 'hidden');
                    }
                    charaId = this_chid;
                }
            }
            Object.getOwnPropertyNames(watchTarget).forEach(prop => watchValue(watchTarget, prop, isCharaChange()));
            // 立ち絵自体の変更、出現の監視
            mutation.addedNodes.forEach(node => {
                if (node.tagName === 'IMG' && node.classList.contains('expression')) {
                    triggerDebounce(node);
                }
            });
        }
    }
});

// 2. 背景監視（ID指定）
const bgObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
        if (mutation.attributeName === 'style') {
            isBgDirty = true;
            // 今表示されている最新の画像に対して適用
            const currentImg = document.getElementById('expression-image');
            // もしIDで見つからなければクローンを探す保険
            const target = currentImg || document.querySelector('.expression-holder img:last-child');
            if (target) triggerDebounce(target);
        }
    }
});

// 監視スタート
cloneObserver.observe(document.body, { childList: true, subtree: true });

const bgElement = document.getElementById('bg1');
if (bgElement) {
    bgObserver.observe(bgElement, { attributes: true, attributeFilter: ['style'] });
}

// 初回実行（リロード時用）
const initialImg = document.querySelector('.expression-holder img:last-child');
if (initialImg) triggerDebounce(initialImg);

console.log("✅ SillyTavern Expression Filter Loaded");

// 画面サイズや回転、ソフトキーボードの開閉で立ち絵のobject-fitが変わるため、それに合わせる
window.addEventListener('resize', function() {
    // 現在の表示可能領域の高さを取得
    const height = window.innerHeight;
    if(windowHeight != height){
       canvasFit = $('#expression-image').css('object-fit');
       makeCharaFilter(currentGlobalColor, null, canvasFit, extension_settings[extensionName].blend_mode_setting);
    }
});



async function loadSettings() {
  //Create the settings if they don't exist
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    if (Object.keys(extension_settings[extensionName]).length === 0) {
        Object.assign(extension_settings[extensionName], defaultSettings);
    }
    console.log('previousSetting:' + extension_settings[extensionName].blend_mode_setting);
  // Updating settings in the UI
    $("#chara-color-filter-blend-mode").val(extension_settings[extensionName].blend_mode_setting).trigger("change");
}

// This function is called when the extension is loaded
jQuery(async () => {
    const settingsHtml = await $.get(`${extensionFolderPath}/ccf_setting.html`);
    $("#extensions_settings").append(settingsHtml);

  // 設定メニューでブレンドモードが変わったとき
    let blendMode = $('#chara-color-filter-blend-mode');
    blendMode.on('change', function() {
        makeCharaFilter(currentGlobalColor, null, canvasFit, blendMode.find('option:selected').text());
    });
  loadSettings();
});
