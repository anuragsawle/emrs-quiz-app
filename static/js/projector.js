/**
 * EMRS Quiz - Big Screen Projector View Controller
 * Real-time WebSocket synchronization, animated countdown, and sound effects.
 */

let ws = null;
let currentState = null;
let localTimerInterval = null;
let displayedTime = 60;
let isAnswerRevealed = false;

function initProjector() {
  connectWebSocket();
  setupKeyboardShortcuts();
  fetchInitialState();
}

async function fetchInitialState() {
  try {
    const res = await fetch("/api/admin/final/state");
    const data = await res.json();
    if (data.state) {
      currentState = data.state;
      renderProjectorState(currentState);
    }
  } catch (e) {
    console.error("Initial fetch error", e);
  }
}

function connectWebSocket() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${protocol}//${window.location.host}/ws`;

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    document.getElementById("connection-status").textContent = "CONNECTED (LIVE)";
    document.getElementById("connection-status").className = "badge badge-green";
  };

  ws.onclose = () => {
    document.getElementById("connection-status").textContent = "RECONNECTING...";
    document.getElementById("connection-status").className = "badge badge-red";
    setTimeout(connectWebSocket, 2000);
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleWsMessage(msg);
    } catch (e) {
      console.error("WS Parse error", e);
    }
  };
}

function handleWsMessage(msg) {
  if (msg.type === "INIT_STATE") {
    currentState = msg.final_state;
    renderProjectorState(currentState);
  } else if (msg.type === "FINAL_STATE_UPDATE") {
    currentState = msg.data;
    renderProjectorState(currentState);

    // Audio triggers
    if (msg.sound === "CORRECT") {
      window.quizAudio.playCorrect();
    } else if (msg.sound === "WRONG") {
      window.quizAudio.playWrong();
    } else if (msg.sound === "PASS") {
      window.quizAudio.playPass();
    } else if (msg.sound === "BUZZER") {
      window.quizAudio.playBuzzer();
    } else if (msg.sound === "CHIME") {
      window.quizAudio.playReveal();
    }
  } else if (msg.type === "TIMER_TICK") {
    updateTimerDisplay(msg.time_remaining);
    if (msg.time_remaining <= 5 && msg.time_remaining > 0) {
      window.quizAudio.playTick();
    }
  } else if (msg.type === "PROJECTOR_MEDIA_CONTROL") {
    const audio = document.getElementById("projector-audio-player");
    const btn = document.getElementById("projector-audio-btn");
    if (audio) {
      if (msg.action === "play") {
        audio.play().catch(() => {});
        if (btn) btn.innerHTML = "⏸️ Pause Audio Clip";
      } else if (msg.action === "pause" || msg.action === "stop") {
        audio.pause();
        if (btn) btn.innerHTML = "▶️ Play Audio Clip";
      }
    }
  }
}

