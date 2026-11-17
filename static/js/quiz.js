/**
 * EMRS Quiz - Participant / Lab Computer Exam Interface
 * Distraction-free, responsive, auto-saving with offline reconnect resilience
 * and Anti-Cheat Window Lockdown & Fullscreen Enforcement.
 */

let attemptData = null;
let currentQuestionIndex = 0;
let timerInterval = null;
let remainingSeconds = 1200;
let isExamActive = false;
let tabSwitchCount = 0;
let lastViolationTime = 0;

function initQuiz() {
  checkAuthSession();
  setupKeyboardNavigation();
  setupSecurityLockdown();
}

// =============================================================================
// AUTHENTICATION & SESSION
// =============================================================================
async function checkAuthSession() {
  try {
    const res = await fetch("/api/auth/session");
    const data = await res.json();
    if (data.authenticated) {
      showExamScreen(data.team);
      loadQualifierAttempt();
    } else {
      showLoginScreen();
    }
  } catch (e) {
    showLoginScreen();
  }
}

async function handleLogin(event) {
  event.preventDefault();
  const form = document.getElementById("login-form");
  const code = form.team_code.value.trim().toUpperCase();
  const pin = form.team_pin.value.trim();

  const errEl = document.getElementById("login-error");
  errEl.style.display = "none";

  try {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, pin })
    });
    const data = await res.json();
    if (data.success) {
      showExamScreen(data.team);
      loadQualifierAttempt();
    } else {
      errEl.textContent = data.error || "Login failed.";
      errEl.style.display = "block";
    }
  } catch (e) {
    errEl.textContent = "Network error. Please check LAN connection to host.";
    errEl.style.display = "block";
  }
}

async function handleLogout() {
  await fetch("/api/auth/logout", { method: "POST" });
  window.location.reload();
}

function showLoginScreen() {
  isExamActive = false;
  document.getElementById("screen-login").style.display = "flex";
  document.getElementById("screen-exam").style.display = "none";
  document.getElementById("screen-submitted").style.display = "none";
}

function showExamScreen(team) {
  document.getElementById("screen-login").style.display = "none";
  document.getElementById("screen-exam").style.display = "block";
  document.getElementById("screen-submitted").style.display = "none";

  document.getElementById("header-team-name").textContent = `[${team.code}] ${team.name}`;
  document.getElementById("header-station").textContent = team.station || "Lab PC";
}

// =============================================================================
// ATTEMPT LOADING & PROGRESS
// =============================================================================
async function loadQualifierAttempt() {
  try {
    const res = await fetch("/api/qualifier/attempt");
    const data = await res.json();
    if (data.success) {
      attemptData = data.attempt;
      tabSwitchCount = attemptData.tab_switch_count || 0;

      if (attemptData.is_submitted) {
        showSubmittedScreen();
        return;
      }

      startTimer(attemptData.remaining_seconds);
      renderCurrentQuestion();
      renderPalette();

      // Show fullscreen lockdown start prompt if not already active
      if (!document.fullscreenElement && !isExamActive) {
        document.getElementById("modal-fullscreen-prompt").classList.add("active");
      } else {
        isExamActive = true;
      }
    } else {
      alert("Error loading attempt: " + data.error);
    }
  } catch (e) {
    console.error("Attempt load error", e);
  }
}

function enableFullscreenAndStart() {
  document.getElementById("modal-fullscreen-prompt").classList.remove("active");
  const el = document.documentElement;
  const requestFs = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen || el.msRequestFullscreen;

  if (requestFs) {
    requestFs.call(el).catch(() => {});
  }
  isExamActive = true;
}

function resumeExamFromLockdown() {
  document.getElementById("modal-violation-alert").classList.remove("active");
  const el = document.documentElement;
  const requestFs = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen || el.msRequestFullscreen;

  if (requestFs) {
    requestFs.call(el).catch(() => {});
  }
  setTimeout(() => {
    isExamActive = true;
  }, 300);
}

