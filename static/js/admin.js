/**
 * EMRS Quiz - Host / Quiz Master Admin Console Controller
 * Comprehensive competition setup, question bank, qualifier monitor & final round console.
 */

let ws = null;
let currentFinalState = null;

function initAdmin() {
  setupTabs();
  connectWebSocket();
  setupKeyboardShortcuts();
  loadFinalRoundState();
  loadQualifierLeaderboard();
  loadQuestions();
  loadTeams();
  loadAuditLog();
}

// =============================================================================
// WEBSOCKET & REALTIME
// =============================================================================
function connectWebSocket() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${protocol}//${window.location.host}/ws`;

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    document.getElementById("admin-ws-status").textContent = "ONLINE (LAN)";
    document.getElementById("admin-ws-status").className = "badge badge-green";
  };

  ws.onclose = () => {
    document.getElementById("admin-ws-status").textContent = "DISCONNECTED";
    document.getElementById("admin-ws-status").className = "badge badge-red";
    setTimeout(connectWebSocket, 2000);
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === "FINAL_STATE_UPDATE" || msg.type === "INIT_STATE") {
        currentFinalState = msg.data || msg.final_state;
        renderFinalConsole(currentFinalState);

        if (msg.event === "TIME_EXPIRED" && currentFinalState && currentFinalState.question_status === "in_progress") {
          const passHist = currentFinalState.pass_history || [];
          const maxPasses = currentFinalState.max_passes || 2;
          const passingOrder = (currentFinalState.passing_order || []).slice(0, maxPasses);
          const attempted = new Set(passHist.map(h => h.slot));
          attempted.add(currentFinalState.active_team_slot);
          const nextSlot = passingOrder.find(s => !attempted.has(s));

          const finalistsMap = {};
          (currentFinalState.finalists || []).forEach(f => { finalistsMap[f.finalist_slot] = f; });
          const currTeam = finalistsMap[currentFinalState.active_team_slot];
          const currName = currTeam ? `[T${currentFinalState.active_team_slot}] ${currTeam.name}` : `Team ${currentFinalState.active_team_slot}`;

          if (nextSlot !== undefined) {
            const nextTeam = finalistsMap[nextSlot];
            const nextName = nextTeam ? `[T${nextSlot}] ${nextTeam.name}` : `Team ${nextSlot}`;
            const nextPassNum = passHist.length + 1;
            const nextMarks = nextPassNum === 1 ? 5 : 2;
            alert(`⏱️ TIME'S UP!\n\nTime expired for ${currName}!\nQuestion is passed to ${nextName} (Pass ${nextPassNum}/2 • ${nextMarks} Marks). Click OK to pass.`);
            adjudicate("timeout_or_pass");
          } else {
            alert(`⏱️ TIME'S UP!\n\nTime expired for ${currName}!\nAll passes exhausted. Question will end with 0 marks.`);
            adjudicate("timeout_or_pass");
          }
        }
      } else if (msg.type === "TIMER_TICK") {
        updateAdminTimer(msg.time_remaining);
      } else if (msg.type === "QUALIFIER_PROGRESS" || msg.type === "QUALIFIER_SUBMITTED") {
        renderQualifierLeaderboard(msg.leaderboard);
      } else if (msg.type === "QUALIFIER_VIOLATION") {
        renderQualifierLeaderboard(msg.leaderboard);
        showAdminSecurityAlert(msg);
      } else if (msg.type === "FINALISTS_PROMOTED") {
        currentFinalState = msg.final_state;
        renderFinalConsole(currentFinalState);
        loadQualifierLeaderboard();
      }
    } catch (e) {
      console.error("WS error:", e);
    }
  };
}

// =============================================================================
// TABS NAVIGATION
// =============================================================================
function switchAdminTab(targetId) {
  const tabButtons = document.querySelectorAll(".tab-btn");
  tabButtons.forEach(b => {
    if (b.getAttribute("data-tab") === targetId) {
      b.classList.add("active");
    } else {
      b.classList.remove("active");
    }
  });

  document.querySelectorAll(".tab-content").forEach(tc => {
    if (tc.id === targetId) {
      tc.classList.add("active");
    } else {
      tc.classList.remove("active");
    }
  });

  if (targetId === "tab-final") loadFinalRoundState();
  if (targetId === "tab-qualifier") loadQualifierLeaderboard();
  if (targetId === "tab-questions") loadQuestions();
  if (targetId === "tab-teams") loadTeams();
  if (targetId === "tab-audit") loadAuditLog();
}

function setupTabs() {
  const tabButtons = document.querySelectorAll(".tab-btn");
  tabButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      const targetId = btn.getAttribute("data-tab");
      switchAdminTab(targetId);
    });
  });

  // Check URL hash for direct tab access, e.g. #questions or #tab-questions
  const hash = (window.location.hash || "").replace("#", "").toLowerCase();
  if (hash === "questions" || hash === "tab-questions" || hash === "question-bank") {
    switchAdminTab("tab-questions");
  }
}

// =============================================================================
// FINAL ROUND HOST CONSOLE
// =============================================================================
let consoleProjectorQuestions = [];

async function populateConsoleQuestionJump() {
  const jumpSelect = document.getElementById("console-jump-question");
  const catSelect = document.getElementById("console-filter-category");
  if (!jumpSelect) return;

  if (consoleProjectorQuestions.length === 0) {
    try {
      const res = await fetch("/api/admin/questions?pool=projector");
      const data = await res.json();
      consoleProjectorQuestions = data.questions || [];
    } catch (e) {
      console.error("Failed loading projector questions for console jump", e);
    }
  }

  const selectedCat = catSelect ? (catSelect.value || "").toLowerCase() : "";
  jumpSelect.innerHTML = "<option value=''>Jump to Question...</option>";

  consoleProjectorQuestions.forEach((q, idx) => {
    const cat = (q.category || "").toLowerCase();
    const media = (q.media_type || "").toLowerCase();
    let match = true;

    if (selectedCat) {
      if (selectedCat === "audio") match = media === "audio" || cat.includes("audio");
      else if (selectedCat === "visual") match = media === "image" || cat.includes("visual") || cat.includes("image");
      else if (selectedCat.includes("culture")) match = cat.includes("culture");
      else if (selectedCat.includes("heritage")) match = cat.includes("heritage");
      else if (selectedCat.includes("tribal")) match = cat.includes("tribal");
      else match = cat.includes(selectedCat);
    }

    if (match) {
      const opt = document.createElement("option");
      opt.value = idx;
      const preview = q.text.length > 40 ? q.text.substring(0, 40) + "..." : q.text;
      const completedInfo = (currentFinalState && currentFinalState.completed_questions) ? currentFinalState.completed_questions[idx] : null;
      if (completedInfo) {
        const markText = completedInfo.winning_team_slot ? `+${completedInfo.awarded_marks}pts` : `0pts`;
        opt.textContent = `[🔒 ${markText}] Q${idx + 1} [${q.category || 'General'}]: ${preview}`;
      } else {
        opt.textContent = `Q${idx + 1} [${q.category || 'General'}]: ${preview}`;
      }
      if (currentFinalState && currentFinalState.question_index === idx) {
        opt.selected = true;
      }
      jumpSelect.appendChild(opt);
    }
  });
}

function onConsoleCategoryFilter(cat) {
  populateConsoleQuestionJump();
}

async function onConsoleQuestionJump(qIdxStr) {
  if (qIdxStr === "" || qIdxStr === undefined) return;
  const newIdx = parseInt(qIdxStr);
  try {
    const res = await fetch("/api/admin/final/load_question", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question_index: newIdx })
    });
    const data = await res.json();
    if (data.success) {
      currentFinalState = data.state;
      renderFinalConsole(currentFinalState);
    }
  } catch (e) {
    console.error("Jump error", e);
  }
}

async function loadAdminRound(roundNumber) {
  try {
    const res = await fetch("/api/admin/final/load_round", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ round_number: parseInt(roundNumber) })
    });
    const data = await res.json();
    if (data.success && data.state) {
      currentFinalState = data.state;
      renderFinalConsole(currentFinalState);
      populateConsoleQuestionJump();
    }
  } catch (e) {
    console.error("Admin load round error", e);
  }
}

async function loadFinalRoundState() {
  try {
    const res = await fetch("/api/admin/final/state");
    const data = await res.json();
    currentFinalState = data.state;
    renderFinalConsole(currentFinalState);
    populateConsoleQuestionJump();
  } catch (e) {
    console.error("Failed to load final round state", e);
  }
}