function renderProjectorState(state) {
  if (!state) return;

  const q = state.question;
  const activeSlot = state.active_team_slot;
  const turnType = state.turn_type;
  const finalists = state.finalists || [];
  const status = state.question_status;

  const isVisible = Boolean(state.is_question_visible);
  const hiddenPrompt = document.getElementById("projector-hidden-prompt");
  const qTextEl = document.getElementById("projector-q-text");
  const mediaContainer = document.getElementById("projector-media-container");
  const optContainer = document.getElementById("projector-options-grid");
  const explBox = document.getElementById("projector-explanation-box");

  // 1. Update 5 Competition Rounds Stage Bar
  const rounds = state.rounds || [];
  const currentRound = state.current_round;

  if (rounds.length > 0) {
    rounds.forEach(r => {
      const pill = document.getElementById(`stage-round-${r.round_number}`);
      const countEl = document.getElementById(`round-count-${r.round_number}`);
      if (countEl) countEl.textContent = `${r.total_questions} Questions`;

      if (pill) {
        if (r.is_active) {
          pill.style.background = "#1e293b";
          pill.style.borderColor = r.color || "#38bdf8";
          pill.style.boxShadow = `0 0 25px ${r.color || '#38bdf8'}66`;
          pill.style.transform = "scale(1.04)";
        } else {
          pill.style.background = "#0f172a";
          pill.style.borderColor = "#334155";
          pill.style.boxShadow = "none";
          pill.style.transform = "scale(1)";
        }
      }
    });

    const selectRoundEl = document.getElementById("proj-select-round");
    if (selectRoundEl && currentRound) {
      selectRoundEl.value = currentRound.round_number;
    }
  }

  // 2. Question Header, Round, Number & Category
  if (q) {
    const roundName = q.round_name || (currentRound ? currentRound.name : "Indian Culture");
    const roundNum = q.round_number || (currentRound ? currentRound.round_number : 1);
    const roundColor = q.round_color || (currentRound ? currentRound.color : "#10b981");
    const roundQIdx = q.round_question_index || q.question_number;
    const roundTotalQ = q.round_total_questions || 6;

    const roundBadge = document.getElementById("proj-round-badge");
    if (roundBadge) {
      roundBadge.textContent = `ROUND ${roundNum}: ${roundName.toUpperCase()}`;
      roundBadge.style.background = roundColor;
      roundBadge.style.boxShadow = `0 0 16px ${roundColor}55`;
    }

    const qNumBadge = document.getElementById("q-number-badge");
    if (qNumBadge) {
      qNumBadge.textContent = `QUESTION ${roundQIdx} OF ${roundTotalQ}`;
    }

    const qOverallBadge = document.getElementById("q-overall-badge");
    if (qOverallBadge) {
      qOverallBadge.textContent = `(Overall Q${q.question_number} of ${state.total_questions})`;
    }

    const catBadge = document.getElementById("q-category-badge");
    if (catBadge) {
      catBadge.textContent = q.category || "General";
    }

    if (!isVisible) {
      if (hiddenPrompt) hiddenPrompt.style.display = "block";
      if (qTextEl) qTextEl.style.display = "none";
      if (mediaContainer) {
        mediaContainer.style.display = "none";
        mediaContainer.innerHTML = "";
      }
      if (optContainer) optContainer.style.display = "none";
      if (explBox) explBox.style.display = "none";
      const audioPlayer = document.getElementById("projector-audio-player");
      if (audioPlayer) audioPlayer.pause();
    } else {
      if (hiddenPrompt) hiddenPrompt.style.display = "none";
      if (qTextEl) {
        qTextEl.style.display = "block";
        qTextEl.textContent = q.text;
      }
      if (optContainer) optContainer.style.display = "grid";

      // Render Question Media (Image or Audio for Projector Quiz)
      const audioPlayer = document.getElementById("projector-audio-player");

      if (mediaContainer) {
        if (q.media_type === "image" && q.media_url) {
          mediaContainer.style.display = "block";
          mediaContainer.innerHTML = `
            <img src="${q.media_url}" alt="Question Image" style="max-height:280px; max-width:100%; border-radius:12px; border:2px solid #38bdf8; box-shadow:0 0 35px rgba(56, 189, 248, 0.4); object-fit:contain;">
          `;
          if (audioPlayer) audioPlayer.pause();
        } else if (q.media_type === "audio" && q.media_url) {
          mediaContainer.style.display = "block";
          mediaContainer.innerHTML = `
            <div style="background:#1e293b; border:2px solid #f59e0b; border-radius:12px; padding:1.25rem 2rem; display:inline-flex; align-items:center; justify-content:center; gap:1.5rem; box-shadow:0 0 30px rgba(245, 158, 11, 0.35);">
              <button id="projector-audio-btn" class="btn btn-warning" style="font-size:1.15rem; font-weight:800; padding:0.65rem 1.75rem; border-radius:30px;" onclick="toggleProjectorAudio()">
                &#9654;&#65039; Play Audio Clip
              </button>
              <span style="font-size:1.15rem; color:#fde68a; font-weight:700;">&#127925; Listen carefully to the audio clip</span>
            </div>
          `;
          if (audioPlayer) {
            const expectedSrc = q.media_url.startsWith("http") ? q.media_url : window.location.origin + q.media_url;
            if (audioPlayer.src !== expectedSrc) {
              audioPlayer.src = q.media_url;
            }
          }
        } else {
          mediaContainer.style.display = "none";
          mediaContainer.innerHTML = "";
          if (audioPlayer) audioPlayer.pause();
        }
      }

      // Options
      optContainer.innerHTML = "";

      const letters = ["A", "B", "C", "D"];
      const isEnded = status === "ended";
      const answerHint = document.getElementById("projector-answer-hint");

      if (answerHint) {
        answerHint.style.display = (isVisible && !isEnded) ? "block" : "none";
      }

      q.options.forEach((optText, idx) => {
        const card = document.createElement("div");
        card.className = "projector-opt-card";
        card.setAttribute("role", "button");
        card.setAttribute("tabindex", isEnded ? "-1" : "0");
        card.setAttribute("data-opt-index", idx);

        let tagHtml = "";
        if (isEnded) {
          card.classList.add("disabled");
          if (idx === q.correct_index) {
            card.classList.add("correct-revealed");
            tagHtml = `<span class="projector-opt-tag tag-correct">&#10004; CORRECT ANSWER</span>`;
          } else if (idx === localSelectedOption) {
            card.classList.add("incorrect-revealed");
            tagHtml = `<span class="projector-opt-tag tag-incorrect">&#10006; SELECTED (WRONG)</span>`;
          }
        } else {
          // Live interactive option!
          card.onclick = () => projectorSelectOption(idx);
        }

        card.innerHTML = `
          <div class="projector-opt-letter">${letters[idx]}</div>
          <div class="projector-opt-text">${optText}</div>
          ${tagHtml}
        `;
        optContainer.appendChild(card);
      });

      // Explanation if ended
      if (isEnded && q.explanation) {
        explBox.style.display = "block";
        explBox.innerHTML = `<strong>Answer Key:</strong> Option ${letters[q.correct_index]} &bull; ${q.explanation}`;
      } else {
        explBox.style.display = "none";
      }
    }
  } else {
    if (hiddenPrompt) hiddenPrompt.style.display = "none";
    if (qTextEl) {
      qTextEl.style.display = "block";
      qTextEl.textContent = "Awaiting Quiz Master to load Question...";
    }
    const answerHint = document.getElementById("projector-answer-hint");
    if (answerHint) answerHint.style.display = "none";
    if (optContainer) optContainer.innerHTML = "";
    if (explBox) explBox.style.display = "none";
  }

  // 2. Active Team Spotlight Banner
  const finalistsMap = {};
  finalists.forEach(f => { finalistsMap[f.finalist_slot] = f; });
  const activeTeam = finalistsMap[activeSlot];

  const teamTitleEl = document.getElementById("spotlight-team-title");
  const turnBadgeEl = document.getElementById("spotlight-turn-type");

  if (activeTeam) {
    teamTitleEl.textContent = `TURN: [T${activeSlot}] ${activeTeam.name}`;
  } else {
    teamTitleEl.textContent = `TURN: TEAM ${activeSlot}`;
  }

  const passCount = (state.pass_history || []).length;
  const currentMarks = state.current_marks || (passCount === 0 ? 10 : (passCount === 1 ? 5 : 2));

  if (turnType === "main") {
    turnBadgeEl.className = "spotlight-turn-type turn-main";
    turnBadgeEl.textContent = "MAIN TURN • 10 MARKS (60s)";
  } else if (passCount === 1) {
    turnBadgeEl.className = "spotlight-turn-type turn-pass";
    turnBadgeEl.textContent = "1ST PASS • 5 MARKS (5s)";
  } else {
    turnBadgeEl.className = "spotlight-turn-type turn-pass";
    turnBadgeEl.textContent = "2ND PASS (FINAL) • 2 MARKS (5s)";
  }

  // Question outcome status banner
  const statusBanner = document.getElementById("question-status-banner");
  if (status === "ended") {
    if (state.winning_team_slot) {
      const winner = finalistsMap[state.winning_team_slot];
      const winningEntry = (state.pass_history || []).find(h => h.result === "correct");
      const awardedMarks = winningEntry ? winningEntry.marks : currentMarks;
      statusBanner.innerHTML = `<span style="color:#10b981; font-weight:800;">&#10004; CORRECT ANSWER! +${awardedMarks} Marks awarded to ${winner ? winner.name : 'Team '+state.winning_team_slot}</span>`;
    } else {
      statusBanner.innerHTML = `<span style="color:#ef4444; font-weight:800;">&#10006; QUESTION ENDED (No marks awarded)</span>`;
    }
    statusBanner.style.display = "block";
  } else {
    statusBanner.style.display = "none";
  }

  // Update Autonomous Stage Toolbar Buttons on Projector Screen
  const btnPrev = document.getElementById("proj-btn-prev");
  const btnNext = document.getElementById("proj-btn-next");
  const btnResetQ = document.getElementById("proj-btn-reset-q");
  const btnShowToggle = document.getElementById("proj-btn-show-toggle");
  const btnTimerToggle = document.getElementById("proj-btn-timer-toggle");
  const btnAdjCorrect = document.getElementById("proj-btn-adj-correct");
  const btnAdjWrong = document.getElementById("proj-btn-adj-wrong");
  const btnAdjPass = document.getElementById("proj-btn-adj-pass");

  if (btnPrev) btnPrev.disabled = state.question_index <= 0;
  if (btnNext) btnNext.disabled = state.question_index >= state.total_questions - 1;

  if (btnShowToggle) {
    if (!isVisible) {
      btnShowToggle.textContent = "👁️ Show Question [Space]";
      btnShowToggle.className = "btn btn-success";
      btnShowToggle.onclick = projectorShowQuestion;
    } else {
      btnShowToggle.textContent = "🔒 Hide Question";
      btnShowToggle.className = "btn btn-secondary";
      btnShowToggle.onclick = projectorHideQuestion;
    }
  }

  if (btnTimerToggle) {
    btnTimerToggle.disabled = !isVisible || isEnded;
    btnTimerToggle.textContent = state.timer_is_running ? "⏸️ Pause [P]" : "▶️ Resume [P]";
  }

  if (btnAdjCorrect) {
    btnAdjCorrect.disabled = !isVisible || isEnded;
    btnAdjCorrect.innerHTML = `&#10004; Correct (+${currentMarks})`;
  }
  if (btnAdjWrong) btnAdjWrong.disabled = !isVisible || isEnded;
  if (btnAdjPass) {
    btnAdjPass.disabled = !isVisible || isEnded;
    if (passCount === 0) {
      btnAdjPass.innerHTML = `&#9201; Pass to 1st (5s &bull; 5pts) [T]`;
    } else if (passCount === 1) {
      btnAdjPass.innerHTML = `&#9201; Pass to 2nd (5s &bull; 2pts) [T]`;
    } else {
      btnAdjPass.innerHTML = `&#9201; End (Max 2 Passes) [T]`;
    }
  }

  // 3. Timer Display
  updateTimerDisplay(state.time_remaining_seconds);

  // 4. Pass Sequence Trail
  renderPassTrail(state);

  // 5. Live Scoreboard
  renderScoreboard(finalists, state.winning_team_slot);
}

