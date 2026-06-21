// ==UserScript==
// @name         Bilibili Mini Speed Controller
// @namespace    https://www.bilibili.com/
// @version      1.0.0
// @description  在 Bilibili 视频页显示一个很小的浮动倍速面板，支持常用倍速下拉选择，并可选启用长按左键临时降速与增强右键临时倍速。
// @author       Codex
// @match        https://www.bilibili.com/video/*
// @match        https://www.bilibili.com/bangumi/play/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const STORAGE_KEY = 'tm-bilibili-mini-speed-rate';
  const POSITION_STORAGE_KEY = 'tm-bilibili-mini-speed-position';
  const PANEL_ID = 'tm-bili-mini-speed-panel';
  const FIELD_ID = 'tm-bili-mini-speed-field';
  const INPUT_ID = 'tm-bili-mini-speed-input';
  const TOGGLE_ID = 'tm-bili-mini-speed-toggle';
  const MENU_ID = 'tm-bili-mini-speed-menu';
  const LEFT_HOLD_TOGGLE_ID = 'tm-bili-mini-left-hold-toggle';
  const COMMON_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5];
  const LEFT_HOLD_DELAY_MS = 260;
  const LEFT_TAP_SEEK_SECONDS = 5;
  const LEFT_HOLD_ENABLED_STORAGE_KEY = 'tm-bilibili-mini-speed-left-hold-enabled';

  let desiredRate = readSavedRate();
  let currentVideo = null;
  let scanTimer = null;
  let syncScheduled = false;
  let isApplyingRate = false;
  let isTemporaryRateOverride = false;
  let domObserver = null;
  let leftHoldState = createLeftHoldState();
  let rightHoldState = createRightHoldState();

  function createLeftHoldState() {
    return {
      isArrowLeftDown: false,
      baseRate: null,
      targetRate: null,
      overrideActive: false,
      timerId: null,
      startedAt: 0
    };
  }

  function createRightHoldState() {
    return {
      isArrowRightDown: false,
      baseRate: null,
      targetRate: null,
      overrideActive: false
    };
  }

  function clampRate(rate) {
    const value = Number(rate);
    if (!Number.isFinite(value) || value <= 0) {
      return 1;
    }

    return Math.min(16, Math.max(0.1, value));
  }

  function formatRate(rate) {
    return clampRate(rate)
      .toFixed(2)
      .replace(/\.00$/, '')
      .replace(/(\.\d)0$/, '$1');
  }

  function readSavedRate() {
    try {
      return clampRate(window.localStorage.getItem(STORAGE_KEY) || 1);
    } catch (error) {
      console.warn('[TM Bili Speed] Failed to read saved rate:', error);
      return 1;
    }
  }

  function readLeftHoldEnabled() {
    try {
      const raw = window.localStorage.getItem(LEFT_HOLD_ENABLED_STORAGE_KEY);
      return raw === null ? false : raw === '1';
    } catch (error) {
      console.warn('[TM Bili Speed] Failed to read left hold setting:', error);
      return false;
    }
  }

  function saveLeftHoldEnabled(enabled) {
    try {
      window.localStorage.setItem(LEFT_HOLD_ENABLED_STORAGE_KEY, enabled ? '1' : '0');
    } catch (error) {
      console.warn('[TM Bili Speed] Failed to save left hold setting:', error);
    }
  }

  function saveRate(rate) {
    desiredRate = clampRate(rate);

    try {
      window.localStorage.setItem(STORAGE_KEY, String(desiredRate));
    } catch (error) {
      console.warn('[TM Bili Speed] Failed to save rate:', error);
    }
  }

  function readSavedPosition() {
    try {
      const raw = window.localStorage.getItem(POSITION_STORAGE_KEY);
      if (!raw) {
        return null;
      }

      const parsed = JSON.parse(raw);
      if (!parsed || !Number.isFinite(parsed.left) || !Number.isFinite(parsed.top)) {
        return null;
      }

      return {
        left: parsed.left,
        top: parsed.top
      };
    } catch (error) {
      console.warn('[TM Bili Speed] Failed to read saved position:', error);
      return null;
    }
  }

  function savePanelPosition(left, top) {
    try {
      window.localStorage.setItem(
        POSITION_STORAGE_KEY,
        JSON.stringify({
          left: Math.round(left),
          top: Math.round(top)
        })
      );
    } catch (error) {
      console.warn('[TM Bili Speed] Failed to save panel position:', error);
    }
  }

  function isVideoPlaying(video) {
    return Boolean(video) && !video.paused && !video.ended && video.readyState >= 2;
  }

  function isEditableTarget(target) {
    if (!(target instanceof Element)) {
      return false;
    }

    return Boolean(target.closest('input, textarea, [contenteditable=""], [contenteditable="true"]'));
  }

  function suppressNativeKeyBehavior(event) {
    event.preventDefault();
    event.stopPropagation();

    if (typeof event.stopImmediatePropagation === 'function') {
      event.stopImmediatePropagation();
    }
  }

  function getPanel() {
    return document.getElementById(PANEL_ID);
  }

  function getInput() {
    return document.getElementById(INPUT_ID);
  }

  function getField() {
    return document.getElementById(FIELD_ID);
  }

  function getToggle() {
    return document.getElementById(TOGGLE_ID);
  }

  function getMenu() {
    return document.getElementById(MENU_ID);
  }

  function getLeftHoldToggle() {
    return document.getElementById(LEFT_HOLD_TOGGLE_ID);
  }

  function injectStyle() {
    if (document.getElementById(`${PANEL_ID}-style`)) {
      return;
    }

    const style = document.createElement('style');
    style.id = `${PANEL_ID}-style`;
    style.textContent = `
      #${PANEL_ID} {
        position: fixed;
        top: 88px;
        right: 20px;
        z-index: 2147483646;
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 8px;
        border-radius: 10px;
        background: rgba(34, 34, 34, 0.88);
        border: 1px solid rgba(255, 255, 255, 0.12);
        box-shadow: 0 10px 24px rgba(0, 0, 0, 0.22);
        backdrop-filter: blur(10px);
        font: 12px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        color: #fff;
        transition: opacity 0.2s ease, background 0.2s ease;
        cursor: grab;
        touch-action: none;
      }

      #${PANEL_ID}.is-disabled {
        background: rgba(90, 90, 90, 0.72);
        color: rgba(255, 255, 255, 0.72);
      }

      #${PANEL_ID}.is-dragging {
        cursor: grabbing;
        user-select: none;
      }

      #${PANEL_ID} .tm-bili-mini-speed-label {
        white-space: nowrap;
        font-size: 11px;
        opacity: 0.92;
      }

      #${PANEL_ID} .tm-bili-mini-left-hold {
        display: flex;
        align-items: center;
        gap: 4px;
        color: #f8fafc;
        font-size: 11px;
        line-height: 1;
        white-space: nowrap;
      }

      #${PANEL_ID}.is-disabled .tm-bili-mini-left-hold {
        color: rgba(255, 255, 255, 0.72);
      }

      #${LEFT_HOLD_TOGGLE_ID} {
        width: 12px;
        height: 12px;
        margin: 0;
        accent-color: #22c55e;
      }

      #${FIELD_ID} {
        position: relative;
        width: 96px;
        height: 28px;
        border: 1px solid rgba(255, 255, 255, 0.26);
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.96);
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.42);
      }

      #${FIELD_ID}.is-disabled {
        background: rgba(255, 255, 255, 0.72);
        border-color: rgba(255, 255, 255, 0.14);
      }

      #${INPUT_ID} {
        width: 100%;
        height: 100%;
        padding: 0 28px 0 8px;
        border: none;
        border-radius: 8px;
        background: transparent;
        color: #111827;
        outline: none;
        text-align: left;
        font-size: 12px;
        font-weight: 600;
      }

      #${INPUT_ID}:disabled {
        color: #6b7280;
        cursor: not-allowed;
      }

      #${TOGGLE_ID} {
        position: absolute;
        top: 0;
        right: 0;
        width: 24px;
        height: 100%;
        padding: 0;
        border: none;
        border-left: 1px solid rgba(17, 24, 39, 0.12);
        border-radius: 0 8px 8px 0;
        background: transparent;
        color: #374151;
        cursor: pointer;
        font-size: 10px;
      }

      #${TOGGLE_ID}:disabled {
        color: #9ca3af;
        cursor: not-allowed;
      }

      #${TOGGLE_ID}:hover:not(:disabled),
      #${TOGGLE_ID}:focus-visible:not(:disabled) {
        background: rgba(17, 24, 39, 0.06);
        outline: none;
      }

      #${MENU_ID} {
        position: absolute;
        top: calc(100% + 6px);
        right: 0;
        min-width: 100%;
        padding: 4px;
        border: 1px solid rgba(17, 24, 39, 0.1);
        border-radius: 10px;
        background: rgba(255, 255, 255, 0.98);
        box-shadow: 0 12px 24px rgba(15, 23, 42, 0.18);
        display: grid;
        gap: 2px;
        z-index: 2147483647;
      }

      #${MENU_ID}[hidden] {
        display: none;
      }

      #${MENU_ID} .tm-bili-mini-speed-option {
        height: 28px;
        padding: 0 8px;
        border: none;
        border-radius: 7px;
        background: transparent;
        color: #111827;
        text-align: left;
        font-size: 12px;
        cursor: pointer;
      }

      #${MENU_ID} .tm-bili-mini-speed-option:hover,
      #${MENU_ID} .tm-bili-mini-speed-option:focus-visible {
        background: rgba(17, 24, 39, 0.08);
        outline: none;
      }

      #${MENU_ID} .tm-bili-mini-speed-option.is-active {
        background: #0f172a;
        color: #fff;
      }

      #${INPUT_ID},
      #${TOGGLE_ID} {
        cursor: auto;
      }
    `;

    document.head.appendChild(style);
  }

  function clampPanelPosition(left, top, panel) {
    const targetPanel = panel || getPanel();
    if (!targetPanel) {
      return { left, top };
    }

    const maxLeft = Math.max(8, window.innerWidth - targetPanel.offsetWidth - 8);
    const maxTop = Math.max(8, window.innerHeight - targetPanel.offsetHeight - 8);

    return {
      left: Math.min(Math.max(8, left), maxLeft),
      top: Math.min(Math.max(8, top), maxTop)
    };
  }

  function applyPanelPosition(left, top) {
    const panel = getPanel();
    if (!panel) {
      return;
    }

    const nextPosition = clampPanelPosition(left, top, panel);
    panel.style.left = `${nextPosition.left}px`;
    panel.style.top = `${nextPosition.top}px`;
    panel.style.right = 'auto';
  }

  function restorePanelPosition() {
    const panel = getPanel();
    if (!panel) {
      return;
    }

    const savedPosition = readSavedPosition();
    if (savedPosition) {
      applyPanelPosition(savedPosition.left, savedPosition.top);
      return;
    }

    const rect = panel.getBoundingClientRect();
    applyPanelPosition(rect.left, rect.top);
  }

  function bindPanelDrag(panel) {
    let dragState = null;

    panel.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) {
        return;
      }

      if (event.target instanceof Element && event.target.closest('input, button')) {
        return;
      }

      const rect = panel.getBoundingClientRect();
      dragState = {
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top,
        pointerId: event.pointerId
      };

      panel.classList.add('is-dragging');
      panel.setPointerCapture(event.pointerId);
      event.preventDefault();
    });

    panel.addEventListener('pointermove', (event) => {
      if (!dragState || event.pointerId !== dragState.pointerId) {
        return;
      }

      const left = event.clientX - dragState.offsetX;
      const top = event.clientY - dragState.offsetY;
      applyPanelPosition(left, top);
    });

    function stopDrag(event) {
      if (!dragState || event.pointerId !== dragState.pointerId) {
        return;
      }

      const rect = panel.getBoundingClientRect();
      savePanelPosition(rect.left, rect.top);
      dragState = null;
      panel.classList.remove('is-dragging');

      if (panel.hasPointerCapture(event.pointerId)) {
        panel.releasePointerCapture(event.pointerId);
      }
    }

    panel.addEventListener('pointerup', stopDrag);
    panel.addEventListener('pointercancel', stopDrag);
  }

  function createPanel() {
    if (getPanel()) {
      return;
    }

    injectStyle();

    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.className = 'is-disabled';
    panel.innerHTML = `
      <span class="tm-bili-mini-speed-label">倍速</span>
      <div id="${FIELD_ID}" class="is-disabled">
        <input id="${INPUT_ID}" type="number" min="0.1" max="16" step="0.05" disabled>
        <button id="${TOGGLE_ID}" type="button" aria-label="选择常用倍速" title="常用倍速" disabled>▼</button>
        <div id="${MENU_ID}" hidden>
          ${COMMON_RATES.map((rate) => `<button class="tm-bili-mini-speed-option" type="button" data-rate="${rate}">${formatRate(rate)}x</button>`).join('')}
        </div>
      </div>
      <label class="tm-bili-mini-left-hold" title="启用后，长按左方向键可临时降速；关闭时保留原本左键行为">
        <input id="${LEFT_HOLD_TOGGLE_ID}" type="checkbox">
        <span>左键降速</span>
      </label>
    `;

    document.body.appendChild(panel);
    restorePanelPosition();
    bindPanelDrag(panel);

    const input = getInput();
    const toggle = getToggle();
    const menu = getMenu();
    const leftHoldToggle = getLeftHoldToggle();

    if (input) {
      input.value = formatRate(desiredRate);
      input.addEventListener('input', applyInputRate);
      input.addEventListener('change', () => {
        if (!applyInputRate()) {
          updateInputValue(currentVideo ? currentVideo.playbackRate || desiredRate : desiredRate);
        }
      });
      input.addEventListener('blur', () => {
        updateInputValue(currentVideo ? currentVideo.playbackRate || desiredRate : desiredRate);
      });
    }

    if (toggle) {
      toggle.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();

        if (toggle.disabled) {
          return;
        }

        setPresetMenuOpen(menu?.hidden);
      });
    }

    if (menu) {
      updateSelectValue(desiredRate);
      menu.addEventListener('click', (event) => {
        const target = event.target instanceof Element ? event.target.closest('.tm-bili-mini-speed-option') : null;
        if (!target) {
          return;
        }

        applySelectRate(Number(target.getAttribute('data-rate')));
      });
    }

    if (leftHoldToggle) {
      leftHoldToggle.checked = readLeftHoldEnabled();
      leftHoldToggle.addEventListener('change', () => {
        saveLeftHoldEnabled(leftHoldToggle.checked);
        if (!leftHoldToggle.checked) {
          releaseLeftHold();
        }
      });
    }
  }

  function setPanelEnabled(enabled) {
    const panel = getPanel();
    const field = getField();
    const input = getInput();
    const toggle = getToggle();

    if (!panel || !field || !input || !toggle) {
      return;
    }

    panel.classList.toggle('is-disabled', !enabled);
    field.classList.toggle('is-disabled', !enabled);
    input.disabled = !enabled;
    toggle.disabled = !enabled;
    if (!enabled) {
      setPresetMenuOpen(false);
    }
    panel.title = enabled ? '修改输入框或下拉框后立即生效，按住面板可拖动' : '检测到视频播放后才可设置倍速，按住面板可拖动';
  }

  function updateInputValue(rate) {
    const input = getInput();
    if (input) {
      input.value = formatRate(rate);
    }
  }

  function updateSelectValue(rate) {
    const menu = getMenu();
    const toggle = getToggle();
    if (!menu) {
      return;
    }

    const normalizedRate = clampRate(rate);
    const matchedRate = COMMON_RATES.find((item) => Math.abs(item - normalizedRate) < 0.001);
    Array.from(menu.querySelectorAll('.tm-bili-mini-speed-option')).forEach((option) => {
      const optionRate = Number(option.getAttribute('data-rate'));
      option.classList.toggle('is-active', Boolean(matchedRate) && Math.abs(optionRate - matchedRate) < 0.001);
    });

    if (toggle) {
      toggle.title = matchedRate ? `常用倍速: ${formatRate(matchedRate)}x` : '常用倍速';
    }
  }

  function setPresetMenuOpen(open) {
    const menu = getMenu();
    if (!menu) {
      return;
    }

    menu.hidden = !open;
  }

  function getOfficialRightHoldHint() {
    return document.querySelector('.bpx-player-three-playrate-hint');
  }

  function isOfficialRightHoldActive() {
    const hint = getOfficialRightHoldHint();
    return Boolean(hint) && hint.textContent?.includes('倍速播放中');
  }

  function clearLeftHoldTimer() {
    if (leftHoldState.timerId !== null) {
      window.clearTimeout(leftHoldState.timerId);
      leftHoldState.timerId = null;
    }
  }

  function seekCurrentVideoBackward(seconds) {
    if (!currentVideo) {
      return;
    }

    const duration = Number.isFinite(currentVideo.duration) ? currentVideo.duration : null;
    const nextTime = Math.max(0, currentVideo.currentTime - seconds);
    currentVideo.currentTime = duration === null ? nextTime : Math.min(nextTime, duration);
  }

  function resetLeftHoldState() {
    clearLeftHoldTimer();
    leftHoldState = createLeftHoldState();
  }

  function resetRightHoldState() {
    rightHoldState = createRightHoldState();
  }

  function maybeStartLeftHold() {
    if (
      !readLeftHoldEnabled() ||
      !leftHoldState.isArrowLeftDown ||
      leftHoldState.overrideActive ||
      !currentVideo ||
      !isVideoPlaying(currentVideo) ||
      !Number.isFinite(leftHoldState.targetRate)
    ) {
      return;
    }

    leftHoldState.overrideActive = true;
    applyTemporaryRateOverride(currentVideo, leftHoldState.targetRate);
  }

  function releaseLeftHold() {
    const shouldRestore = leftHoldState.overrideActive && currentVideo && leftHoldState.baseRate !== null;
    const baseRate = leftHoldState.baseRate;
    const startedAt = leftHoldState.startedAt;
    resetLeftHoldState();

    if (shouldRestore) {
      applyTemporaryRateOverride(currentVideo, baseRate);
      return;
    }

    if (startedAt > 0 && performance.now() - startedAt < LEFT_HOLD_DELAY_MS) {
      seekCurrentVideoBackward(LEFT_TAP_SEEK_SECONDS);
    }
  }

  function handleArrowLeftKeyDown(event) {
    if (event.key !== 'ArrowLeft' || isEditableTarget(event.target)) {
      return;
    }

    if (!currentVideo || !readLeftHoldEnabled()) {
      return;
    }

    suppressNativeKeyBehavior(event);

    if (event.repeat || !isVideoPlaying(currentVideo)) {
      return;
    }

    const baseRate = clampRate(currentVideo.playbackRate || desiredRate);
    const delta = baseRate >= 3 ? 1 : 0.5;

    leftHoldState.isArrowLeftDown = true;
    leftHoldState.baseRate = baseRate;
    leftHoldState.targetRate = clampRate(baseRate - delta);
    leftHoldState.overrideActive = false;
    leftHoldState.startedAt = performance.now();
    clearLeftHoldTimer();
    leftHoldState.timerId = window.setTimeout(maybeStartLeftHold, LEFT_HOLD_DELAY_MS);
  }

  function handleArrowLeftKeyUp(event) {
    if (event.key !== 'ArrowLeft' || isEditableTarget(event.target)) {
      return;
    }

    if (currentVideo && readLeftHoldEnabled()) {
      suppressNativeKeyBehavior(event);
    }

    if (!readLeftHoldEnabled()) {
      return;
    }

    releaseLeftHold();
  }

  function handleArrowRightKeyDown(event) {
    if (event.key !== 'ArrowRight' || event.repeat || isEditableTarget(event.target)) {
      return;
    }

    if (!currentVideo || !isVideoPlaying(currentVideo)) {
      return;
    }

    rightHoldState.isArrowRightDown = true;
    rightHoldState.baseRate = clampRate(currentVideo.playbackRate || desiredRate);
    rightHoldState.targetRate = rightHoldState.baseRate >= 3 ? clampRate(rightHoldState.baseRate + 1) : null;
    rightHoldState.overrideActive = false;
  }

  function handleArrowRightKeyUp(event) {
    if (event.key !== 'ArrowRight') {
      return;
    }

    resetRightHoldState();
  }

  function bindGlobalKeyboard() {
    document.addEventListener('keydown', handleArrowLeftKeyDown, true);
    document.addEventListener('keyup', handleArrowLeftKeyUp, true);
    document.addEventListener('keydown', handleArrowRightKeyDown, true);
    document.addEventListener('keyup', handleArrowRightKeyUp, true);
    window.addEventListener('blur', () => {
      releaseLeftHold();
      resetRightHoldState();
    });
    document.addEventListener('pointerdown', (event) => {
      const field = getField();
      if (!field || !(event.target instanceof Element) || field.contains(event.target)) {
        return;
      }

      setPresetMenuOpen(false);
    });
  }

  function findBestVideo() {
    const videos = Array.from(document.querySelectorAll('video'));
    if (!videos.length) {
      return null;
    }

    const playingVideo = videos.find(isVideoPlaying);
    if (playingVideo) {
      return playingVideo;
    }

    const playerVideo = videos.find((video) =>
      video.closest('#bilibili-player, #playerWrap, .bpx-player-container, .bpx-player-video-area')
    );

    return playerVideo || videos[0];
  }

  function applyRateToVideo(video, rate) {
    if (!video) {
      return;
    }

    const nextRate = clampRate(rate);
    isApplyingRate = true;
    video.defaultPlaybackRate = nextRate;
    video.playbackRate = nextRate;
    saveRate(nextRate);
    updateInputValue(nextRate);
    updateSelectValue(nextRate);

    window.setTimeout(() => {
      isApplyingRate = false;
    }, 0);
  }

  function applyTemporaryRateOverride(video, rate) {
    if (!video) {
      return;
    }

    const nextRate = clampRate(rate);
    isTemporaryRateOverride = true;
    video.defaultPlaybackRate = nextRate;
    video.playbackRate = nextRate;
    updateInputValue(nextRate);
    updateSelectValue(nextRate);

    window.setTimeout(() => {
      isTemporaryRateOverride = false;
    }, 0);
  }

  function applyInputRate() {
    const input = getInput();
    if (!input || !currentVideo || !isVideoPlaying(currentVideo)) {
      return false;
    }

    const rawValue = Number(input.value);
    if (!Number.isFinite(rawValue) || rawValue <= 0) {
      return false;
    }

    applyRateToVideo(currentVideo, rawValue);
    return true;
  }

  function applySelectRate(rate) {
    if (!currentVideo || !isVideoPlaying(currentVideo)) {
      return;
    }

    setPresetMenuOpen(false);
    applyRateToVideo(currentVideo, Number(rate));
  }

  function handleVideoPlay() {
    setPanelEnabled(true);

    if (currentVideo && Math.abs(currentVideo.playbackRate - desiredRate) > 0.001) {
      applyRateToVideo(currentVideo, desiredRate);
    } else if (currentVideo) {
      updateInputValue(currentVideo.playbackRate || desiredRate);
      updateSelectValue(currentVideo.playbackRate || desiredRate);
    }
  }

  function handleVideoPause() {
    setPanelEnabled(false);
    releaseLeftHold();

    if (currentVideo) {
      updateInputValue(currentVideo.playbackRate || desiredRate);
      updateSelectValue(currentVideo.playbackRate || desiredRate);
    }
  }

  function handleVideoRateChange() {
    if (!currentVideo) {
      return;
    }

    const nextRate = clampRate(currentVideo.playbackRate || desiredRate);

    if (
      rightHoldState.isArrowRightDown &&
      rightHoldState.targetRate &&
      !rightHoldState.overrideActive &&
      Math.abs(nextRate - 3) < 0.001 &&
      isOfficialRightHoldActive()
    ) {
      rightHoldState.overrideActive = true;
      applyTemporaryRateOverride(currentVideo, rightHoldState.targetRate);
      return;
    }

    updateInputValue(nextRate);
    updateSelectValue(nextRate);

    if (!isApplyingRate && !isTemporaryRateOverride) {
      saveRate(nextRate);
    }
  }

  function detachCurrentVideo() {
    if (!currentVideo) {
      return;
    }

    releaseLeftHold();
    currentVideo.removeEventListener('play', handleVideoPlay);
    currentVideo.removeEventListener('pause', handleVideoPause);
    currentVideo.removeEventListener('ended', handleVideoPause);
    currentVideo.removeEventListener('ratechange', handleVideoRateChange);
    currentVideo = null;
  }

  function attachVideo(video) {
    if (currentVideo === video) {
      return;
    }

    detachCurrentVideo();
    currentVideo = video;

    if (!currentVideo) {
      setPanelEnabled(false);
      updateInputValue(desiredRate);
      updateSelectValue(desiredRate);
      return;
    }

    currentVideo.addEventListener('play', handleVideoPlay);
    currentVideo.addEventListener('pause', handleVideoPause);
    currentVideo.addEventListener('ended', handleVideoPause);
    currentVideo.addEventListener('ratechange', handleVideoRateChange);

    if (isVideoPlaying(currentVideo)) {
      handleVideoPlay();
    } else {
      handleVideoPause();
    }
  }

  function syncVideoState() {
    createPanel();
    attachVideo(findBestVideo());
  }

  function scheduleSync() {
    if (syncScheduled) {
      return;
    }

    syncScheduled = true;
    window.requestAnimationFrame(() => {
      syncScheduled = false;
      syncVideoState();
    });
  }

  function startObservers() {
    if (domObserver) {
      return;
    }

    domObserver = new MutationObserver(() => {
      scheduleSync();
    });

    domObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src', 'class']
    });

    scanTimer = window.setInterval(syncVideoState, 1500);
    window.addEventListener('focus', scheduleSync);
    document.addEventListener('visibilitychange', scheduleSync);
    window.addEventListener('popstate', scheduleSync);
    window.addEventListener('hashchange', scheduleSync);
  }

  function init() {
    createPanel();
    syncVideoState();
    startObservers();
    bindGlobalKeyboard();
    window.addEventListener('resize', () => {
      const panel = getPanel();
      if (!panel) {
        return;
      }

      const rect = panel.getBoundingClientRect();
      const nextPosition = clampPanelPosition(rect.left, rect.top, panel);
      applyPanelPosition(nextPosition.left, nextPosition.top);
      savePanelPosition(nextPosition.left, nextPosition.top);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