// =============================================================================
// ANTI-CHEAT & WINDOW LOCKDOWN
// =============================================================================
function setupSecurityLockdown() {
  // 1. Detect Window Blur / Focus Loss (Alt-Tab, clicking another app)
  window.addEventListener("blur", () => {
    if (isExamActive && attemptData && !attemptData.is_submitted) {
      triggerSecurityViolation("Window lost focus / Alt-tabbed");
    }
  });

  // 2. Detect Tab Switching & Window Minimization
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && isExamActive && attemptData && !attemptData.is_submitted) {
      triggerSecurityViolation("Switched browser tab or minimized window");
    }
  });

  // 3. Detect Fullscreen Exit
  document.addEventListener("fullscreenchange", () => {
    if (!document.fullscreenElement && isExamActive && attemptData && !attemptData.is_submitted) {
      triggerSecurityViolation("Exited full-screen lockdown mode");
    }
  });

  // 4. Disable Right Click Context Menu
  document.addEventListener("contextmenu", (e) => {
    if (isExamActive) {
      e.preventDefault();
    }
  });

  // 5. Disable Copy / Cut / Select
  document.addEventListener("copy", (e) => {
    if (isExamActive) e.preventDefault();
  });
  document.addEventListener("cut", (e) => {
    if (isExamActive) e.preventDefault();
  });

  // 6. Prevent Leaving Window / Navigating Away
  window.addEventListener("beforeunload", (e) => {
    if (isExamActive && attemptData && !attemptData.is_submitted) {
      e.preventDefault();
      e.returnValue = "Exam is in progress! Navigating away will submit your attempt.";
    }
  });
}

async function triggerSecurityViolation(reason) {
  const now = Date.now();
  if (now - lastViolationTime < 1800) return; // Debounce multiple rapid events
  lastViolationTime = now;
  isExamActive = false; // Temporarily suspend until student acknowledges

  tabSwitchCount++;
  const countDisplay = document.getElementById("violation-count-display");
  if (countDisplay) countDisplay.textContent = tabSwitchCount;

  // Show blocking violation modal
  const violationModal = document.getElementById("modal-violation-alert");
  if (violationModal) violationModal.classList.add("active");

  // Play warning beep
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(250, ctx.currentTime);
    osc.frequency.setValueAtTime(150, ctx.currentTime + 0.2);
    gain.gain.setValueAtTime(0.4, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.4);
  } catch (e) {}

  // Report violation to server immediately
  try {
    const res = await fetch("/api/qualifier/violation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason })
    });
    const data = await res.json();

    if (data.terminated || tabSwitchCount >= 3) {
      if (violationModal) violationModal.classList.remove("active");
      document.getElementById("modal-lockdown-terminated").classList.add("active");
      if (timerInterval) clearInterval(timerInterval);
    }
  } catch (e) {
    console.error("Violation report network error", e);
  }
}

// =============================================================================
// TIMER
// =============================================================================
function startTimer(seconds) {
  remainingSeconds = seconds;
  updateTimerUI();

  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    remainingSeconds--;
    updateTimerUI();

    if (remainingSeconds <= 0) {
      clearInterval(timerInterval);
      autoSubmitTimeout();
    }
  }, 1000);
}

function updateTimerUI() {
  const m = Math.floor(remainingSeconds / 60);
  const s = remainingSeconds % 60;
  const timerStr = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  const timerBox = document.getElementById("quiz-timer-val");
  if (timerBox) timerBox.textContent = timerStr;

  const timerContainer = document.getElementById("quiz-timer-box");
  if (timerContainer) {
    if (remainingSeconds <= 180) {
      timerContainer.classList.add("timer-warning");
    } else {
      timerContainer.classList.remove("timer-warning");
    }
  }
}