function updateTimerDisplay(seconds) {
  displayedTime = Math.max(0, seconds);
  const timerNumEl = document.getElementById("timer-number");
  const timerCircleEl = document.getElementById("timer-circle");

  if (timerNumEl) timerNumEl.textContent = displayedTime;

  if (timerCircleEl) {
    if (displayedTime <= 5 && displayedTime > 0) {
      timerCircleEl.className = "timer-circle danger";
    } else {
      timerCircleEl.className = "timer-circle";
    }
  }
}

function renderPassTrail(state) {
  const container = document.getElementById("pass-trail-slots");
  if (!container) return;
  container.innerHTML = "";

  const firstSlot = state.first_team_slot;
  const activeSlot = state.active_team_slot;
  const fullSeq = state.full_sequence || [firstSlot];
  const passHistory = state.pass_history || [];
  const status = state.question_status;

  const finalistsMap = {};
  (state.finalists || []).forEach(f => { finalistsMap[f.finalist_slot] = f; });

  const historyMap = {};
  passHistory.forEach(h => { historyMap[h.slot] = h.result; });

  const marksLabels = ["10 pts", "5 pts", "2 pts"];

  fullSeq.forEach((slot, orderIdx) => {
    const item = document.createElement("div");
    item.className = "slot-item";
    const t = finalistsMap[slot];
    const teamName = t ? t.name : `Team ${slot}`;

    const turnLabel = orderIdx === 0 ? "Main Turn" : `Pass ${orderIdx}`;
    const ptsLabel = marksLabels[orderIdx] || "";
    const label = `[T${slot}] ${teamName} (${turnLabel} &bull; ${ptsLabel})`;

    let statusText = "";
    const h = historyMap[slot];
    if (h && h.result === "correct") {
      item.classList.add("correct");
      statusText = `<span class="badge badge-green">CORRECT (+${h.marks || 10})</span>`;
    } else if (h && h.result === "incorrect") {
      item.classList.add("passed");
      statusText = `<span class="badge badge-red">WRONG</span>`;
    } else if (h && h.result === "timeout") {
      item.classList.add("passed");
      statusText = `<span class="badge badge-gold">PASSED</span>`;
    } else if (slot === activeSlot && status !== "ended") {
      item.classList.add("active");
      statusText = `<span class="badge badge-blue">ACTIVE (${ptsLabel})</span>`;
    } else {
      statusText = `<span style="color:#64748b; font-size:0.8rem;">PENDING</span>`;
    }

    item.innerHTML = `
      <span>${label}</span>
      <span>${statusText}</span>
    `;
    container.appendChild(item);
  });
}