function renderFinalConsole(state) {
  if (!state) return;

  const q = state.question;
  const activeSlot = state.active_team_slot;
  const firstSlot = state.first_team_slot;
  const finalists = state.finalists || [];
  const status = state.question_status;
  const passHistory = state.pass_history || [];

  // 1. Update 5 Competition Round Buttons
  const currentRound = state.current_round;
  const currentRoundNum = currentRound ? currentRound.round_number : 1;
  for (let r = 1; r <= 5; r++) {
    const btn = document.getElementById(`btn-admin-round-${r}`);
    if (btn) {
      if (r === currentRoundNum) {
        btn.className = "btn btn-primary admin-round-btn";
        btn.style.boxShadow = `0 0 10px rgba(56, 189, 248, 0.4)`;
      } else {
        btn.className = "btn btn-secondary admin-round-btn";
        btn.style.boxShadow = "none";
      }
    }
  }

  // Question metadata
  if (q) {
    const roundName = q.round_name || (currentRound ? currentRound.name : "Indian Culture");
    const roundNum = q.round_number || currentRoundNum;
    const roundQIdx = q.round_question_index || q.question_number;
    const roundTotalQ = q.round_total_questions || 6;

    document.getElementById("console-q-title").textContent = `ROUND ${roundNum}: ${roundName.toUpperCase()} • Q${roundQIdx}/${roundTotalQ} (Overall Q${q.question_number}/${state.total_questions})`;
    document.getElementById("console-q-text").textContent = q.text;

    // Projector Screen Visibility Indicator & Controls
    const visStatusEl = document.getElementById("console-visibility-status");
    const showBtn = document.getElementById("btn-show-question");
    const showOptsBtn = document.getElementById("btn-show-options");
    const hideBtn = document.getElementById("btn-hide-question");
    const isMediaQ = Boolean(state.is_media_question || q.is_media_question);
    const isOptsVis = state.is_options_visible !== undefined ? Boolean(state.is_options_visible) : Boolean(state.is_question_visible);
    const isEnded = status === "ended" || Boolean(state.is_locked);
    const lockInfo = state.lock_info || {};

    // Host Console Locked Question Banner
    const lockedBanner = document.getElementById("console-locked-status-banner");
    const lockedDesc = document.getElementById("console-locked-desc");

    if (isEnded && lockedBanner) {
      lockedBanner.style.display = "flex";
      const winSlot = lockInfo.winning_team_slot || state.winning_team_slot;
      const finalistsMap = {};
      finalists.forEach(f => { finalistsMap[f.finalist_slot] = f; });
      const winTeam = winSlot ? finalistsMap[winSlot] : null;
      const winName = lockInfo.winning_team_name || (winTeam ? winTeam.name : (winSlot ? `Team ${winSlot}` : null));
      const marks = (lockInfo.awarded_marks !== undefined && lockInfo.awarded_marks !== null)
        ? lockInfo.awarded_marks
        : (state.current_marks || 0);

      if (winSlot) {
        lockedBanner.style.borderColor = "#10b981";
        if (lockedDesc) {
          lockedDesc.innerHTML = `<span style="color:#34d399; font-weight:800;">+${marks} Marks</span> awarded to <strong>[T${winSlot}] ${winName}</strong> (Projector Screen Locked)`;
        }
      } else {
        lockedBanner.style.borderColor = "#ef4444";
        if (lockedDesc) {
          lockedDesc.innerHTML = `<span style="color:#f87171; font-weight:800;">Question Ended (0 Marks)</span> &bull; 2 Passes exhausted (Projector Screen Locked)`;
        }
      }
    } else if (lockedBanner) {
      lockedBanner.style.display = "none";
    }

    if (isEnded) {
      if (visStatusEl) {
        visStatusEl.innerHTML = `<span style="color:#10b981;">🔒 QUESTION COMPLETED &amp; LOCKED</span> <span style="font-size:0.8rem; color:#94a3b8; font-weight:500;">(Outcome recorded &bull; Answering disabled on stage)</span>`;
      }
      if (showBtn) {
        showBtn.style.display = "inline-block";
        showBtn.textContent = "🔒 Question Locked";
        showBtn.className = "btn btn-secondary";
        showBtn.style.boxShadow = "none";
        showBtn.disabled = true;
      }
      if (showOptsBtn) showOptsBtn.style.display = "none";
      if (hideBtn) hideBtn.style.display = "none";
    } else if (state.is_question_visible && !isOptsVis) {
      if (visStatusEl) {
        visStatusEl.innerHTML = `<span style="color:#f59e0b;">🎬 MEDIA &amp; QUESTION SHOWN</span> <span style="font-size:0.8rem; color:#94a3b8; font-weight:500;">(Options hidden • Timer paused until options are revealed)</span>`;
      }
      if (showBtn) {
        showBtn.style.display = "none";
      }
      if (showOptsBtn) {
        showOptsBtn.style.display = "inline-block";
      }
      if (hideBtn) hideBtn.style.display = "inline-block";
    } else if (state.is_question_visible) {
      if (visStatusEl) {
        visStatusEl.innerHTML = `<span style="color:#10b981;">🟢 LIVE ON PROJECTOR SCREEN</span> <span style="font-size:0.8rem; color:#94a3b8; font-weight:500;">(Visible to Auditorium &amp; Timer Active)</span>`;
      }
      if (showBtn) {
        showBtn.style.display = "inline-block";
        showBtn.textContent = "👁️ Question Revealed on Stage";
        showBtn.className = "btn btn-secondary";
        showBtn.style.boxShadow = "none";
        showBtn.disabled = true;
      }
      if (showOptsBtn) showOptsBtn.style.display = "none";
      if (hideBtn) hideBtn.style.display = "inline-block";
    } else {
      if (visStatusEl) {
        visStatusEl.innerHTML = `<span style="color:#f59e0b;">🔒 HIDDEN ON PROJECTOR SCREEN</span> <span style="font-size:0.8rem; color:#94a3b8; font-weight:500;">(Auditorium waiting for question reveal)</span>`;
      }
      if (showBtn) {
        showBtn.style.display = "inline-block";
        showBtn.textContent = isMediaQ
          ? "👁️ Show Media & Question First [S]"
          : "👁️ Show Question on Screen (Starts 60s Timer) [S]";
        showBtn.className = "btn btn-success";
        showBtn.style.boxShadow = "0 0 15px rgba(16, 185, 129, 0.4)";
        showBtn.disabled = false;
      }
      if (showOptsBtn) showOptsBtn.style.display = "none";
      if (hideBtn) hideBtn.style.display = "none";
    }

    // Render Question Media preview in Host Console (Image or Audio with Remote Control)
    const mediaPreview = document.getElementById("console-q-media-preview");
    if (mediaPreview) {
      if (q.media_type === "image" && q.media_url) {
        mediaPreview.style.display = "block";
        mediaPreview.innerHTML = `
          <div style="background:#0f172a; padding:0.6rem; border-radius:6px; border:1px solid #334155; margin-bottom:0.75rem; text-align:center;">
            <span class="badge badge-purple" style="margin-bottom:0.35rem; display:inline-block;">&#128444;&#65039; Image-Based Question</span>
            <div><img src="${q.media_url}" style="max-height:160px; max-width:100%; border-radius:4px; object-fit:contain;"></div>
          </div>
        `;
      } else if (q.media_type === "audio" && q.media_url) {
        mediaPreview.style.display = "block";
        mediaPreview.innerHTML = `
          <div style="background:#0f172a; padding:0.75rem; border-radius:6px; border:1px solid #f59e0b; margin-bottom:0.75rem;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.5rem; flex-wrap:wrap; gap:0.5rem;">
              <span class="badge badge-gold">&#128266; Audio Question</span>
              <div style="display:flex; gap:0.4rem;">
                <button class="btn btn-warning" style="padding:0.25rem 0.65rem; font-size:0.75rem;" onclick="controlProjectorMedia('play')">&#9654;&#65039; Play on Projector</button>
                <button class="btn btn-secondary" style="padding:0.25rem 0.65rem; font-size:0.75rem;" onclick="controlProjectorMedia('pause')">&#9208; Pause Projector</button>
              </div>
            </div>
            <audio controls src="${q.media_url}" style="width:100%; height:32px;"></audio>
          </div>
        `;
      } else {
        mediaPreview.style.display = "none";
        mediaPreview.innerHTML = "";
      }
    }

    // Show options with correct one highlighted for Host
    const optBox = document.getElementById("console-options-list");
    optBox.innerHTML = "";
    const letters = ["A", "B", "C", "D"];
    q.options.forEach((optText, idx) => {
      const isCorrect = idx === q.correct_index;
      const div = document.createElement("div");
      div.style.padding = "0.5rem 0.75rem";
      div.style.borderRadius = "6px";
      div.style.background = isCorrect ? "rgba(16, 185, 129, 0.2)" : "#1e293b";
      div.style.border = isCorrect ? "1px solid #10b981" : "1px solid #334155";
      div.style.fontWeight = isCorrect ? "700" : "500";
      div.style.color = isCorrect ? "#34d399" : "#e2e8f0";
      div.innerHTML = `<strong>${letters[idx]}:</strong> ${optText} ${isCorrect ? " [CORRECT ANSWER]" : ""}`;
      optBox.appendChild(div);
    });

    if (q.explanation) {
      document.getElementById("console-q-explanation").textContent = `Explanation: ${q.explanation}`;
      document.getElementById("console-q-explanation").style.display = "block";
    } else {
      document.getElementById("console-q-explanation").style.display = "none";
    }
  } else {
    document.getElementById("console-q-title").textContent = "No Question Loaded";
    document.getElementById("console-q-text").textContent = "Please select or load a final round question.";
    document.getElementById("console-options-list").innerHTML = "";
  }

  // Active Team & Turn
  const finalistsMap = {};
  finalists.forEach(f => { finalistsMap[f.finalist_slot] = f; });
  const activeTeam = finalistsMap[activeSlot];

  document.getElementById("console-active-team").textContent = activeTeam ? `[T${activeSlot}] ${activeTeam.name}` : `Team ${activeSlot}`;
  document.getElementById("console-rotation-origin").textContent = `Q${state.question_index + 1} Origin: T${firstSlot} (modulo 6 rotation)`;

  const passCount = (state.pass_history || []).length;
  const currentMarks = state.current_marks || (passCount === 0 ? 10 : (passCount === 1 ? 5 : 2));

  const turnBadge = document.getElementById("console-turn-badge");
  if (state.turn_type === "main") {
    turnBadge.className = "badge badge-blue";
    turnBadge.textContent = "MAIN TURN (60s) • 10 MARKS";
  } else if (passCount === 1) {
    turnBadge.className = "badge badge-gold";
    turnBadge.textContent = "1ST PASS (5s) • 5 MARKS";
  } else {
    turnBadge.className = "badge badge-purple";
    turnBadge.textContent = "2ND PASS (5s) • 2 MARKS (FINAL)";
  }

  // Update correct & incorrect button labels
  const btnCorrect = document.querySelector(".btn-adj-correct span:first-child");
  if (btnCorrect) {
    btnCorrect.innerHTML = `&#10004; CORRECT (+${currentMarks})`;
  }
  const btnWrongLabel = document.querySelector(".btn-adj-wrong span:first-child");
  const btnWrongHint = document.getElementById("btn-wrong-hint");
  if (btnWrongLabel) {
    if (passCount === 0) {
      btnWrongLabel.innerHTML = `&#10008; WRONG &rarr; PASS 1`;
      if (btnWrongHint) btnWrongHint.textContent = "Key: X or 2 (5s • 5pts)";
    } else if (passCount === 1) {
      btnWrongLabel.innerHTML = `&#10008; WRONG &rarr; PASS 2`;
      if (btnWrongHint) btnWrongHint.textContent = "Key: X or 2 (5s • 2pts)";
    } else {
      btnWrongLabel.innerHTML = `&#10008; WRONG (ENDS Q)`;
      if (btnWrongHint) btnWrongHint.textContent = "Key: X or 2 (Max 2 passes)";
    }
  }

  // Buttons
  const btnAdjCorrectEl = document.querySelector(".btn-adj-correct");
  const btnAdjWrongEl = document.querySelector(".btn-adj-wrong");
  const btnAdjPassEl = document.querySelector(".btn-adj-pass");
  if (btnAdjCorrectEl) btnAdjCorrectEl.disabled = isEnded;
  if (btnAdjWrongEl) btnAdjWrongEl.disabled = isEnded;
  if (btnAdjPassEl) btnAdjPassEl.disabled = isEnded;

  // Timer & Buttons
  updateAdminTimer(state.time_remaining_seconds);
  const timerBtn = document.getElementById("btn-toggle-timer");
  if (isEnded) {
    timerBtn.disabled = true;
    timerBtn.textContent = "Stopped (Locked)";
    timerBtn.className = "action-card-btn btn-secondary";
  } else if (state.timer_is_running) {
    timerBtn.disabled = false;
    timerBtn.textContent = "Pause Timer";
    timerBtn.className = "action-card-btn btn-warning";
  } else {
    timerBtn.disabled = false;
    timerBtn.textContent = "Start Timer";
    timerBtn.className = "action-card-btn btn-adj-timer";
  }

  // Pass history summary
  const histBox = document.getElementById("console-pass-history");
  if (histBox) {
    if (passHistory.length === 0) {
      histBox.innerHTML = "<span style='color:#64748b;'>No passes yet on this question.</span>";
    } else {
      histBox.innerHTML = passHistory.map(h => {
        let badgeClass = h.result === "correct" ? "badge-green" : (h.result === "incorrect" ? "badge-red" : "badge-gold");
        return `<span class="badge ${badgeClass}">T${h.slot}: ${h.result.toUpperCase()}</span>`;
      }).join(" &rarr; ");
    }
  }

  // Question navigation buttons
  document.getElementById("btn-prev-q").disabled = state.question_index <= 0;
  document.getElementById("btn-next-q").disabled = state.question_index >= state.total_questions - 1;

  // Render quick score table in host console
  renderAdminFinalScoreboard(finalists);
}