// =============================================================================
// QUESTION RENDERING & PALETTE
// =============================================================================
function renderCurrentQuestion() {
  if (!attemptData || !attemptData.questions || attemptData.questions.length === 0) return;

  const q = attemptData.questions[currentQuestionIndex];
  const total = attemptData.questions.length;

  document.getElementById("q-curr-num").textContent = `Question ${currentQuestionIndex + 1} of ${total}`;
  document.getElementById("q-curr-category").textContent = q.category || "General";
  document.getElementById("q-curr-text").textContent = q.text;

  // Media preview (Image or Audio)
  const mediaContainer = document.getElementById("q-media-container");
  if (mediaContainer) {
    mediaContainer.innerHTML = "";
    if (q.media_type === "image" && q.media_url) {
      mediaContainer.style.display = "block";
      mediaContainer.innerHTML = `<img src="${q.media_url}" alt="Question Media" style="max-height:280px; max-width:100%; border-radius:8px; border:1px solid #cbd5e1; box-shadow:0 4px 6px -1px rgba(0,0,0,0.1);">`;
    } else if (q.media_type === "audio" && q.media_url) {
      mediaContainer.style.display = "block";
      mediaContainer.innerHTML = `
        <div style="background:#f8fafc; padding:1rem; border-radius:8px; border:1px solid #cbd5e1; display:inline-block; max-width:100%; text-align:center;">
          <div style="font-size:0.85rem; font-weight:700; color:#3b82f6; margin-bottom:0.5rem;">🎵 Audio Question Clip</div>
          <audio controls src="${q.media_url}" style="width:100%; max-width:400px;"></audio>
        </div>`;
    } else {
      mediaContainer.style.display = "none";
    }
  }

  const optContainer = document.getElementById("q-options-container");
  optContainer.innerHTML = "";

  const letters = ["A", "B", "C", "D"];
  q.options.forEach((opt, displayIdx) => {
    const isSelected = q.selected_orig_idx === opt.orig_idx;

    const div = document.createElement("div");
    div.className = `option-choice ${isSelected ? 'selected' : ''}`;
    div.onclick = () => selectOption(opt.orig_idx);

    div.innerHTML = `
      <div class="option-letter">${letters[displayIdx]}</div>
      <div style="flex:1;">${opt.text}</div>
    `;
    optContainer.appendChild(div);
  });

  const reviewBtn = document.getElementById("btn-mark-review");
  if (q.is_marked_review) {
    reviewBtn.textContent = "Unmark Review";
    reviewBtn.className = "btn btn-warning";
  } else {
    reviewBtn.textContent = "Mark for Review";
    reviewBtn.className = "btn btn-secondary";
  }

  document.getElementById("btn-prev").disabled = currentQuestionIndex === 0;
  document.getElementById("btn-next").textContent = currentQuestionIndex === total - 1 ? "Review All" : "Next Question";

  renderPalette();
}

function renderPalette() {
  if (!attemptData) return;
  const grid = document.getElementById("palette-grid");
  grid.innerHTML = "";

  let answeredCount = 0;
  let reviewCount = 0;

  attemptData.questions.forEach((q, idx) => {
    const btn = document.createElement("button");
    btn.className = "palette-btn";
    btn.textContent = idx + 1;

    if (idx === currentQuestionIndex) {
      btn.classList.add("active");
    }

    if (q.is_marked_review) {
      btn.classList.add("review");
      reviewCount++;
    } else if (q.selected_orig_idx !== null && q.selected_orig_idx !== undefined) {
      btn.classList.add("answered");
      answeredCount++;
    }

    btn.onclick = () => {
      currentQuestionIndex = idx;
      renderCurrentQuestion();
    };

    grid.appendChild(btn);
  });

  const total = attemptData.questions.length;
  document.getElementById("stat-answered").textContent = answeredCount;
  document.getElementById("stat-unanswered").textContent = total - answeredCount;
  document.getElementById("stat-review").textContent = reviewCount;
}

// =============================================================================
// RESPONSE RECORDING & AUTO-SAVE
// =============================================================================
async function selectOption(origIdx) {
  const q = attemptData.questions[currentQuestionIndex];
  q.selected_orig_idx = origIdx;

  renderCurrentQuestion();
  await saveResponse(q.id, q.selected_orig_idx, q.is_marked_review);
}

async function clearSelection() {
  const q = attemptData.questions[currentQuestionIndex];
  q.selected_orig_idx = null;
  q.is_marked_review = false;

  renderCurrentQuestion();
  await saveResponse(q.id, null, false);
}

async function toggleReview() {
  const q = attemptData.questions[currentQuestionIndex];
  q.is_marked_review = !q.is_marked_review;

  renderCurrentQuestion();
  await saveResponse(q.id, q.selected_orig_idx, q.is_marked_review);
}