function renderScoreboard(finalists, winningSlot) {
  const tbody = document.getElementById("projector-scoreboard-rows");
  if (!tbody) return;
  tbody.innerHTML = "";

  // Sort finalists by final score descending
  const sorted = [...finalists].sort((a, b) => b.final_score - a.final_score);

  sorted.forEach((team, rank) => {
    const tr = document.createElement("tr");
    const isWinner = team.finalist_slot === winningSlot;
    if (isWinner) {
      tr.style.background = "rgba(16, 185, 129, 0.15)";
    }

    tr.innerHTML = `
      <td style="color:#94a3b8; font-weight:700;">#${rank + 1}</td>
      <td><strong>[T${team.finalist_slot}]</strong> ${team.name}</td>
      <td class="score-pts">${team.final_score}</td>
    `;
    tbody.appendChild(tr);
  });
}

function toggleProjectorAudio() {
  const audio = document.getElementById("projector-audio-player");
  const btn = document.getElementById("projector-audio-btn");
  if (!audio) return;
  if (audio.paused) {
    audio.play().catch(() => {});
    if (btn) btn.innerHTML = "⏸️ Pause Audio Clip";
  } else {
    audio.pause();
    if (btn) btn.innerHTML = "▶️ Play Audio Clip";
  }
}

// =============================================================================
// AUTONOMOUS PROJECTOR SCREEN CONTROLS (Zero Admin dependency)
// =============================================================================
async function projectorShowQuestion() {
  try {
    const res = await fetch("/api/admin/final/reveal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reveal" })
    });
    const data = await res.json();
    if (data.success) {
      currentState = data.state;
      renderProjectorState(currentState);
      if (window.quizAudio) window.quizAudio.playReveal();
    }
  } catch (e) {
    console.error("Show question error", e);
  }
}