function updateAdminTimer(seconds) {
  const el = document.getElementById("console-timer-val");
  if (el) el.textContent = `${seconds}s`;
}

function renderAdminFinalScoreboard(finalists) {
  const tbody = document.getElementById("admin-final-scoreboard-rows");
  if (!tbody) return;
  tbody.innerHTML = "";

  const sorted = [...finalists].sort((a, b) => b.final_score - a.final_score);
  sorted.forEach((team, rank) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>#${rank + 1}</td>
      <td><strong>[T${team.finalist_slot}]</strong> ${team.name}</td>
      <td style="font-weight:700; color:#f59e0b; font-size:1.1rem;">${team.final_score}</td>
      <td>
        <button class="btn btn-secondary" style="padding:0.25rem 0.5rem; font-size:0.75rem;" onclick="promptScoreAdjust(${team.id}, '${team.name}')">Adjust</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// Host Adjudication Actions
async function adjudicate(decision) {
  if (currentFinalState && (currentFinalState.question_status === "ended" || currentFinalState.is_locked)) {
    return;
  }
  const passHist = currentFinalState ? (currentFinalState.pass_history || []) : [];
  const maxPasses = currentFinalState ? (currentFinalState.max_passes || 2) : 2;
  const finalistsMap = {};
  if (currentFinalState && currentFinalState.finalists) {
    currentFinalState.finalists.forEach(f => { finalistsMap[f.finalist_slot] = f; });
  }
  const currTeam = currentFinalState ? finalistsMap[currentFinalState.active_team_slot] : null;
  const currName = currTeam ? `[T${currentFinalState.active_team_slot}] ${currTeam.name}` : (currentFinalState ? `Team ${currentFinalState.active_team_slot}` : "");

  if (decision === "incorrect" && currentFinalState && currentFinalState.question_status !== "ended") {
    if (passHist.length < maxPasses) {
      const passingOrder = (currentFinalState.passing_order || []).slice(0, maxPasses);
      const attempted = new Set(passHist.map(h => h.slot));
      attempted.add(currentFinalState.active_team_slot);
      const nextSlot = passingOrder.find(s => !attempted.has(s));

      if (nextSlot !== undefined) {
        // Pause timer while alert is displayed
        try {
          await fetch("/api/admin/final/timer", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "pause" })
          });
        } catch (e) {}

        const nextTeam = finalistsMap[nextSlot];
        const nextName = nextTeam ? `[T${nextSlot}] ${nextTeam.name}` : `Team ${nextSlot}`;
        const nextPassNum = passHist.length + 1;
        const nextMarks = nextPassNum === 1 ? 5 : 2;
        const passSecs = (currentFinalState.competition && currentFinalState.competition.final_pass_timer_seconds) || 5;

        alert(`❌ WRONG ANSWER!\n\n${currName} gave a wrong answer.\nQuestion is passed to ${nextName} (Pass ${nextPassNum}/2 • ${nextMarks} Marks • ${passSecs}s timer).`);
      }
    } else {
      alert(`❌ WRONG ANSWER!\n\n${currName} gave a wrong answer.\nPass limit reached (max 2 passes). Question ends with 0 marks.`);
    }
  } else if (decision === "timeout_or_pass" && currentFinalState && currentFinalState.question_status !== "ended") {
    if (passHist.length < maxPasses) {
      const passingOrder = (currentFinalState.passing_order || []).slice(0, maxPasses);
      const attempted = new Set(passHist.map(h => h.slot));
      attempted.add(currentFinalState.active_team_slot);
      const nextSlot = passingOrder.find(s => !attempted.has(s));

      if (nextSlot !== undefined) {
        // Pause timer while alert is displayed
        try {
          await fetch("/api/admin/final/timer", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "pause" })
          });
        } catch (e) {}

        const nextTeam = finalistsMap[nextSlot];
        const nextName = nextTeam ? `[T${nextSlot}] ${nextTeam.name}` : `Team ${nextSlot}`;
        const nextPassNum = passHist.length + 1;
        const nextMarks = nextPassNum === 1 ? 5 : 2;
        const passSecs = (currentFinalState.competition && currentFinalState.competition.final_pass_timer_seconds) || 5;

        alert(`⏱️ PASS TO NEXT TEAM!\n\n${currName} passed / timed out.\nQuestion is passed to ${nextName} (Pass ${nextPassNum}/2 • ${nextMarks} Marks • ${passSecs}s timer).`);
      }
    } else {
      alert(`⏱️ PASSES EXHAUSTED!\n\n${currName} passed / timed out.\nPass limit reached (max 2 passes). Question ends with 0 marks.`);
    }
  }

  try {
    const res = await fetch("/api/admin/final/adjudicate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision })
    });
    const data = await res.json();
    if (data.success) {
      currentFinalState = data.state;
      renderFinalConsole(currentFinalState);
    } else {
      alert("Error: " + data.error);
    }
  } catch (e) {
    console.error("Adjudication error", e);
  }
}