async function saveResponse(questionId, selectedOrigIdx, isMarkedReview) {
  try {
    const res = await fetch("/api/qualifier/answer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question_id: questionId,
        selected_orig_idx: selectedOrigIdx,
        is_marked_review: isMarkedReview
      })
    });
    const data = await res.json();
    if (!data.success) {
      console.warn("Save response warning", data.error);
    }
  } catch (e) {
    console.error("Auto-save network error", e);
  }
}

function nextQuestion() {
  if (currentQuestionIndex < attemptData.questions.length - 1) {
    currentQuestionIndex++;
    renderCurrentQuestion();
  } else {
    openSubmitModal();
  }
}

function prevQuestion() {
  if (currentQuestionIndex > 0) {
    currentQuestionIndex--;
    renderCurrentQuestion();
  }
}

// =============================================================================
// SUBMISSION & CONFIRMATION MODAL
// =============================================================================
function openSubmitModal() {
  let answered = 0;
  let review = 0;
  const total = attemptData.questions.length;

  attemptData.questions.forEach(q => {
    if (q.selected_orig_idx !== null && q.selected_orig_idx !== undefined) answered++;
    if (q.is_marked_review) review++;
  });

  document.getElementById("modal-ans-count").textContent = answered;
  document.getElementById("modal-unans-count").textContent = total - answered;
  document.getElementById("modal-rev-count").textContent = review;

  document.getElementById("modal-submit").classList.add("active");
}

function closeSubmitModal() {
  document.getElementById("modal-submit").classList.remove("active");
}

async function confirmFinalSubmit() {
  if (timerInterval) clearInterval(timerInterval);
  isExamActive = false;
  closeSubmitModal();

  try {
    const res = await fetch("/api/qualifier/submit", { method: "POST" });
    const data = await res.json();
    if (data.success) {
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      }
      showSubmittedScreen();
    } else {
      alert("Submission error: " + data.error);
    }
  } catch (e) {
    alert("Network error. Please inform the teacher/invigilator.");
  }
}

async function autoSubmitTimeout() {
  isExamActive = false;
  alert("Time has expired! Submitting your responses automatically...");
  try {
    await fetch("/api/qualifier/submit", { method: "POST" });
  } catch (e) {}
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  }
  showSubmittedScreen();
}

function showSubmittedScreen() {
  isExamActive = false;
  document.getElementById("screen-login").style.display = "none";
  document.getElementById("screen-exam").style.display = "none";
  document.getElementById("screen-submitted").style.display = "block";
}

// =============================================================================
// KEYBOARD NAVIGATION & SHORTCUT LOCKDOWN
// =============================================================================
function setupKeyboardNavigation() {
  window.addEventListener("keydown", (e) => {
    if (["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) return;
    if (!attemptData || attemptData.is_submitted) return;

    // Block developer tools and window opening combinations
    const keyUpper = e.key.toUpperCase();
    if (
      e.key === "F12" ||
      e.key === "F5" ||
      (e.ctrlKey && (keyUpper === "R" || keyUpper === "U" || keyUpper === "W" || keyUpper === "T" || keyUpper === "N")) ||
      (e.metaKey && (keyUpper === "R" || keyUpper === "U" || keyUpper === "W" || keyUpper === "T" || keyUpper === "N")) ||
      ((e.ctrlKey || e.metaKey) && e.shiftKey && keyUpper === "I")
    ) {
      e.preventDefault();
      triggerSecurityViolation(`Attempted shortcut [${e.key}]`);
      return false;
    }

    const q = attemptData.questions[currentQuestionIndex];

    if (["A", "B", "C", "D"].includes(keyUpper)) {
      const idx = ["A", "B", "C", "D"].indexOf(keyUpper);
      if (q && q.options[idx]) {
        selectOption(q.options[idx].orig_idx);
      }
    } else if (keyUpper === "N" || e.key === "ArrowRight") {
      nextQuestion();
    } else if (keyUpper === "P" || e.key === "ArrowLeft") {
      prevQuestion();
    }
  });
}

document.addEventListener("DOMContentLoaded", initQuiz);