async function projectorHideQuestion() {
  try {
    const res = await fetch("/api/admin/final/reveal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "hide" })
    });
    const data = await res.json();
    if (data.success) {
      currentState = data.state;
      renderProjectorState(currentState);
    }
  } catch (e) {
    console.error("Hide question error", e);
  }
}

async function projectorSelectRound(roundNumber) {
  if (!currentState) return;
  localSelectedOption = null;
  isAnswerRevealed = false;
  try {
    const res = await fetch("/api/admin/final/load_round", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ round_number: parseInt(roundNumber) })
    });
    const data = await res.json();
    if (data.success && data.state) {
      currentState = data.state;
      renderProjectorState(currentState);
      if (window.quizAudio) window.quizAudio.playReveal();
    }
  } catch (e) {
    console.error("Select round error", e);
  }
}

async function projectorNavigate(delta) {
  if (!currentState) return;
  const newIdx = currentState.question_index + delta;
  if (newIdx < 0 || newIdx >= currentState.total_questions) return;
  localSelectedOption = null;
  isAnswerRevealed = false;
  try {
    const res = await fetch("/api/admin/final/load_question", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question_index: newIdx })
    });
    const data = await res.json();
    if (data.success) {
      currentState = data.state;
      renderProjectorState(currentState);
    }
  } catch (e) {
    console.error("Navigation error", e);
  }
}