async function toggleTimer() {
  if (!currentFinalState) return;
  if (currentFinalState.question_status === "ended" || currentFinalState.is_locked) return;
  const action = currentFinalState.timer_is_running ? "pause" : "start";
  try {
    const res = await fetch("/api/admin/final/timer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action })
    });
    const data = await res.json();
    if (data.success) {
      currentFinalState = data.state;
      renderFinalConsole(currentFinalState);
    }
  } catch (e) {
    console.error("Timer toggle error", e);
  }
}

async function resetTimer() {
  if (currentFinalState && (currentFinalState.question_status === "ended" || currentFinalState.is_locked)) return;
  try {
    const res = await fetch("/api/admin/final/timer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reset" })
    });
    const data = await res.json();
    if (data.success) {
      currentFinalState = data.state;
      renderFinalConsole(currentFinalState);
    }
  } catch (e) {
    console.error("Reset error", e);
  }
}

async function unlockFinalQuestion() {
  if (!currentFinalState) return;
  const qNum = currentFinalState.question_index + 1;
  const ok = confirm(`Are you sure you want to unlock Question ${qNum}?\n\nThis will re-open the question for answering on the Projector Screen.`);
  if (!ok) return;

  try {
    const res = await fetch("/api/admin/final/unlock_question", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question_index: currentFinalState.question_index })
    });
    const data = await res.json();
    if (data.success && data.state) {
      currentFinalState = data.state;
      renderFinalConsole(currentFinalState);
      populateConsoleQuestionJump();
    } else {
      alert("Error: " + (data.error || "Failed to unlock question."));
    }
  } catch (e) {
    console.error("Unlock question error:", e);
    alert("Failed to unlock question.");
  }
}

async function navigateQuestion(delta) {
  if (!currentFinalState) return;
  const newIdx = currentFinalState.question_index + delta;
  if (newIdx < 0 || newIdx >= currentFinalState.total_questions) return;

  try {
    const res = await fetch("/api/admin/final/load_question", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question_index: newIdx })
    });
    const data = await res.json();
    if (data.success) {
      currentFinalState = data.state;
      renderFinalConsole(currentFinalState);
    }
  } catch (e) {
    console.error("Navigation error", e);
  }
}

async function revealQuestionOnProjector() {
  try {
    const res = await fetch("/api/admin/final/reveal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reveal" })
    });
    const data = await res.json();
    if (data.success) {
      currentFinalState = data.state;
      renderFinalConsole(currentFinalState);
    }
  } catch (e) {
    console.error("Reveal question error", e);
  }
}

async function revealOptionsOnProjector() {
  try {
    const res = await fetch("/api/admin/final/reveal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reveal_options" })
    });
    const data = await res.json();
    if (data.success) {
      currentFinalState = data.state;
      renderFinalConsole(currentFinalState);
    }
  } catch (e) {
    console.error("Reveal options error", e);
  }
}

async function resetFinalScores() {
  if (!confirm("Are you sure you want to reset ALL Projector Quiz (Final Round) scores back to 0?\n\nAll teams, finalists, Online Screening scores, and questions will remain intact.")) {
    return;
  }
  try {
    const res = await fetch("/api/admin/final/reset_scores", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    });
    const data = await res.json();
    if (data.success) {
      currentFinalState = data.state;
      renderFinalConsole(currentFinalState);
      alert("Projector Quiz scores have been reset to 0.");
    } else {
      alert("Error resetting scores: " + (data.error || "Unknown error"));
    }
  } catch (e) {
    console.error("Reset final scores error", e);
    alert("Network error while resetting scores.");
  }
}

async function hideQuestionOnProjector() {
  try {
    const res = await fetch("/api/admin/final/reveal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "hide" })
    });
    const data = await res.json();
    if (data.success) {
      currentFinalState = data.state;
      renderFinalConsole(currentFinalState);
    }
  } catch (e) {
    console.error("Hide question error", e);
  }
}

function promptScoreAdjust(teamId, teamName) {
  const deltaStr = prompt(`Adjust final score for ${teamName} (+5, -5, +1, etc.):`, "+5");
  if (!deltaStr) return;
  const delta = parseInt(deltaStr);
  if (isNaN(delta)) return alert("Invalid number.");

  const reason = prompt("Reason for adjustment:", "Host manual adjustment") || "Host adjustment";
  fetch("/api/admin/final/score/adjust", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ team_id: teamId, delta, reason })
  }).then(r => r.json()).then(data => {
    if (data.success) {
      loadFinalRoundState();
      loadAuditLog();
    } else {
      alert("Error: " + data.error);
    }
  });
}

// =============================================================================
// QUALIFIER LEADERBOARD & FINALISTS PROMOTION
// =============================================================================
async function loadQualifierLeaderboard() {
  try {
    const res = await fetch("/api/admin/qualifier/leaderboard");
    const data = await res.json();
    renderQualifierLeaderboard(data.leaderboard);
  } catch (e) {
    console.error("Qualifier leaderboard error", e);
  }
}

