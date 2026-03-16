/* ═══════════════════════════════════════════════════════════════
   SignLive AI — Detection Engine
   
   Handles:
   - MediaPipe Hands initialization & camera access
   - Hand landmark drawing with neon overlay
   - Gesture classification (ASL letters + common signs)
   - Real-time translation text assembly
   - Text-to-speech output
   - FPS monitoring & UI updates
   
   All processing happens locally in the browser.
   ═══════════════════════════════════════════════════════════════ */

(() => {
  'use strict';

  // ═══════════ STATE ═══════════
  const state = {
    isRunning: false,
    hands: null,
    camera: null,
    stream: null,

    // Detection
    currentGesture: null,
    currentConfidence: 0,
    lastGesture: null,
    gestureHoldCount: 0,
    gestureThreshold: 8,       // frames to hold before accepting
    lastAcceptedTime: 0,
    cooldownMs: 600,           // ms between accepted gestures

    // Translation
    translatedText: '',
    history: [],

    // TTS
    ttsEnabled: false,
    ttsQueue: [],

    // FPS
    frameCount: 0,
    lastFpsTime: performance.now(),
    fps: 0,
  };

  // ═══════════ DOM ELEMENTS ═══════════
  const el = {
    loadingOverlay:  document.getElementById('loadingOverlay'),
    videoInput:      document.getElementById('videoInput'),
    outputCanvas:    document.getElementById('outputCanvas'),
    videoPlaceholder:document.getElementById('videoPlaceholder'),
    videoContainer:  document.getElementById('videoContainer'),

    gestureLetter:   document.getElementById('gestureLetter'),
    gestureName:     document.getElementById('gestureName'),
    confidenceValue: document.getElementById('confidenceValue'),
    confidenceFill:  document.getElementById('confidenceFill'),

    translatedText:  document.getElementById('translatedText'),
    historyList:     document.getElementById('historyList'),

    startBtn:        document.getElementById('startBtn'),
    stopBtn:         document.getElementById('stopBtn'),
    clearTextBtn:    document.getElementById('clearTextBtn'),
    speakBtn:        document.getElementById('speakBtn'),
    copyBtn:         document.getElementById('copyBtn'),
    ttsToggle:       document.getElementById('ttsToggle'),
    addSpaceBtn:     document.getElementById('addSpaceBtn'),

    liveIndicator:   document.getElementById('liveIndicator'),
    modelStatus:     document.getElementById('modelStatus'),
    fpsCounter:      document.getElementById('fpsCounter'),
    toast:           document.getElementById('toast'),
  };

  const canvasCtx = el.outputCanvas.getContext('2d');

  // ═══════════ TOAST NOTIFICATIONS ═══════════
  let toastTimeout;
  function showToast(message, icon = '✅') {
    el.toast.innerHTML = `${icon} ${message}`;
    el.toast.classList.add('show');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
      el.toast.classList.remove('show');
    }, 3000);
  }

  // ═══════════ GESTURE DEFINITIONS ═══════════
  //
  // Each gesture is defined by finger states:
  // thumb, index, middle, ring, pinky
  // 1 = extended, 0 = curled
  //
  // MediaPipe Hand Landmarks:
  // 0: wrist
  // 1-4: thumb (CMC → TIP)
  // 5-8: index (MCP → TIP)
  // 9-12: middle (MCP → TIP)
  // 13-16: ring (MCP → TIP)
  // 17-20: pinky (MCP → TIP)

  const GESTURES = {
    // Common signs
    'HELLO':       { fingers: [1, 1, 1, 1, 1], label: 'Hello',        emoji: '✋', text: 'Hello' },
    'PEACE':       { fingers: [0, 1, 1, 0, 0], label: 'Peace / V',    emoji: '✌️', text: 'V' },
    'THUMBS_UP':   { fingers: [1, 0, 0, 0, 0], label: 'Thumbs Up',    emoji: '👍', text: '👍' },
    'I_LOVE_YOU':  { fingers: [1, 1, 0, 0, 1], label: 'I Love You',   emoji: '🤟', text: 'I Love You' },
    'ROCK':        { fingers: [0, 1, 0, 0, 1], label: 'Rock On',      emoji: '🤘', text: '🤘' },
    'OK':          { fingers: [-1, -1, 1, 1, 1], label: 'OK',         emoji: '👌', text: 'OK', special: 'ok' },
    'FIST':        { fingers: [0, 0, 0, 0, 0], label: 'Fist / A',     emoji: '✊', text: 'A' },
    'POINT':       { fingers: [0, 1, 0, 0, 0], label: 'Point / D',    emoji: '☝️', text: 'D' },

    // ASL Letters
    'B':           { fingers: [0, 1, 1, 1, 1], label: 'B',            emoji: '🖐', text: 'B' },
    'C':           { fingers: [-1, -1, -1, -1, -1], label: 'C',       emoji: '🤏', text: 'C', special: 'c_shape' },
    'F':           { fingers: [-1, -1, 1, 1, 1], label: 'F',          emoji: '👌', text: 'F', special: 'f_sign' },
    'I_LETTER':    { fingers: [0, 0, 0, 0, 1], label: 'I',            emoji: '🤙', text: 'I' },
    'L':           { fingers: [1, 1, 0, 0, 0], label: 'L',            emoji: '👆', text: 'L', special: 'l_shape' },
    'U':           { fingers: [0, 1, 1, 0, 0], label: 'U',            emoji: '✌️', text: 'U', special: 'u_shape' },
    'W':           { fingers: [0, 1, 1, 1, 0], label: 'W',            emoji: '🤟', text: 'W' },
    'Y':           { fingers: [1, 0, 0, 0, 1], label: 'Y',            emoji: '🤙', text: 'Y' },
  };

  // ═══════════ FINGER STATE DETECTION ═══════════

  function getFingerStates(landmarks) {
    // Returns array of 5 values: [thumb, index, middle, ring, pinky]
    // 1 = extended, 0 = curled

    const fingerStates = [];

    // --- Thumb ---
    // Compare thumb tip (4) x vs thumb IP (3) x
    // For right hand: tip.x < ip.x means extended
    // For left hand: tip.x > ip.x means extended
    // Use wrist to palm direction to determine handedness
    const wrist = landmarks[0];
    const thumbTip = landmarks[4];
    const thumbIP = landmarks[3];
    const thumbMCP = landmarks[2];
    const indexMCP = landmarks[5];

    // Determine if right or left hand based on thumb position relative to pinky
    const pinkyMCP = landmarks[17];
    const isRightHand = indexMCP.x < pinkyMCP.x; // In camera (mirrored), this is flipped

    if (isRightHand) {
      fingerStates.push(thumbTip.x < thumbIP.x ? 1 : 0);
    } else {
      fingerStates.push(thumbTip.x > thumbIP.x ? 1 : 0);
    }

    // --- Index, Middle, Ring, Pinky ---
    const fingerTips = [8, 12, 16, 20];
    const fingerPIPs = [6, 10, 14, 18];

    for (let i = 0; i < 4; i++) {
      const tip = landmarks[fingerTips[i]];
      const pip = landmarks[fingerPIPs[i]];
      // Finger is extended if tip.y < pip.y (higher on screen = lower y value)
      fingerStates.push(tip.y < pip.y ? 1 : 0);
    }

    return fingerStates;
  }

  function getDistance(a, b) {
    return Math.sqrt(
      (a.x - b.x) ** 2 +
      (a.y - b.y) ** 2 +
      ((a.z || 0) - (b.z || 0)) ** 2
    );
  }

  // ═══════════ GESTURE CLASSIFICATION ═══════════

  function classifyGesture(landmarks) {
    const fingers = getFingerStates(landmarks);
    let bestMatch = null;
    let bestScore = -1;

    // Special gesture checks first
    const thumbTip = landmarks[4];
    const indexTip = landmarks[8];
    const middleTip = landmarks[12];
    const thumbIndexDist = getDistance(thumbTip, indexTip);

    // OK sign: thumb and index tips touching, other fingers extended
    if (thumbIndexDist < 0.06 && fingers[2] === 1 && fingers[3] === 1 && fingers[4] === 1) {
      return { gesture: GESTURES['OK'], confidence: 0.9 };
    }

    // F sign: like OK but specifically
    if (thumbIndexDist < 0.06 && fingers[2] === 1 && fingers[3] === 1 && fingers[4] === 1) {
      return { gesture: GESTURES['F'], confidence: 0.85 };
    }

    // L shape: thumb and index extended at roughly 90 degrees
    if (fingers[0] === 1 && fingers[1] === 1 && fingers[2] === 0 && fingers[3] === 0 && fingers[4] === 0) {
      const thumbMCP = landmarks[2];
      const indexMCP = landmarks[5];
      const angle = Math.abs(Math.atan2(thumbTip.y - thumbMCP.y, thumbTip.x - thumbMCP.x) -
                              Math.atan2(indexTip.y - indexMCP.y, indexTip.x - indexMCP.x));
      if (angle > 0.8 && angle < 2.4) {
        return { gesture: GESTURES['L'], confidence: 0.88 };
      }
    }

    // U vs Peace: U has fingers together, Peace has them spread
    if (fingers[0] === 0 && fingers[1] === 1 && fingers[2] === 1 && fingers[3] === 0 && fingers[4] === 0) {
      const indexMiddleDist = getDistance(indexTip, middleTip);
      if (indexMiddleDist < 0.06) {
        return { gesture: GESTURES['U'], confidence: 0.85 };
      } else {
        return { gesture: GESTURES['PEACE'], confidence: 0.9 };
      }
    }

    // Standard finger-state matching
    for (const [key, gesture] of Object.entries(GESTURES)) {
      if (gesture.special) continue; // Skip special gestures (handled above)

      let score = 0;
      let total = 0;

      for (let i = 0; i < 5; i++) {
        if (gesture.fingers[i] === -1) continue; // wildcard
        total++;
        if (fingers[i] === gesture.fingers[i]) {
          score++;
        }
      }

      const matchRatio = total > 0 ? score / total : 0;

      if (matchRatio > bestScore && matchRatio >= 0.8) {
        bestScore = matchRatio;
        bestMatch = gesture;
      }
    }

    if (bestMatch) {
      // Map score to confidence
      const confidence = 0.7 + (bestScore * 0.25);
      return { gesture: bestMatch, confidence: Math.min(confidence, 0.98) };
    }

    return null;
  }

  // ═══════════ DRAWING UTILITIES ═══════════

  const HAND_CONNECTIONS = [
    [0, 1], [1, 2], [2, 3], [3, 4],       // Thumb
    [0, 5], [5, 6], [6, 7], [7, 8],       // Index
    [0, 9], [9, 10], [10, 11], [11, 12],   // Middle
    [0, 13], [13, 14], [14, 15], [15, 16], // Ring
    [0, 17], [17, 18], [18, 19], [19, 20], // Pinky
    [5, 9], [9, 13], [13, 17],             // Palm
  ];

  function drawHandLandmarks(landmarks, width, height) {
    // Draw connections with neon glow
    canvasCtx.strokeStyle = 'rgba(0, 212, 255, 0.6)';
    canvasCtx.lineWidth = 2.5;
    canvasCtx.shadowColor = '#00d4ff';
    canvasCtx.shadowBlur = 12;

    for (const [startIdx, endIdx] of HAND_CONNECTIONS) {
      const start = landmarks[startIdx];
      const end = landmarks[endIdx];
      canvasCtx.beginPath();
      canvasCtx.moveTo(start.x * width, start.y * height);
      canvasCtx.lineTo(end.x * width, end.y * height);
      canvasCtx.stroke();
    }

    // Draw landmarks
    for (let i = 0; i < landmarks.length; i++) {
      const lm = landmarks[i];
      const x = lm.x * width;
      const y = lm.y * height;

      // Fingertips get special treatment
      const isFingertip = [4, 8, 12, 16, 20].includes(i);
      const isWrist = i === 0;

      const radius = isFingertip ? 7 : (isWrist ? 6 : 4);
      const color = isFingertip ? '#00ff88' : (isWrist ? '#7c3aed' : '#00d4ff');

      // Glow circle
      canvasCtx.shadowColor = color;
      canvasCtx.shadowBlur = 15;
      canvasCtx.fillStyle = color;
      canvasCtx.beginPath();
      canvasCtx.arc(x, y, radius, 0, 2 * Math.PI);
      canvasCtx.fill();

      // Inner dot
      canvasCtx.shadowBlur = 0;
      canvasCtx.fillStyle = '#ffffff';
      canvasCtx.beginPath();
      canvasCtx.arc(x, y, radius * 0.4, 0, 2 * Math.PI);
      canvasCtx.fill();
    }

    // Reset shadow
    canvasCtx.shadowBlur = 0;
  }

  function drawGestureLabel(gesture, confidence, width, height) {
    if (!gesture) return;

    const text = `${gesture.emoji} ${gesture.label}`;
    const confText = `${Math.round(confidence * 100)}%`;

    // Background pill
    canvasCtx.font = 'bold 18px "Outfit", sans-serif';
    const textWidth = canvasCtx.measureText(text).width;
    const confWidth = canvasCtx.measureText(confText).width;
    const totalWidth = textWidth + confWidth + 40;

    const x = 16;
    const y = 16;
    const h = 44;

    canvasCtx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    canvasCtx.beginPath();
    canvasCtx.roundRect(x, y, totalWidth, h, 12);
    canvasCtx.fill();

    canvasCtx.strokeStyle = 'rgba(0, 212, 255, 0.4)';
    canvasCtx.lineWidth = 1;
    canvasCtx.beginPath();
    canvasCtx.roundRect(x, y, totalWidth, h, 12);
    canvasCtx.stroke();

    // Gesture text
    canvasCtx.fillStyle = '#ffffff';
    canvasCtx.fillText(text, x + 14, y + 29);

    // Confidence
    canvasCtx.fillStyle = '#00ff88';
    canvasCtx.font = '600 14px "JetBrains Mono", monospace';
    canvasCtx.fillText(confText, x + textWidth + 26, y + 29);
  }

  // ═══════════ MEDIAPIPE INITIALIZATION ═══════════

  async function initMediaPipe() {
    el.modelStatus.textContent = 'Model: Loading…';

    state.hands = new Hands({
      locateFile: (file) => {
        return `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/${file}`;
      }
    });

    state.hands.setOptions({
      maxNumHands: 1,
      modelComplexity: 1,
      minDetectionConfidence: 0.7,
      minTrackingConfidence: 0.5,
    });

    state.hands.onResults(onResults);

    try {
      await state.hands.initialize();
      el.modelStatus.textContent = 'Model: Ready ✓';
      el.modelStatus.style.color = '#00ff88';
      showToast('AI model loaded successfully!', '🤖');
    } catch (err) {
      console.error('MediaPipe init error:', err);
      el.modelStatus.textContent = 'Model: Error ✗';
      el.modelStatus.style.color = '#ff4444';
      showToast('Failed to load AI model. Check your connection.', '❌');
    }

    // Hide loading overlay
    if (el.loadingOverlay) {
      el.loadingOverlay.classList.add('hidden');
    }
  }

  // ═══════════ RESULTS HANDLER ═══════════

  function onResults(results) {
    const width = el.outputCanvas.width;
    const height = el.outputCanvas.height;

    // Clear canvas
    canvasCtx.clearRect(0, 0, width, height);

    // Draw camera frame
    canvasCtx.drawImage(results.image, 0, 0, width, height);

    // Slight dark overlay for better landmark visibility
    canvasCtx.fillStyle = 'rgba(0, 0, 0, 0.15)';
    canvasCtx.fillRect(0, 0, width, height);

    // FPS counting
    state.frameCount++;
    const now = performance.now();
    if (now - state.lastFpsTime >= 1000) {
      state.fps = state.frameCount;
      state.frameCount = 0;
      state.lastFpsTime = now;
      el.fpsCounter.textContent = `${state.fps} FPS`;
    }

    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
      const landmarks = results.multiHandLandmarks[0];

      // Draw hand
      drawHandLandmarks(landmarks, width, height);

      // Classify gesture
      const result = classifyGesture(landmarks);

      if (result) {
        drawGestureLabel(result.gesture, result.confidence, width, height);
        processGestureResult(result.gesture, result.confidence);
      } else {
        clearCurrentGesture();
      }
    } else {
      clearCurrentGesture();
    }
  }

  // ═══════════ GESTURE PROCESSING ═══════════

  function processGestureResult(gesture, confidence) {
    // Update UI
    el.gestureLetter.textContent = gesture.emoji;
    el.gestureLetter.style.color = '#00d4ff';
    el.gestureName.textContent = gesture.label;
    el.confidenceValue.textContent = `${Math.round(confidence * 100)}%`;
    el.confidenceFill.style.width = `${Math.round(confidence * 100)}%`;

    // Gesture stability check
    if (gesture.label === state.lastGesture) {
      state.gestureHoldCount++;
    } else {
      state.gestureHoldCount = 0;
      state.lastGesture = gesture.label;
    }

    // Accept gesture if held long enough
    const now = Date.now();
    if (state.gestureHoldCount >= state.gestureThreshold && 
        now - state.lastAcceptedTime > state.cooldownMs) {
      acceptGesture(gesture, confidence);
      state.gestureHoldCount = 0;
      state.lastAcceptedTime = now;
    }
  }

  function acceptGesture(gesture, confidence) {
    // Add to translated text
    state.translatedText += gesture.text;
    updateTranslatedText();

    // Add to history
    addToHistory(gesture, confidence);

    // TTS
    if (state.ttsEnabled && gesture.text.length > 1) {
      speak(gesture.text);
    }

    // Visual feedback - pulse the gesture letter
    el.gestureLetter.style.transform = 'scale(1.3)';
    el.gestureLetter.style.color = '#00ff88';
    setTimeout(() => {
      el.gestureLetter.style.transform = 'scale(1)';
      el.gestureLetter.style.color = '#00d4ff';
    }, 300);
  }

  function clearCurrentGesture() {
    state.gestureHoldCount = 0;
    el.gestureLetter.textContent = '—';
    el.gestureLetter.style.color = 'var(--text-muted)';
    el.gestureName.textContent = 'No hand detected';
    el.confidenceValue.textContent = '0%';
    el.confidenceFill.style.width = '0%';
  }

  // ═══════════ TRANSLATION ═══════════

  function updateTranslatedText() {
    el.translatedText.innerHTML = state.translatedText + '<span class="cursor-blink"></span>';
  }

  function addToHistory(gesture, confidence) {
    const entry = {
      gesture: gesture.label,
      emoji: gesture.emoji,
      text: gesture.text,
      confidence: Math.round(confidence * 100),
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    };

    state.history.unshift(entry);
    if (state.history.length > 20) state.history.pop();

    renderHistory();
  }

  function renderHistory() {
    if (state.history.length === 0) {
      el.historyList.innerHTML = '<div class="history-item" style="color: var(--text-muted); justify-content: center;">No detections yet</div>';
      return;
    }

    el.historyList.innerHTML = state.history.slice(0, 10).map(item => `
      <div class="history-item">
        <span class="history-gesture">${item.emoji} ${item.gesture}</span>
        <span class="history-time">${item.confidence}% • ${item.time}</span>
      </div>
    `).join('');
  }

  // ═══════════ TEXT-TO-SPEECH ═══════════

  function speak(text) {
    if (!('speechSynthesis' in window)) return;

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.9;
    utterance.pitch = 1;
    utterance.volume = 0.8;
    utterance.lang = 'en-US';
    window.speechSynthesis.speak(utterance);
  }

  // ═══════════ CAMERA CONTROL ═══════════

  async function startDetection() {
    try {
      // Request camera
      state.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'user',
        },
        audio: false,
      });

      el.videoInput.srcObject = state.stream;
      await el.videoInput.play();

      // Match canvas size to video
      el.outputCanvas.width = el.videoInput.videoWidth || 1280;
      el.outputCanvas.height = el.videoInput.videoHeight || 720;

      // Hide placeholder
      el.videoPlaceholder.classList.add('hidden');

      // Start detection loop
      state.isRunning = true;
      el.liveIndicator.style.opacity = '1';
      el.startBtn.classList.add('hidden');
      el.stopBtn.classList.remove('hidden');

      showToast('Camera started! Show your hand gestures.', '📷');

      // Start sending frames to MediaPipe
      detectFrame();

    } catch (err) {
      console.error('Camera error:', err);
      showToast('Camera access denied. Please allow camera access.', '❌');
    }
  }

  async function detectFrame() {
    if (!state.isRunning) return;

    try {
      await state.hands.send({ image: el.videoInput });
    } catch (err) {
      console.error('Detection error:', err);
    }

    if (state.isRunning) {
      requestAnimationFrame(detectFrame);
    }
  }

  function stopDetection() {
    state.isRunning = false;

    // Stop camera
    if (state.stream) {
      state.stream.getTracks().forEach(track => track.stop());
      state.stream = null;
    }

    el.videoInput.srcObject = null;

    // Clear canvas
    canvasCtx.clearRect(0, 0, el.outputCanvas.width, el.outputCanvas.height);

    // Show placeholder
    el.videoPlaceholder.classList.remove('hidden');

    // Update UI
    el.liveIndicator.style.opacity = '0.4';
    el.startBtn.classList.remove('hidden');
    el.stopBtn.classList.add('hidden');
    el.fpsCounter.textContent = '0 FPS';

    clearCurrentGesture();
    showToast('Detection stopped.', '⏹');
  }

  // ═══════════ EVENT LISTENERS ═══════════

  // Start / Stop
  el.startBtn.addEventListener('click', startDetection);
  el.stopBtn.addEventListener('click', stopDetection);

  // Clear text
  el.clearTextBtn.addEventListener('click', () => {
    state.translatedText = '';
    updateTranslatedText();
    showToast('Text cleared.', '🗑️');
  });

  // Add space
  el.addSpaceBtn.addEventListener('click', () => {
    state.translatedText += ' ';
    updateTranslatedText();
  });

  // Speak button
  el.speakBtn.addEventListener('click', () => {
    if (state.translatedText.trim()) {
      speak(state.translatedText);
      showToast('Speaking…', '🔊');
    } else {
      showToast('No text to speak.', '🔇');
    }
  });

  // Copy button
  el.copyBtn.addEventListener('click', async () => {
    if (state.translatedText.trim()) {
      try {
        await navigator.clipboard.writeText(state.translatedText);
        showToast('Copied to clipboard!', '📋');
      } catch {
        showToast('Failed to copy.', '❌');
      }
    } else {
      showToast('No text to copy.', '📋');
    }
  });

  // TTS toggle
  el.ttsToggle.addEventListener('click', () => {
    state.ttsEnabled = !state.ttsEnabled;
    el.ttsToggle.classList.toggle('active', state.ttsEnabled);
    el.ttsToggle.innerHTML = state.ttsEnabled
      ? '🔊 Auto-Speak: On'
      : '🔇 Auto-Speak: Off';
    showToast(state.ttsEnabled ? 'Auto-speak enabled' : 'Auto-speak disabled', '🔊');
  });

  // Mobile hamburger
  const hamburger = document.getElementById('navHamburger');
  const navLinks = document.getElementById('navLinks');
  if (hamburger && navLinks) {
    hamburger.addEventListener('click', () => {
      hamburger.classList.toggle('active');
      navLinks.classList.toggle('open');
    });
  }

  // ═══════════ CANVAS RESIZE ═══════════
  function resizeCanvas() {
    const container = el.videoContainer;
    if (el.videoInput.videoWidth) {
      el.outputCanvas.width = el.videoInput.videoWidth;
      el.outputCanvas.height = el.videoInput.videoHeight;
    }
  }

  window.addEventListener('resize', resizeCanvas);
  el.videoInput.addEventListener('loadedmetadata', resizeCanvas);

  // ═══════════ INIT ═══════════
  initMediaPipe();
})();