async function projectorResetQuestion() {
  if (!currentState) return;
  localSelectedOption = null;
  isAnswerRevealed = false;
  try {
    const res = await fetch("/api/admin/final/load_question", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question_index: currentState.question_index })
    });
    const data = await res.json();
    if (data.success) {
      currentState = data.state;
      renderProjectorState(currentState);
      if (window.quizAudio) window.quizAudio.playReveal();
    }
  } catch (e) {
    console.error("Reset question error", e);
  }
}

let localSelectedOption = null;

async function projectorSelectOption(idx) {
  if (!currentState || !currentState.question) return;
  if (!currentState.is_question_visible) {
    projectorShowQuestion();
    return;
  }
  if (currentState.question_status === "ended") return;

  const q = currentState.question;
  const isCorrect = (idx === q.correct_index);
  localSelectedOption = idx;

  const passCount = (currentState.pass_history || []).length;
  const currentMarks = currentState.current_marks || (passCount === 0 ? 10 : (passCount === 1 ? 5 : 2));

  // Immediate visual feedback on stage
  const letters = ["A", "B", "C", "D"];
  const cards = document.querySelectorAll(".projector-opt-card");
  cards.forEach((c, cIdx) => {
    c.classList.add("disabled");
    c.onclick = null;
    if (cIdx === idx) {
      if (isCorrect) {
        c.classList.add("correct-revealed");
        c.innerHTML = `
          <div class="projector-opt-letter">${letters[cIdx]}</div>
          <div class="projector-opt-text">${q.options[cIdx]}</div>
          <span class="projector-opt-tag tag-correct">&#10004; CORRECT (+${currentMarks})</span>
        `;
      } else {
        c.classList.add("incorrect-revealed");
        c.innerHTML = `
          <div class="projector-opt-letter">${letters[cIdx]}</div>
          <div class="projector-opt-text">${q.options[cIdx]}</div>
          <span class="projector-opt-tag tag-incorrect">&#10006; INCORRECT (0)</span>
        `;
      }
    }
    // Also highlight the true correct answer if wrong answer was chosen
    if (!isCorrect && cIdx === q.correct_index) {
      c.classList.add("correct-revealed");
      c.innerHTML = `
        <div class="projector-opt-letter">${letters[cIdx]}</div>
        <div class="projector-opt-text">${q.options[cIdx]}</div>
        <span class="projector-opt-tag tag-correct">&#10004; CORRECT ANSWER</span>
      `;
    }
  });

  // Play appropriate sound immediately
  if (isCorrect) {
    if (window.quizAudio) window.quizAudio.playCorrect();
  } else {
    if (window.quizAudio) window.quizAudio.playWrong();
  }

  // Submit adjudication to server
  try {
    const decision = isCorrect ? "correct" : "incorrect";
    const res = await fetch("/api/admin/final/adjudicate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision })
    });
    const data = await res.json();
    if (data.success && data.state) {
      currentState = data.state;
      renderProjectorState(currentState);
    }
  } catch (err) {
    console.error("Option adjudication error:", err);
  }
}

async function projectorAdjudicate(decision) {
  if (!currentState || !currentState.question) return;
  if (currentState.question_status === "ended") return;

  if (decision === "correct") {
    if (window.quizAudio) window.quizAudio.playCorrect();
  } else if (decision === "incorrect") {
    if (window.quizAudio) window.quizAudio.playWrong();
  } else if (decision === "timeout_or_pass") {
    if (window.quizAudio) window.quizAudio.playPass();
  }

  try {
    const res = await fetch("/api/admin/final/adjudicate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision })
    });
    const data = await res.json();
    if (data.success && data.state) {
      currentState = data.state;
      renderProjectorState(currentState);
    }
  } catch (e) {
    console.error("Stage adjudicate error", e);
  }
}