function renderQualifierLeaderboard(lb) {
  const tbody = document.getElementById("qualifier-leaderboard-rows");
  if (!tbody) return;
  tbody.innerHTML = "";

  if (!lb || lb.length === 0) {
    tbody.innerHTML = "<tr><td colspan='9' style='text-align:center;'>No teams found.</td></tr>";
    return;
  }

  lb.forEach(r => {
    const tr = document.createElement("tr");
    const willQualify = r.will_qualify;
    if (willQualify) {
      tr.style.background = "rgba(16, 185, 129, 0.08)";
    }

    let violationBadge = `<span style="color:#64748b; font-size:0.85rem;">0</span>`;
    if (r.tab_switch_count >= 3) {
      violationBadge = `<span class="badge badge-red" style="font-weight:800;">&#9940; ${r.tab_switch_count} (DISQUALIFIED)</span>`;
    } else if (r.tab_switch_count > 0) {
      violationBadge = `<span class="badge badge-gold" style="font-weight:800;">&#9888; ${r.tab_switch_count} Switches</span>`;
    }

    tr.innerHTML = `
      <td style="font-weight:700;">#${r.rank}</td>
      <td><strong>${r.code}</strong></td>
      <td>${r.name}</td>
      <td><span class="badge badge-blue">${r.station || 'PC'}</span></td>
      <td style="font-size:1.15rem; font-weight:800; color:#10b981;">${r.score}</td>
      <td style="font-family:monospace; font-weight:600;">${r.formatted_time}</td>
      <td>${r.submitted ? '<span class="badge badge-green">SUBMITTED</span>' : `<span class="badge badge-gold">${r.answered_count}/${r.total_questions} Ans</span>`}</td>
      <td>${violationBadge}</td>
      <td>
        ${willQualify ? '<span class="badge badge-green">TOP 6 FINALIST</span>' : '<span style="color:#64748b; font-size:0.8rem;">Cutoff</span>'}
        <button class="btn btn-secondary" style="padding:0.2rem 0.5rem; font-size:0.75rem; margin-left:0.5rem;" onclick="resetTeamAttempt(${r.id}, '${r.name}')">Reset</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function showAdminSecurityAlert(msg) {
  const alertEl = document.getElementById("admin-security-alert");
  const msgEl = document.getElementById("admin-security-msg");
  if (!alertEl || !msgEl) return;

  msgEl.innerHTML = `<strong>SECURITY WARNING:</strong> Team ID ${msg.team_id} attempted window switch (Violation #${msg.count}/3). ${msg.terminated ? "<strong>EXAM AUTO-TERMINATED!</strong>" : ""}`;
  alertEl.style.display = "flex";

  setTimeout(() => {
    alertEl.style.display = "none";
  }, 9000);
}

async function promoteFinalists() {
  if (!confirm("Are you sure you want to promote the Top 6 teams from the Qualifier to the Final Round?")) return;

  try {
    const res = await fetch("/api/admin/qualifier/promote", { method: "POST" });
    const data = await res.json();
    if (data.success) {
      alert(`Success! Finalists promoted:\n${data.promoted.join("\n")}`);
      loadQualifierLeaderboard();
      loadFinalRoundState();
    } else {
      alert("Error promoting finalists.");
    }
  } catch (e) {
    console.error("Promote error", e);
  }
}

async function resetTeamAttempt(teamId, teamName) {
  if (!confirm(`RESET ATTEMPT: Are you sure you want to wipe the current attempt for ${teamName}? This allows them to restart their 20-minute test.`)) return;

  try {
    const res = await fetch("/api/admin/qualifier/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ team_id: teamId })
    });
    const data = await res.json();
    if (data.success) {
      alert(`Attempt reset for ${teamName}.`);
      loadQualifierLeaderboard();
    }
  } catch (e) {
    console.error("Reset attempt error", e);
  }
}

// =============================================================================
// QUESTION BANK MANAGEMENT (ONLINE SCREENING & PROJECTOR QUIZ)
// =============================================================================
let rawAllQuestions = [];
let allQuestionsCache = [];
let selectedCategoryFilter = "";
let selectedRoundFilter = "";
let searchQuestionQuery = "";

function getFilterDisplayName(filter) {
  if (!filter) return "All Questions";
  const f = filter.toLowerCase();
  if (f === "screening" || f === "qualifier") return "🖥️ Online Screening";
  if (f === "projector" || f === "final") return "📽️ Projector Quiz";
  if (f === "audio") return "🎵 Audio Round";
  if (f === "visual" || f === "image") return "🖼️ Visual Round";
  if (f.includes("culture")) return "🎭 Indian Culture";
  if (f.includes("heritage")) return "🏛️ Indian Heritage";
  if (f.includes("tribal")) return "🏹 Tribal Traditions";
  return filter;
}

// Category Dropdown change handler
function onCategorySelectChange(val) {
  setCategoryFilter(val);
}

// Round Dropdown change handler
function onRoundSelectChange(val) {
  setRoundFilter(val);
}

// Search Input handler
function onSearchFilterInput(val) {
  searchQuestionQuery = (val || "").trim().toLowerCase();
  applyQuestionsFilter();
}

function clearSearchInput() {
  const el = document.getElementById("filter-search-input");
  if (el) el.value = "";
  searchQuestionQuery = "";
  applyQuestionsFilter();
}

// Set Category Filter
function setCategoryFilter(category) {
  selectedCategoryFilter = (category || "").trim();

  // Synchronize Category dropdown
  const catSelect = document.getElementById("filter-category-select");
  if (catSelect) {
    const fLower = selectedCategoryFilter.toLowerCase();
    if (!fLower) {
      catSelect.value = "";
    } else if (fLower.includes("culture")) {
      catSelect.value = "culture";
    } else if (fLower.includes("heritage")) {
      catSelect.value = "heritage";
    } else if (fLower.includes("tribal")) {
      catSelect.value = "tribal";
    } else if (fLower.includes("audio")) {
      catSelect.value = "audio";
    } else if (fLower.includes("visual") || fLower.includes("image")) {
      catSelect.value = "visual";
    } else {
      catSelect.value = selectedCategoryFilter;
    }
  }

  updateFilterUIState();
  applyQuestionsFilter();
}

// Set Round Filter
function setRoundFilter(round) {
  selectedRoundFilter = (round || "").trim();
  const roundSelect = document.getElementById("filter-round-select");
  if (roundSelect) roundSelect.value = selectedRoundFilter;

  updateFilterUIState();
  applyQuestionsFilter();
}

// Reset all filters
function resetAllQuestionFilters() {
  selectedCategoryFilter = "";
  selectedRoundFilter = "";
  searchQuestionQuery = "";

  const catSelect = document.getElementById("filter-category-select");
  if (catSelect) catSelect.value = "";

  const roundSelect = document.getElementById("filter-round-select");
  if (roundSelect) roundSelect.value = "";

  const searchInput = document.getElementById("filter-search-input");
  if (searchInput) searchInput.value = "";

  updateFilterUIState();
  applyQuestionsFilter();
}

// Universal backward-compatible filter dispatcher
function setQuestionFilter(filter) {
  if (!filter) {
    resetAllQuestionFilters();
    return;
  }
  const fLower = filter.toLowerCase();
  if (fLower === "screening" || fLower === "qualifier" || fLower === "projector" || fLower === "final") {
    setRoundFilter(fLower === "qualifier" ? "screening" : (fLower === "final" ? "projector" : fLower));
  } else {
    setCategoryFilter(filter);
  }
}

// Filter questions in memory
function applyQuestionsFilter() {
  let filtered = rawAllQuestions;

  // 1. Category Filter
  if (selectedCategoryFilter) {
    const fCat = selectedCategoryFilter.toLowerCase();
    filtered = filtered.filter(q => {
      const cat = (q.category || "").toLowerCase();
      const media = (q.media_type || "").toLowerCase();

      if (fCat === "audio") {
        return media === "audio" || cat.includes("audio");
      }
      if (fCat === "visual" || fCat === "image") {
        return media === "image" || cat.includes("visual") || cat.includes("image");
      }
      if (fCat === "culture" || fCat.includes("culture")) {
        return cat.includes("culture");
      }
      if (fCat === "heritage" || fCat.includes("heritage")) {
        return cat.includes("heritage");
      }
      if (fCat === "tribal" || fCat.includes("tribal")) {
        return cat.includes("tribal");
      }
      return cat === fCat || cat.includes(fCat);
    });
  }

  // 2. Round Filter
  if (selectedRoundFilter) {
    const fRound = selectedRoundFilter.toLowerCase();
    filtered = filtered.filter(q => {
      const rType = (q.round_type || "").toLowerCase();
      const rawRType = (q.raw_round_type || "").toLowerCase();
      if (fRound === "screening" || fRound === "qualifier") {
        return rType === "screening" || rawRType === "qualifier";
      }
      if (fRound === "projector" || fRound === "final") {
        return rType === "projector" || rawRType === "final";
      }
      return true;
    });
  }

  // 3. Search Keyword Filter
  if (searchQuestionQuery) {
    const qSearch = searchQuestionQuery.toLowerCase();
    filtered = filtered.filter(q => {
      const textMatch = (q.text || "").toLowerCase().includes(qSearch);
      const catMatch = (q.category || "").toLowerCase().includes(qSearch);
      const optMatch = (q.options || []).some(o => (o || "").toLowerCase().includes(qSearch));
      const expMatch = (q.explanation || "").toLowerCase().includes(qSearch);
      return textMatch || catMatch || optMatch || expMatch;
    });
  }

  allQuestionsCache = filtered;
  renderQuestionsList(allQuestionsCache, rawAllQuestions.length);
}

// Update UI Pill states and Stat card highlights
function updateFilterUIState() {
  const fLower = (selectedCategoryFilter || "").toLowerCase();

  // Category Pill Buttons
  const pills = [
    { id: "cat-pill-all", active: !selectedCategoryFilter },
    { id: "cat-pill-culture", active: fLower.includes("culture") },
    { id: "cat-pill-heritage", active: fLower.includes("heritage") },
    { id: "cat-pill-tribal", active: fLower.includes("tribal") },
    { id: "cat-pill-audio", active: fLower === "audio" },
    { id: "cat-pill-visual", active: fLower === "visual" || fLower === "image" }
  ];

  pills.forEach(p => {
    const btn = document.getElementById(p.id);
    if (btn) {
      btn.className = p.active ? "btn btn-primary cat-pill-btn" : "btn btn-secondary cat-pill-btn";
    }
  });

  // Top stat cards
  const statCards = document.querySelectorAll(".stat-filter-card");
  statCards.forEach(card => {
    const fVal = (card.getAttribute("data-filter") || "").toLowerCase();
    let isMatch = false;

    if (fVal === "screening" && (selectedRoundFilter === "screening" || selectedRoundFilter === "qualifier")) {
      isMatch = true;
    } else if (selectedCategoryFilter) {
      if (fVal === "culture" && fLower.includes("culture")) isMatch = true;
      if (fVal === "heritage" && fLower.includes("heritage")) isMatch = true;
      if (fVal === "tribal" && fLower.includes("tribal")) isMatch = true;
      if (fVal === "audio" && fLower === "audio") isMatch = true;
      if (fVal === "visual" && (fLower === "visual" || fLower === "image")) isMatch = true;
    }

    if (isMatch) {
      card.style.borderColor = "#38bdf8";
      card.style.background = "#1e293b";
      card.style.boxShadow = "0 0 16px rgba(56, 189, 248, 0.4)";
    } else {
      card.style.borderColor = "#334155";
      card.style.background = "#0f172a";
      card.style.boxShadow = "none";
    }
  });
}

async function loadQuestions() {
  try {
    const allRes = await fetch("/api/admin/questions?pool=all");
    const allData = await allRes.json();
    rawAllQuestions = allData.questions || [];
    updateQuestionStats(rawAllQuestions);
    updateFilterUIState();
    applyQuestionsFilter();
  } catch (e) {
    console.error("Questions error", e);
  }
}

function updateQuestionStats(allQs) {
  let screeningCount = 0;
  let audioCount = 0;
  let visualCount = 0;
  let cultureCount = 0;
  let heritageCount = 0;
  let tribalCount = 0;

  allQs.forEach(q => {
    const isProjector = q.round_type === "projector" || q.raw_round_type === "final";
    const cat = (q.category || "").toLowerCase();
    const media = (q.media_type || "").toLowerCase();

    if (!isProjector) {
      screeningCount++;
    } else {
      if (media === "audio" || cat.includes("audio")) {
        audioCount++;
      } else if (media === "image" || cat.includes("visual") || cat.includes("image")) {
        visualCount++;
      }
    }

    // Category counts across questions
    if (cat.includes("culture")) cultureCount++;
    if (cat.includes("heritage")) heritageCount++;
    if (cat.includes("tribal")) tribalCount++;
  });

  const elScr = document.getElementById("stat-count-screening");
  const elAud = document.getElementById("stat-count-audio");
  const elVis = document.getElementById("stat-count-visual");
  const elCul = document.getElementById("stat-count-culture");
  const elHer = document.getElementById("stat-count-heritage");
  const elTri = document.getElementById("stat-count-tribal");

  if (elScr) elScr.textContent = `${screeningCount} / 20`;
  if (elAud) elAud.textContent = `${audioCount} / 6`;
  if (elVis) elVis.textContent = `${visualCount} / 6`;
  if (elCul) elCul.textContent = `${cultureCount} Qs`;
  if (elHer) elHer.textContent = `${heritageCount} Qs`;
  if (elTri) elTri.textContent = `${tribalCount} Qs`;

  // Update pill counts
  const pAll = document.getElementById("count-pill-all");
  const pCul = document.getElementById("count-pill-culture");
  const pHer = document.getElementById("count-pill-heritage");
  const pTri = document.getElementById("count-pill-tribal");
  const pAud = document.getElementById("count-pill-audio");
  const pVis = document.getElementById("count-pill-visual");

  if (pAll) pAll.textContent = allQs.length;
  if (pCul) pCul.textContent = cultureCount;
  if (pHer) pHer.textContent = heritageCount;
  if (pTri) pTri.textContent = tribalCount;
  if (pAud) pAud.textContent = audioCount;
  if (pVis) pVis.textContent = visualCount;
}

async function clearAllQuestions() {
  if (!confirm("Are you sure you want to remove ALL questions from the Question Bank? You can then add your 20 screening and 30 projector questions manually.")) return;
  try {
    const res = await fetch("/api/admin/questions?all=1", { method: "DELETE" });
    const data = await res.json();
    if (data.success) {
      alert("All questions cleared. You now have a clean slate to add your questions!");
      loadQuestions();
      loadFinalRoundState();
    } else {
      alert("Error clearing questions: " + data.error);
    }
  } catch (e) {
    console.error("Clear questions error", e);
  }
}

function onCategoryChange(input, prefix) {
  const val = (input.value || "").trim().toLowerCase();
  const mediaSelect = document.getElementById(`${prefix}-media-type`);
  if (val.includes("audio")) {
    if (mediaSelect) {
      mediaSelect.value = "audio";
      onMediaTypeChange(mediaSelect, prefix);
    }
  } else if (val.includes("visual") || val.includes("image")) {
    if (mediaSelect) {
      mediaSelect.value = "image";
      onMediaTypeChange(mediaSelect, prefix);
    }
  }
}

function renderQuestionsList(questions, totalCount) {
  const container = document.getElementById("questions-list-container");
  if (!container) return;
  container.innerHTML = "";

  // Active Filter Banner with Clear Filter button
  if (selectedCategoryFilter || selectedRoundFilter || searchQuestionQuery) {
    const filterBanner = document.createElement("div");
    filterBanner.id = "active-filter-banner";
    filterBanner.style.cssText = "margin-bottom:1rem; padding:0.85rem 1.25rem; border-radius:8px; background:rgba(56, 189, 248, 0.12); border:1px solid #38bdf8; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.5rem;";

    let activeTags = [];
    if (selectedCategoryFilter) {
      activeTags.push(`Category: <span class="badge badge-purple" style="font-size:0.85rem; font-weight:700;">${getFilterDisplayName(selectedCategoryFilter)}</span>`);
    }
    if (selectedRoundFilter) {
      activeTags.push(`Round: <span class="badge badge-blue" style="font-size:0.85rem; font-weight:700;">${selectedRoundFilter === 'screening' ? '🖥️ Online Screening' : '📽️ Projector Quiz'}</span>`);
    }
    if (searchQuestionQuery) {
      activeTags.push(`Search: <span class="badge" style="background:#334155; font-size:0.85rem;">"${searchQuestionQuery}"</span>`);
    }

    filterBanner.innerHTML = `
      <div style="font-size:0.95rem; color:#f8fafc; display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap;">
        <span style="font-weight:700; color:#38bdf8;">Filter Active:</span>
        ${activeTags.join(' ')}
        <span style="color:#94a3b8; font-size:0.85rem; margin-left:0.35rem;">(Showing <strong>${questions.length}</strong> of ${totalCount || questions.length} questions)</span>
      </div>
      <button class="btn btn-secondary" style="padding:0.35rem 0.85rem; font-size:0.85rem; font-weight:700;" onclick="resetAllQuestionFilters()">
        &times; Clear Filters (Show All)
      </button>
    `;
    container.appendChild(filterBanner);
  }

  if (!questions || questions.length === 0) {
    container.innerHTML += "<div style='color:#94a3b8; padding:2rem; text-align:center; background:#0f172a; border-radius:8px; border:1px dashed #334155;'><p style='font-size:1.1rem; font-weight:600; color:#cbd5e1;'>No questions found matching the selected filter.</p><p style='font-size:0.85rem; margin-top:0.5rem;'><button class='btn btn-secondary' onclick='resetAllQuestionFilters()'>Reset Filter to Show All Questions</button></p></div>";
    return;
  }

  questions.forEach((q, idx) => {
    const div = document.createElement("div");
    div.className = "card";
    div.style.marginBottom = "0.85rem";
    const letters = ["A", "B", "C", "D"];

    const isProjector = q.round_type === "projector" || q.raw_round_type === "final";
    const poolFilter = isProjector ? "projector" : "screening";
    const poolBadge = isProjector 
      ? `<span class="badge badge-gold" style="cursor:pointer; padding:0.3rem 0.6rem; border-radius:4px; font-weight:700;" title="Click to filter by Projector Quiz" onclick="setRoundFilter('projector')">&#128253; PROJECTOR QUIZ</span>`
      : `<span class="badge badge-blue" style="cursor:pointer; padding:0.3rem 0.6rem; border-radius:4px; font-weight:700;" title="Click to filter by Online Screening" onclick="setRoundFilter('screening')">&#128187; ONLINE SCREENING</span>`;

    let mediaBadge = `<span class="badge" style="background:#334155; color:#cbd5e1; padding:0.3rem 0.6rem; border-radius:4px;">&#128221; TEXT ONLY</span>`;
    let mediaPreviewHtml = "";
    if (q.media_type === "image" && q.media_url) {
      mediaBadge = `<span class="badge badge-purple" style="cursor:pointer; padding:0.3rem 0.6rem; border-radius:4px; font-weight:700;" title="Click to filter by Visual Round" onclick="setCategoryFilter('visual')">&#128444;&#65039; IMAGE BASED</span>`;
      mediaPreviewHtml = `
        <div style="margin:0.5rem 0; text-align:left;">
          <img src="${q.media_url}" style="max-height:120px; max-width:240px; border-radius:6px; border:1px solid #38bdf8; object-fit:contain;">
        </div>
      `;
    } else if (q.media_type === "audio" && q.media_url) {
      mediaBadge = `<span class="badge badge-gold" style="cursor:pointer; padding:0.3rem 0.6rem; border-radius:4px; font-weight:700;" title="Click to filter by Audio Round" onclick="setCategoryFilter('audio')">&#128266; AUDIO CLIP</span>`;
      mediaPreviewHtml = `
        <div style="margin:0.5rem 0;">
          <audio controls src="${q.media_url}" style="width:100%; max-width:380px; height:32px;"></audio>
        </div>
      `;
    }

    const catSafe = (q.category || 'General').replace(/'/g, "\\'");
    const categoryBadge = `<span class="badge badge-purple" style="cursor:pointer; background:#4338ca; border:1px solid #6366f1; transition:all 0.2s ease; padding:0.3rem 0.65rem; border-radius:4px; font-weight:700;" onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'" title="Click to filter questions in category '${catSafe}'" onclick="setCategoryFilter('${catSafe}')">&#127991;&#65039; ${q.category || 'General'}</span>`;

    div.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.5rem; margin-bottom:0.6rem;">
        <div style="display:flex; gap:0.4rem; align-items:center; flex-wrap:wrap;">
          ${poolBadge}
          ${mediaBadge}
          ${categoryBadge}
          <span style="font-size:0.8rem; color:#94a3b8; font-weight:600;">Marks: ${q.marks}</span>
        </div>
        <div style="display:flex; gap:0.35rem;">
          <button class="btn btn-secondary" style="padding:0.25rem 0.65rem; font-size:0.8rem;" onclick="openEditQuestionModal(${q.id})">Edit</button>
          <button class="btn btn-danger" style="padding:0.25rem 0.65rem; font-size:0.8rem;" onclick="deleteQuestion(${q.id})">Delete</button>
        </div>
      </div>
      <p style="font-size:1.1rem; font-weight:700; margin-bottom:0.5rem; color:#ffffff;">${idx + 1}. ${q.text}</p>
      ${mediaPreviewHtml}
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.5rem; font-size:0.9rem; margin-top:0.5rem;">
        ${q.options.map((opt, i) => `
          <div style="padding:0.45rem 0.75rem; border-radius:4px; background:${i === q.correct_index ? 'rgba(16, 185, 129, 0.2)' : '#1e293b'}; border:${i === q.correct_index ? '1px solid #10b981' : '1px solid #334155'}; color:${i === q.correct_index ? '#34d399' : '#cbd5e1'}; font-weight:${i === q.correct_index ? '700' : '500'};">
            <strong>${letters[i]}:</strong> ${opt} ${i === q.correct_index ? '&check; (Correct)' : ''}
          </div>
        `).join('')}
      </div>
      ${q.explanation ? `<div style="font-size:0.8rem; color:#94a3b8; margin-top:0.5rem;">Explanation: ${q.explanation}</div>` : ''}
    `;
    container.appendChild(div);
  });
}

function openAddQuestionModal() {
  const form = document.getElementById("form-add-question");
  if (!form) return;
  form.reset();
  if (selectedRoundFilter === "screening" || selectedRoundFilter === "qualifier") form.round_type.value = "screening";
  if (selectedRoundFilter === "projector" || selectedRoundFilter === "final") form.round_type.value = "projector";
  if (selectedCategoryFilter) {
    const fLower = selectedCategoryFilter.toLowerCase();
    if (fLower.includes("culture")) form.category.value = "Indian Culture";
    else if (fLower.includes("heritage")) form.category.value = "Indian Heritage";
    else if (fLower.includes("tribal")) form.category.value = "Tribal Traditions";
    else if (fLower === "audio") form.category.value = "Audio Round";
    else if (fLower === "visual" || fLower === "image") form.category.value = "Visual Round";
    else form.category.value = selectedCategoryFilter;
  }
  onPoolChange(form.round_type, 'add');
  const mediaRow = document.getElementById("add-media-row");
  const mediaPreview = document.getElementById("add-media-preview");
  if (mediaRow) mediaRow.style.display = "none";
  if (mediaPreview) mediaPreview.style.display = "none";
  const modal = document.getElementById("modal-add-question");
  if (modal) modal.classList.add("active");
}

function openEditQuestionModal(qId) {
  const q = allQuestionsCache.find(item => item.id === qId) || rawAllQuestions.find(item => item.id === qId);
  if (!q) return alert("Question not found.");

  document.getElementById("edit-q-id").value = q.id;
  document.getElementById("edit-q-round").value = q.round_type === "projector" ? "projector" : "screening";
  document.getElementById("edit-media-type").value = q.media_type || "none";
  document.getElementById("edit-media-url").value = q.media_url || "";
  document.getElementById("edit-q-category").value = q.category || "General";
  document.getElementById("edit-q-marks").value = q.marks;
  document.getElementById("edit-q-text").value = q.text;

  const letters = ["opta", "optb", "optc", "optd"];
  letters.forEach((l, idx) => {
    document.getElementById(`edit-q-${l}`).value = q.options[idx] || "";
  });
  document.getElementById("edit-q-correct").value = q.correct_index;
  document.getElementById("edit-q-explanation").value = q.explanation || "";

  // Trigger media preview
  onMediaTypeChange(document.getElementById("edit-media-type"), 'edit');
  if (q.media_url) {
    renderMediaPreview('edit', q.media_type, q.media_url);
  }

  document.getElementById("modal-edit-question").classList.add("active");
}

function onMediaTypeChange(selectEl, prefix) {
  const type = selectEl.value;
  const row = document.getElementById(`${prefix}-media-row`);
  const fileInput = document.getElementById(`${prefix}-media-file`);
  const label = document.getElementById(`${prefix}-media-label`);

  if (type === "image") {
    row.style.display = "block";
    fileInput.accept = "image/*";
    label.textContent = "Upload Question Image (.jpg, .png, .webp, .svg):";
  } else if (type === "audio") {
    row.style.display = "block";
    fileInput.accept = "audio/*";
    label.textContent = "Upload Question Audio Clip (.mp3, .wav, .ogg, .m4a):";
  } else {
    row.style.display = "none";
    document.getElementById(`${prefix}-media-url`).value = "";
    document.getElementById(`${prefix}-media-preview`).style.display = "none";
  }
}

function onPoolChange(selectEl, prefix) {
  const pool = selectEl.value;
  const marksInput = document.getElementById(`${prefix}-marks`);
  if (marksInput) {
    marksInput.value = pool === "screening" ? 1 : 10;
  }
}

async function uploadQuestionMedia(fileInput, prefix) {
  if (!fileInput.files || fileInput.files.length === 0) return;
  const formData = new FormData();
  formData.append("file", fileInput.files[0]);

  try {
    const res = await fetch("/api/admin/media/upload", {
      method: "POST",
      body: formData
    });
    const data = await res.json();
    if (data.success) {
      document.getElementById(`${prefix}-media-url`).value = data.url;
      renderMediaPreview(prefix, data.media_type, data.url);
    } else {
      alert("Media upload error: " + data.error);
    }
  } catch (e) {
    console.error("Upload error", e);
    alert("Network error during media upload.");
  }
}

function renderMediaPreview(prefix, type, url) {
  const previewBox = document.getElementById(`${prefix}-media-preview`);
  if (!previewBox) return;
  previewBox.style.display = "block";

  if (type === "image") {
    previewBox.innerHTML = `
      <div style="font-size:0.75rem; color:#94a3b8; margin-bottom:0.25rem;">Image Preview:</div>
      <img src="${url}" style="max-height:120px; max-width:200px; border-radius:4px; border:1px solid #38bdf8;">
    `;
  } else if (type === "audio") {
    previewBox.innerHTML = `
      <div style="font-size:0.75rem; color:#94a3b8; margin-bottom:0.25rem;">Audio Preview:</div>
      <audio controls src="${url}" style="width:100%; height:32px;"></audio>
    `;
  } else {
    previewBox.style.display = "none";
  }
}

async function addQuestion(event) {
  event.preventDefault();
  const form = document.getElementById("form-add-question");
  const mediaUrlEl = document.getElementById("add-media-url");
  const payload = {
    round_type: form.round_type.value,
    media_type: form.media_type.value,
    media_url: mediaUrlEl ? mediaUrlEl.value.trim() : (form.media_url ? form.media_url.value.trim() : ""),
    text: form.q_text.value.trim(),
    options: [form.opt_a.value.trim(), form.opt_b.value.trim(), form.opt_c.value.trim(), form.opt_d.value.trim()],
    correct_index: parseInt(form.correct_opt.value),
    category: form.category.value.trim(),
    explanation: form.explanation ? form.explanation.value.trim() : "",
    marks: parseInt(form.marks.value)
  };

  try {
    const res = await fetch("/api/admin/questions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.success) {
      alert("Question added successfully!");
      form.reset();
      document.getElementById("modal-add-question").classList.remove("active");
      await loadQuestions();
      if (typeof populateConsoleQuestionJump === "function") {
        populateConsoleQuestionJump();
      }
    } else {
      alert("Error adding question: " + (data.error || "Unknown server error"));
    }
  } catch (e) {
    console.error("Add question error", e);
    alert("Network or system error while adding question.");
  }
}

async function saveEditQuestion(event) {
  event.preventDefault();
  const form = document.getElementById("form-edit-question");
  const payload = {
    id: parseInt(form.question_id.value),
    round_type: form.round_type.value,
    media_type: form.media_type.value,
    media_url: form.media_url.value.trim(),
    text: form.q_text.value.trim(),
    options: [form.opt_a.value.trim(), form.opt_b.value.trim(), form.opt_c.value.trim(), form.opt_d.value.trim()],
    correct_index: parseInt(form.correct_opt.value),
    category: form.category.value.trim(),
    marks: parseInt(form.marks.value),
    explanation: form.explanation.value.trim()
  };

  try {
    const res = await fetch("/api/admin/questions", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.success) {
      alert("Question updated successfully!");
      document.getElementById("modal-edit-question").classList.remove("active");
      loadQuestions();
      loadFinalRoundState();
    } else {
      alert("Error updating question: " + data.error);
    }
  } catch (e) {
    console.error("Edit question error", e);
  }
}

async function deleteQuestion(qId) {
  if (!confirm("Are you sure you want to delete this question?")) return;
  try {
    const res = await fetch(`/api/admin/questions?id=${qId}`, { method: "DELETE" });
    const data = await res.json();
    if (data.success) {
      loadQuestions();
      loadFinalRoundState();
    }
  } catch (e) {
    console.error("Delete question error", e);
  }
}

async function uploadQuestionsCsv() {
  const fileInput = document.getElementById("csv-questions-file");
  if (!fileInput.files || fileInput.files.length === 0) return alert("Please select a CSV file.");

  const formData = new FormData();
  formData.append("file", fileInput.files[0]);

  try {
    const res = await fetch("/api/admin/questions/import", {
      method: "POST",
      body: formData
    });
    const data = await res.json();
    if (data.success) {
      alert(`Success! Imported ${data.imported_count} questions.`);
      fileInput.value = "";
      loadQuestions();
      loadFinalRoundState();
    } else {
      alert("Import error: " + data.error);
    }
  } catch (e) {
    console.error("CSV upload error", e);
  }
}

async function controlProjectorMedia(action) {
  try {
    await fetch("/api/admin/projector/media", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action })
    });
  } catch (e) {
    console.error("Projector media error", e);
  }
}

// =============================================================================
// TEAMS MANAGEMENT
// =============================================================================
let allTeamsCache = [];

async function loadTeams() {
  try {
    const res = await fetch("/api/admin/teams");
    const data = await res.json();
    allTeamsCache = data.teams || [];
    renderTeamsList(allTeamsCache);
  } catch (e) {
    console.error("Teams error", e);
  }
}

function renderTeamsList(teams) {
  const tbody = document.getElementById("teams-table-rows");
  if (!tbody) return;
  tbody.innerHTML = "";

  if (!teams || teams.length === 0) {
    tbody.innerHTML = "<tr><td colspan='6' style='text-align:center;'>No teams found.</td></tr>";
    return;
  }

  teams.forEach(t => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>${t.code}</strong></td>
      <td style="font-size:1.05rem;"><strong>${t.name}</strong></td>
      <td style="color:#94a3b8;">${t.members || '-'}</td>
      <td><span class="badge badge-blue">${t.assigned_station || 'PC'}</span></td>
      <td><code>${t.pin}</code></td>
      <td>
        <button class="btn btn-secondary" style="padding:0.25rem 0.6rem; font-size:0.8rem; margin-right:0.35rem;" onclick="openEditTeamModal(${t.id})">Edit</button>
        <button class="btn btn-danger" style="padding:0.25rem 0.6rem; font-size:0.8rem;" onclick="deleteTeam(${t.id}, '${t.name.replace(/'/g, "\\'")}')">Remove</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function openEditTeamModal(teamId) {
  const team = allTeamsCache.find(t => t.id === teamId);
  if (!team) return alert("Team not found.");

  document.getElementById("edit-team-id").value = team.id;
  document.getElementById("edit-team-code").value = team.code;
  document.getElementById("edit-team-name").value = team.name;
  document.getElementById("edit-team-members").value = team.members || "";
  document.getElementById("edit-team-station").value = team.assigned_station || "";
  document.getElementById("edit-team-pin").value = team.pin || "1234";

  document.getElementById("modal-edit-team").classList.add("active");
}

async function saveEditTeam(event) {
  event.preventDefault();
  const form = document.getElementById("form-edit-team");
  const payload = {
    id: parseInt(form.team_id.value),
    code: form.team_code.value.trim().toUpperCase(),
    name: form.team_name.value.trim(),
    members: form.team_members.value.trim(),
    pin: form.team_pin.value.trim(),
    assigned_station: form.team_station.value.trim()
  };

  try {
    const res = await fetch("/api/admin/teams", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.success) {
      alert("Team updated successfully!");
      document.getElementById("modal-edit-team").classList.remove("active");
      loadTeams();
      loadQualifierLeaderboard();
      loadFinalRoundState();
    } else {
      alert("Error: " + data.error);
    }
  } catch (e) {
    console.error("Save edit team error", e);
  }
}

async function addTeam(event) {
  event.preventDefault();
  const form = document.getElementById("form-add-team");
  const payload = {
    code: form.team_code.value.trim().toUpperCase(),
    name: form.team_name.value.trim(),
    members: form.team_members.value.trim(),
    pin: form.team_pin.value.trim(),
    assigned_station: form.team_station.value.trim()
  };

  try {
    const res = await fetch("/api/admin/teams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.success) {
      alert("Team registered successfully!");
      form.reset();
      document.getElementById("modal-add-team").classList.remove("active");
      loadTeams();
      loadQualifierLeaderboard();
    } else {
      alert("Error: " + data.error);
    }
  } catch (e) {
    console.error("Add team error", e);
  }
}

async function deleteTeam(teamId, teamName) {
  if (!confirm(`Are you sure you want to remove ${teamName || 'this team'}? All associated test attempts and responses will also be removed.`)) return;
  try {
    const res = await fetch(`/api/admin/teams?id=${teamId}`, { method: "DELETE" });
    const data = await res.json();
    if (data.success) {
      loadTeams();
      loadQualifierLeaderboard();
      loadFinalRoundState();
    } else {
      alert("Error: " + data.error);
    }
  } catch (e) {
    console.error("Delete team error", e);
  }
}

async function clearAllTeams() {
  if (!confirm("Are you sure you want to remove ALL teams? This will clear all teams and their test attempts.")) return;
  try {
    const res = await fetch("/api/admin/teams?all=1", { method: "DELETE" });
    const data = await res.json();
    if (data.success) {
      alert("All teams have been removed.");
      loadTeams();
      loadQualifierLeaderboard();
      loadFinalRoundState();
    } else {
      alert("Error: " + data.error);
    }
  } catch (e) {
    console.error("Clear teams error", e);
  }
}

async function uploadTeamsCsv() {
  const fileInput = document.getElementById("csv-teams-file");
  if (!fileInput.files || fileInput.files.length === 0) return alert("Please select a CSV file.");

  const formData = new FormData();
  formData.append("file", fileInput.files[0]);

  try {
    const res = await fetch("/api/admin/teams/import", {
      method: "POST",
      body: formData
    });
    const data = await res.json();
    if (data.success) {
      alert(`Success! Imported/updated ${data.imported_count} teams.`);
      fileInput.value = "";
      loadTeams();
      loadQualifierLeaderboard();
    } else {
      alert("Import error: " + data.error);
    }
  } catch (e) {
    console.error("CSV upload error", e);
  }
}

// =============================================================================
// AUDIT LOG & RECOVERY
// =============================================================================
async function loadAuditLog() {
  try {
    const res = await fetch("/api/admin/audit-log");
    const data = await res.json();

    const txBody = document.getElementById("score-transactions-rows");
    if (txBody) {
      txBody.innerHTML = (data.transactions || []).map(tx => `
        <tr>
          <td style="font-size:0.8rem; color:#94a3b8;">${tx.created_at}</td>
          <td><strong>${tx.team_name} (${tx.team_code})</strong></td>
          <td><span class="badge ${tx.round_type === 'final' ? 'badge-gold' : 'badge-blue'}">${tx.round_type.toUpperCase()}</span></td>
          <td style="font-weight:700; color:${tx.delta_marks >= 0 ? '#10b981' : '#ef4444'};">${tx.delta_marks >= 0 ? '+' : ''}${tx.delta_marks}</td>
          <td style="font-weight:700;">${tx.resulting_score}</td>
          <td style="color:#cbd5e1;">${tx.reason}</td>
        </tr>
      `).join("");
    }

    const eventList = document.getElementById("audit-events-list");
    if (eventList) {
      eventList.innerHTML = (data.events || []).map(ev => `
        <div style="padding:0.4rem 0.5rem; border-bottom:1px solid #334155; font-size:0.85rem;">
          <span style="color:#94a3b8;">${ev.created_at}</span> &bull;
          <strong style="color:#38bdf8;">${ev.event_type}</strong>: ${ev.details}
        </div>
      `).join("");
    }
  } catch (e) {
    console.error("Audit log error", e);
  }
}

async function resetEntireCompetition() {
  const code = prompt("DANGER: This will erase all qualifier test attempts, scores, and final round state!\nType 'RESET' to confirm:");
  if (code !== "RESET") return;

  try {
    const res = await fetch("/api/admin/competition/reset", { method: "POST" });
    const data = await res.json();
    if (data.success) {
      alert("Competition state successfully reset to initial fresh state.");
      loadFinalRoundState();
      loadQualifierLeaderboard();
      loadAuditLog();
    }
  } catch (e) {
    console.error("Reset error", e);
  }
}

// =============================================================================
// KEYBOARD SHORTCUTS FOR HOST CONSOLE
// =============================================================================
function setupKeyboardShortcuts() {
  window.addEventListener("keydown", (e) => {
    // Only trigger if not typing in an input or textarea
    if (["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)) return;

    if (e.code === "Space") {
      e.preventDefault();
      toggleTimer();
    } else if (e.key === "c" || e.key === "C" || e.key === "1") {
      e.preventDefault();
      adjudicate("correct");
    } else if (e.key === "x" || e.key === "X" || e.key === "2") {
      e.preventDefault();
      adjudicate("incorrect");
    } else if (e.key === "p" || e.key === "P" || e.key === "3") {
      e.preventDefault();
      adjudicate("timeout_or_pass");
    } else if (e.key === "n" || e.key === "N") {
      e.preventDefault();
      navigateQuestion(1);
    } else if (e.key === "b" || e.key === "B") {
      e.preventDefault();
      navigateQuestion(-1);
    } else if (e.key === "r" || e.key === "R") {
      e.preventDefault();
      resetTimer();
    } else if (e.key === "s" || e.key === "S") {
      e.preventDefault();
      revealQuestionOnProjector();
    }
  });
}

document.addEventListener("DOMContentLoaded", initAdmin);