async function projectorToggleTimer() {
  if (!currentState) return;
  const action = currentState.timer_is_running ? "pause" : "start";
  try {
    const res = await fetch("/api/admin/final/timer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action })
    });
    const data = await res.json();
    if (data.success) {
      currentState = data.state;
      renderProjectorState(currentState);
    }
  } catch (e) {
    console.error("Timer toggle error", e);
  }
}

async function projectorResetTimer() {
  try {
    const res = await fetch("/api/admin/final/timer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reset" })
    });
    const data = await res.json();
    if (data.success) {
      currentState = data.state;
      renderProjectorState(currentState);
    }
  } catch (e) {
    console.error("Reset timer error", e);
  }
}

function projectorToggleAnswer() {
  isAnswerRevealed = !isAnswerRevealed;
  renderAnswerKeyOnStage();
}

function renderAnswerKeyOnStage() {
  if (!currentState || !currentState.question) return;
  const q = currentState.question;
  const cards = document.querySelectorAll(".projector-opt-card");
  const explBox = document.getElementById("projector-explanation-box");
  const letters = ["A", "B", "C", "D"];

  cards.forEach((card, idx) => {
    if (isAnswerRevealed && idx === q.correct_index) {
      card.classList.add("correct-revealed");
    } else {
      card.classList.remove("correct-revealed");
    }
  });

  if (explBox) {
    if (isAnswerRevealed) {
      explBox.style.display = "block";
      explBox.innerHTML = `<strong>Correct Answer:</strong> Option ${letters[q.correct_index]} &bull; ${q.explanation || ''}`;
      if (window.quizAudio) window.quizAudio.playCorrect();
    } else {
      explBox.style.display = "none";
    }
  }
}

function setupKeyboardShortcuts() {
  window.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;

    const key = e.key.toUpperCase();
    const isQuestionActive = currentState && currentState.is_question_visible && currentState.question_status !== "ended";

    if (key === " " || e.code === "Space" || key === "ENTER") {
      e.preventDefault();
      if (!currentState || !currentState.is_question_visible) {
        projectorShowQuestion();
      } else {
        projectorToggleTimer();
      }
    } else if (key === "1" || (key === "A" && isQuestionActive)) {
      e.preventDefault();
      projectorSelectOption(0);
    } else if (key === "2" || (key === "B" && isQuestionActive)) {
      e.preventDefault();
      projectorSelectOption(1);
    } else if (key === "3" || (key === "C" && isQuestionActive)) {
      e.preventDefault();
      projectorSelectOption(2);
    } else if (key === "4" || (key === "D" && isQuestionActive)) {
      e.preventDefault();
      projectorSelectOption(3);
    } else if (e.key === "ArrowRight" || (key === "N" && !isQuestionActive)) {
      e.preventDefault();
      projectorNavigate(1);
    } else if (e.key === "ArrowLeft" || (key === "B" && !isQuestionActive)) {
      e.preventDefault();
      projectorNavigate(-1);
    } else if (key === "P") {
      e.preventDefault();
      projectorToggleTimer();
    } else if (key === "R") {
      e.preventDefault();
      projectorResetQuestion();
    } else if (key === "T") {
      e.preventDefault();
      projectorAdjudicate("timeout_or_pass");
    } else if (key === "K") {
      e.preventDefault();
      projectorToggleAnswer();
    } else if (key === "F") {
      e.preventDefault();
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
      } else {
        document.exitFullscreen().catch(() => {});
      }
    } else if (key === "M") {
      e.preventDefault();
      const enabled = window.quizAudio.toggleSound();
      const soundBadge = document.getElementById("sound-status");
      if (soundBadge) {
        soundBadge.textContent = enabled ? "SOUND: ON [M]" : "SOUND: MUTED [M]";
        soundBadge.className = enabled ? "badge badge-blue" : "badge badge-red";
      }
    }
  });

  // Enable audio context on first click anywhere
  window.addEventListener("click", () => {
    window.quizAudio.init();
  }, { once: true });
}

document.addEventListener("DOMContentLoaded", initProjector);
