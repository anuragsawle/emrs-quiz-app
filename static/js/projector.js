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
    if (msg.event === "LOAD_QUESTION" || msg.event === "LOAD_ROUND" || (msg.event && msg.event.startsWith("ADJUDICATE_"))) {
      closeWrongPassOverlay();
    }
    renderProjectorState(currentState);

    // If countdown timer reached 0 -> Open interactive TIME OVER modal with team name
    if ((msg.event === "TIME_OVER" || msg.event === "TIMEOUT") && currentState) {
      if (currentState.question_status === "in_progress") {
        const nextInfo = getNextPassInfo(currentState);
        pendingWrongPass = { decision: "timeout_or_pass" };
        openWrongPassOverlay("timeout", nextInfo, null);
      }
    }

    // If pass was triggered from Admin Console, flash stage toast banner
    if ((msg.event === "ADJUDICATE_INCORRECT" || msg.event === "ADJUDICATE_TIMEOUT_OR_PASS") && currentState && currentState.question_status === "in_progress") {
      if (!justConfirmedLocalWrongPass) {
        const nextTeam = currentState.active_team;
        const nextName = nextTeam ? `[T${currentState.active_team_slot}] ${nextTeam.name}` : `Team ${currentState.active_team_slot}`;
        const pCount = (currentState.pass_history || []).length;
        const nextMarks = currentState.current_marks || (pCount === 1 ? 5 : 2);
        showProjectorPassToast(`⚠️ PASSED to ${nextName} (Pass ${pCount}/2 • ${nextMarks} Marks)`);
      }
      justConfirmedLocalWrongPass = false;
    }

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
      if (countEl) {
        if (r.completed_count !== undefined && r.completed_count > 0) {
          countEl.textContent = `${r.completed_count}/${r.total_questions} Done`;
        } else {
          countEl.textContent = `${r.total_questions} Questions`;
        }
      }

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

    const isEnded = status === "ended" || Boolean(state.is_locked);
    const isOptionsVisible = (isEnded || state.is_options_visible !== undefined) ? Boolean(state.is_options_visible || isEnded) : (isVisible || isEnded);
    const isMediaQuestion = Boolean(state.is_media_question || q.is_media_question);
    const showOptionsPrompt = document.getElementById("projector-show-options-prompt");
    const hiddenIcon = document.getElementById("projector-hidden-icon");
    const hiddenDesc = document.getElementById("projector-hidden-desc");
    const mainShowBtn = document.getElementById("projector-main-show-btn");
    const answerHint = document.getElementById("projector-answer-hint");
    const lockedCard = document.getElementById("projector-locked-card");

    if (!isVisible && !isEnded) {
      if (hiddenPrompt) hiddenPrompt.style.display = "block";
      if (showOptionsPrompt) showOptionsPrompt.style.display = "none";
      if (answerHint) answerHint.style.display = "none";
      if (lockedCard) lockedCard.style.display = "none";

      if (isMediaQuestion) {
        if (hiddenIcon) hiddenIcon.innerHTML = q.media_type === "audio" ? "&#127925;" : "&#128444;&#65039;";
        if (hiddenDesc) hiddenDesc.textContent = "Click below to display the media & question first. Then click Show Options to start the 60-second timer.";
        if (mainShowBtn) mainShowBtn.innerHTML = "&#128065;&#65039; SHOW MEDIA &amp; QUESTION";
      } else {
        if (hiddenIcon) hiddenIcon.innerHTML = "&#127917;";
        if (hiddenDesc) hiddenDesc.textContent = "Click the button below to display the question to the teams and start the 60-second timer.";
        if (mainShowBtn) mainShowBtn.innerHTML = "&#128065;&#65039; SHOW QUESTION &bull; START TIMER";
      }

      if (qTextEl) qTextEl.style.display = "none";
      if (mediaContainer) {
        mediaContainer.style.display = "none";
        mediaContainer.innerHTML = "";
        mediaContainer.dataset.mediaKey = "";
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

      // Render Question Media (Image or Audio for Projector Quiz)
      const audioPlayer = document.getElementById("projector-audio-player");

      if (mediaContainer) {
        const mediaKey = `${q.id || state.question_index}:${q.media_type}:${q.media_url || ""}`;
        if (q.media_type === "image" && q.media_url) {
          mediaContainer.style.display = "block";
          if (mediaContainer.dataset.mediaKey !== mediaKey) {
            mediaContainer.dataset.mediaKey = mediaKey;
            mediaContainer.innerHTML = `
              <img src="${q.media_url}" alt="Question Image" style="max-height:290px; max-width:100%; border-radius:12px; border:2px solid #38bdf8; box-shadow:0 0 35px rgba(56, 189, 248, 0.4); object-fit:contain;">
            `;
          }
          if (audioPlayer) audioPlayer.pause();
        } else if (q.media_type === "audio" && q.media_url) {
          mediaContainer.style.display = "block";
          if (mediaContainer.dataset.mediaKey !== mediaKey) {
            mediaContainer.dataset.mediaKey = mediaKey;
            mediaContainer.innerHTML = `
              <div style="background:#1e293b; border:2px solid #f59e0b; border-radius:12px; padding:1.25rem 2rem; display:inline-flex; align-items:center; justify-content:center; gap:1.5rem; box-shadow:0 0 30px rgba(245, 158, 11, 0.35);">
                <button id="projector-audio-btn" class="btn btn-warning" style="font-size:1.15rem; font-weight:800; padding:0.65rem 1.75rem; border-radius:30px;" onclick="toggleProjectorAudio()">
                  &#9654;&#65039; Play Audio Clip
                </button>
                <span style="font-size:1.15rem; color:#fde68a; font-weight:700;">&#127925; Listen carefully to the audio clip</span>
              </div>
            `;
          }
          if (audioPlayer) {
            const expectedSrc = q.media_url.startsWith("http") ? q.media_url : window.location.origin + q.media_url;
            if (audioPlayer.src !== expectedSrc) {
              audioPlayer.src = q.media_url;
            }
          }
        } else {
          mediaContainer.style.display = "none";
          mediaContainer.innerHTML = "";
          mediaContainer.dataset.mediaKey = "";
          if (audioPlayer) audioPlayer.pause();
        }
      }

      if (!isOptionsVisible && !isEnded) {
        // Audio / Visual Step 1: Show Media & Question first; show "Show Options" button; timer paused!
        if (showOptionsPrompt) showOptionsPrompt.style.display = "block";
        if (optContainer) {
          optContainer.style.display = "none";
          optContainer.innerHTML = "";
        }
        if (answerHint) answerHint.style.display = "none";
        if (explBox) explBox.style.display = "none";
        if (lockedCard) lockedCard.style.display = "none";
      } else {
        // Step 2 (or Text question or Ended/Locked): Show Options & Interactive Answer Cards!
        if (showOptionsPrompt) showOptionsPrompt.style.display = "none";
        if (optContainer) {
          optContainer.style.display = "grid";
          optContainer.innerHTML = "";
        }

        const letters = ["A", "B", "C", "D"];
        const lockInfo = state.lock_info || {};

        // Collect options already chosen incorrectly on earlier turns of this question
        const wrongSelectedOptions = new Set();
        (state.pass_history || []).forEach(h => {
          if (h.result === "incorrect" && h.selected_option !== undefined && h.selected_option !== null) {
            wrongSelectedOptions.add(Number(h.selected_option));
          }
        });
        if (lockInfo && lockInfo.selected_option !== undefined && lockInfo.status !== "correct") {
          wrongSelectedOptions.add(Number(lockInfo.selected_option));
        }

        if (answerHint) {
          answerHint.style.display = (!isEnded && isOptionsVisible) ? "block" : "none";
        }

        q.options.forEach((optText, idx) => {
          const card = document.createElement("div");
          card.className = "projector-opt-card";
          card.setAttribute("role", "button");
          const isAlreadyWrong = wrongSelectedOptions.has(idx);
          card.setAttribute("data-opt-index", idx);

          let tagHtml = "";
          if (isEnded) {
            card.classList.add("disabled");
            card.style.pointerEvents = "none";
            card.style.cursor = "not-allowed";
            card.setAttribute("tabindex", "-1");
            if (idx === q.correct_index) {
              card.classList.add("correct-revealed");
              const isWinnerSelected = Boolean(state.winning_team_slot && (
                (lockInfo && Number(lockInfo.selected_option) === idx) ||
                (state.pass_history || []).some(h => h.result === "correct" && Number(h.selected_option) === idx) ||
                idx === localSelectedOption
              ));
              const awardedMarks = (lockInfo && lockInfo.awarded_marks !== undefined && lockInfo.awarded_marks !== null)
                ? lockInfo.awarded_marks
                : (state.current_marks || 10);
              tagHtml = isWinnerSelected
                ? `<span class="projector-opt-tag tag-correct">&#10004; WINNING ANSWER (+${awardedMarks})</span>`
                : `<span class="projector-opt-tag tag-correct">&#10004; CORRECT ANSWER</span>`;
            } else if (isAlreadyWrong || (lockInfo && Number(lockInfo.selected_option) === idx) || idx === localSelectedOption) {
              card.classList.add("incorrect-revealed");
              tagHtml = `<span class="projector-opt-tag tag-incorrect">&#10006; WRONG ATTEMPT</span>`;
            }
          } else if (isAlreadyWrong) {
            card.classList.add("disabled");
            card.classList.add("incorrect-revealed");
            card.setAttribute("tabindex", "-1");
            tagHtml = `<span class="projector-opt-tag tag-incorrect">&#10006; WRONG (PASSED)</span>`;
          } else {
            // Live interactive option!
            card.setAttribute("tabindex", "0");
            card.onclick = () => projectorSelectOption(idx);
          }

          card.innerHTML = `
            <div class="projector-opt-letter">${letters[idx]}</div>
            <div class="projector-opt-text">${optText}</div>
            ${tagHtml}
          `;
          optContainer.appendChild(card);
        });

        // Prominent Locked Question Card display
        if (isEnded && lockedCard) {
          lockedCard.style.display = "block";
          const lockedHeadline = document.getElementById("locked-headline");
          const lockedMarksBadge = document.getElementById("locked-marks-badge");
          const lockedTeamsTrail = document.getElementById("locked-teams-trail");
          const lockedCorrectAnswer = document.getElementById("locked-correct-answer");
          const lockedFinalStatus = document.getElementById("locked-final-status");

          const winSlot = lockInfo.winning_team_slot || state.winning_team_slot;
          const finalistsMap = {};
          finalists.forEach(f => { finalistsMap[f.finalist_slot] = f; });
          const winTeam = winSlot ? finalistsMap[winSlot] : null;
          const winName = lockInfo.winning_team_name || (winTeam ? winTeam.name : (winSlot ? `Team ${winSlot}` : null));
          const awardedMarks = (lockInfo.awarded_marks !== undefined && lockInfo.awarded_marks !== null)
            ? lockInfo.awarded_marks
            : (state.current_marks || 0);

          if (winSlot) {
            lockedCard.style.borderColor = "#10b981";
            lockedCard.style.boxShadow = "0 0 35px rgba(16, 185, 129, 0.35)";
            if (lockedHeadline) {
              lockedHeadline.innerHTML = `🏆 Correct Answer by <strong>[T${winSlot}] ${winName}</strong>`;
              lockedHeadline.style.color = "#34d399";
            }
            if (lockedMarksBadge) {
              lockedMarksBadge.textContent = `+${awardedMarks} MARKS AWARDED`;
              lockedMarksBadge.className = "badge badge-green";
              lockedMarksBadge.style.background = "#059669";
            }
            if (lockedFinalStatus) {
              lockedFinalStatus.innerHTML = `<span style="color:#10b981; font-weight:800;">✔ COMPLETED &amp; LOCKED (+${awardedMarks} pts)</span>`;
            }
          } else {
            lockedCard.style.borderColor = "#ef4444";
            lockedCard.style.boxShadow = "0 0 35px rgba(239, 68, 68, 0.35)";
            if (lockedHeadline) {
              lockedHeadline.innerHTML = `❌ Question Exhausted (No Marks Awarded)`;
              lockedHeadline.style.color = "#f87171";
            }
            if (lockedMarksBadge) {
              lockedMarksBadge.textContent = "0 MARKS";
              lockedMarksBadge.className = "badge badge-red";
              lockedMarksBadge.style.background = "#dc2626";
            }
            if (lockedFinalStatus) {
              lockedFinalStatus.innerHTML = `<span style="color:#ef4444; font-weight:800;">✖ EXHAUSTED &amp; LOCKED (0 pts)</span>`;
            }
          }

          // Format attempted by / passing trail
          if (lockedTeamsTrail) {
            const hist = (lockInfo.pass_history && lockInfo.pass_history.length > 0)
              ? lockInfo.pass_history
              : (state.pass_history || []);
            if (hist.length > 0) {
              lockedTeamsTrail.innerHTML = hist.map(h => {
                const team = finalistsMap[h.slot];
                const tName = team ? team.name : `Team ${h.slot}`;
                if (h.result === "correct") {
                  return `<span style="color:#34d399; font-weight:800;">[T${h.slot}] ${tName} (✔ +${h.marks || 10})</span>`;
                } else if (h.result === "incorrect") {
                  return `<span style="color:#f87171; font-weight:700;">[T${h.slot}] ${tName} (✖ Wrong)</span>`;
                } else {
                  return `<span style="color:#fde68a; font-weight:700;">[T${h.slot}] ${tName} (Passed)</span>`;
                }
              }).join(" &rarr; ");
            } else if (lockInfo.attempted_by) {
              lockedTeamsTrail.textContent = lockInfo.attempted_by;
            } else {
              const fSlot = state.first_team_slot;
              const fTeam = finalistsMap[fSlot];
              lockedTeamsTrail.textContent = fSlot ? `[T${fSlot}] ${fTeam ? fTeam.name : 'Team ' + fSlot}` : "None";
            }
          }

          // Format correct answer
          if (lockedCorrectAnswer) {
            const corrLetter = letters[q.correct_index] || "A";
            const corrText = q.options[q.correct_index] || "";
            lockedCorrectAnswer.innerHTML = `<span style="color:#34d399; font-weight:800;">Option ${corrLetter}:</span> ${corrText}`;
          }

          // Format time taken to answer
          const lockedTimeTaken = document.getElementById("locked-time-taken");
          if (lockedTimeTaken) {
            let tSec = lockInfo.time_taken_seconds;
            if (tSec === undefined || tSec === null) {
              const correctEntry = (lockInfo.pass_history || []).find(h => h.result === "correct");
              tSec = correctEntry ? correctEntry.time_taken_seconds : 0.0;
            }
            lockedTimeTaken.innerHTML = `<span style="color:#38bdf8; font-weight:800;">${Number(tSec || 0).toFixed(1)}s</span>`;
          }
        } else if (lockedCard) {
          lockedCard.style.display = "none";
        }

        // Explanation if ended
        if (isEnded && q.explanation) {
          explBox.style.display = "block";
          explBox.innerHTML = `<strong>Answer Key:</strong> Option ${letters[q.correct_index]} &bull; ${q.explanation}`;
        } else {
          explBox.style.display = "none";
        }
      }
    }
  } else {
    if (hiddenPrompt) hiddenPrompt.style.display = "none";
    const showOptionsPrompt = document.getElementById("projector-show-options-prompt");
    if (showOptionsPrompt) showOptionsPrompt.style.display = "none";
    if (qTextEl) {
      qTextEl.style.display = "block";
      qTextEl.textContent = "Awaiting Quiz Master to load Question...";
    }
    const answerHint = document.getElementById("projector-answer-hint");
    if (answerHint) answerHint.style.display = "none";
    if (optContainer) optContainer.innerHTML = "";
    if (explBox) explBox.style.display = "none";
    const lockedCard = document.getElementById("projector-locked-card");
    if (lockedCard) lockedCard.style.display = "none";
  }

  // 2. Active Team Spotlight Banner
  const finalistsMap = {};
  finalists.forEach(f => { finalistsMap[f.finalist_slot] = f; });
  const activeTeam = finalistsMap[activeSlot];

  const teamTitleEl = document.getElementById("spotlight-team-title");
  const turnBadgeEl = document.getElementById("spotlight-turn-type");
  const isEnded = status === "ended" || Boolean(state.is_locked);
  const lockInfo = state.lock_info || {};

  if (isEnded) {
    const winSlot = lockInfo.winning_team_slot || state.winning_team_slot;
    const winner = winSlot ? finalistsMap[winSlot] : null;
    const winName = lockInfo.winning_team_name || (winner ? winner.name : (winSlot ? `Team ${winSlot}` : null));
    const winMarks = (lockInfo.awarded_marks !== undefined && lockInfo.awarded_marks !== null)
      ? lockInfo.awarded_marks
      : (state.current_marks || 0);

    if (winSlot) {
      teamTitleEl.textContent = `🏆 WINNER: [T${winSlot}] ${winName}`;
      turnBadgeEl.className = "spotlight-turn-type turn-main";
      turnBadgeEl.style.background = "#059669";
      turnBadgeEl.textContent = `🔒 LOCKED • +${winMarks} MARKS AWARDED`;
    } else {
      teamTitleEl.textContent = `❌ QUESTION ENDED (0 MARKS)`;
      turnBadgeEl.className = "spotlight-turn-type turn-pass";
      turnBadgeEl.style.background = "#dc2626";
      turnBadgeEl.textContent = `🔒 LOCKED • 0 MARKS`;
    }
  } else {
    turnBadgeEl.style.background = "";
    if (activeTeam) {
      teamTitleEl.textContent = `TURN: [T${activeSlot}] ${activeTeam.name}`;
    } else {
      teamTitleEl.textContent = `TURN: TEAM ${activeSlot}`;
    }

    const passCount = (state.pass_history || []).length;
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
  }

  // Question outcome status banner (hidden since lockedCard provides rich summary)
  const statusBanner = document.getElementById("question-status-banner");
  if (statusBanner) statusBanner.style.display = "none";

  // Update Autonomous Stage Toolbar Buttons on Projector Screen
  const btnPrev = document.getElementById("proj-btn-prev");
  const btnNext = document.getElementById("proj-btn-next");
  const btnResetQ = document.getElementById("proj-btn-reset-q");
  const btnShowToggle = document.getElementById("proj-btn-show-toggle");
  const btnTimerToggle = document.getElementById("proj-btn-timer-toggle");
  const btnAdjCorrect = document.getElementById("proj-btn-adj-correct");
  const btnAdjWrong = document.getElementById("proj-btn-adj-wrong");
  const btnAdjPass = document.getElementById("proj-btn-adj-pass");

  const isOptionsVisibleStage = state.is_options_visible !== undefined ? Boolean(state.is_options_visible) : isVisible;
  const isMediaQStage = Boolean(state.is_media_question || (q && q.is_media_question));
  const isReadyToJudge = isVisible && isOptionsVisibleStage && !isEnded;
  const passCount = (state.pass_history || []).length;
  const currentMarks = state.current_marks || (passCount === 0 ? 10 : (passCount === 1 ? 5 : 2));

  if (btnPrev) btnPrev.disabled = state.question_index <= 0;
  if (btnNext) btnNext.disabled = state.question_index >= state.total_questions - 1;

  if (btnShowToggle) {
    if (isEnded) {
      btnShowToggle.disabled = true;
      btnShowToggle.textContent = "🔒 Question Locked";
      btnShowToggle.className = "btn btn-secondary";
      btnShowToggle.onclick = null;
    } else if (!isVisible) {
      btnShowToggle.disabled = false;
      btnShowToggle.textContent = isMediaQStage ? "👁️ Show Media & Q [Space]" : "👁️ Show Question [Space]";
      btnShowToggle.className = "btn btn-success";
      btnShowToggle.onclick = projectorShowQuestion;
    } else if (!isOptionsVisibleStage) {
      btnShowToggle.disabled = false;
      btnShowToggle.textContent = "📋 Show Options & Timer [Space]";
      btnShowToggle.className = "btn btn-success";
      btnShowToggle.onclick = projectorShowOptions;
    } else {
      btnShowToggle.disabled = false;
      btnShowToggle.textContent = "🔒 Hide Question";
      btnShowToggle.className = "btn btn-secondary";
      btnShowToggle.onclick = projectorHideQuestion;
    }
  }

  if (btnResetQ) {
    btnResetQ.disabled = isEnded;
    btnResetQ.title = isEnded ? "Question is locked and completed" : "Restart / Reopen Question";
    btnResetQ.style.opacity = isEnded ? "0.45" : "1";
    btnResetQ.style.cursor = isEnded ? "not-allowed" : "pointer";
  }

  if (btnTimerToggle) {
    btnTimerToggle.disabled = !isReadyToJudge || isEnded;
    btnTimerToggle.textContent = isEnded ? "⏹️ Stopped" : (state.timer_is_running ? "⏸️ Pause [P]" : "▶️ Resume [P]");
  }

  if (btnAdjCorrect) {
    btnAdjCorrect.disabled = !isReadyToJudge || isEnded;
    btnAdjCorrect.innerHTML = `&#10004; Correct (+${currentMarks})`;
  }
  if (btnAdjWrong) {
    btnAdjWrong.disabled = !isReadyToJudge || isEnded;
    if (passCount === 0) {
      btnAdjWrong.innerHTML = `&#10006; Wrong &rarr; Pass 1 (5pts)`;
    } else if (passCount === 1) {
      btnAdjWrong.innerHTML = `&#10006; Wrong &rarr; Pass 2 (2pts)`;
    } else {
      btnAdjWrong.innerHTML = `&#10006; Wrong &rarr; End Q (0)`;
    }
  }
  if (btnAdjPass) {
    btnAdjPass.disabled = !isReadyToJudge || isEnded;
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

function formatAnswerTime(ms) {
  if (!ms || ms <= 0) return "0.0s";
  const totalSec = ms / 1000.0;
  if (totalSec < 60) {
    return `${totalSec.toFixed(1)}s`;
  }
  const mins = Math.floor(totalSec / 60);
  const remSec = (totalSec % 60).toFixed(1);
  return `${mins}m ${remSec}s`;
}

function renderScoreboard(finalists, winningSlot) {
  const tbody = document.getElementById("projector-scoreboard-rows");
  if (!tbody) return;
  tbody.innerHTML = "";

  // Sort finalists:
  // Primary sort: final_score DESC (highest points first)
  // Tie-breaker: final_time_ms ASC (lowest cumulative answer time first; faster team wins ties)
  // Tertiary: finalist_slot ASC
  const sorted = [...finalists].sort((a, b) => 
    (b.final_score - a.final_score) || 
    ((a.final_time_ms || 0) - (b.final_time_ms || 0)) || 
    (a.finalist_slot - b.finalist_slot)
  );

  sorted.forEach((team, rank) => {
    const tr = document.createElement("tr");
    const isWinner = team.finalist_slot === winningSlot;
    if (isWinner) {
      tr.style.background = "rgba(16, 185, 129, 0.15)";
    }

    const timeFormatted = team.final_time_display || formatAnswerTime(team.final_time_ms);

    tr.innerHTML = `
      <td style="color:#94a3b8; font-weight:700;">#${rank + 1}</td>
      <td><strong>[T${team.finalist_slot}]</strong> ${team.name}</td>
      <td class="score-pts" style="text-align:center;">${team.final_score} <span style="font-size:0.8rem; font-weight:700; color:#cbd5e1;">pts</span></td>
      <td class="score-time" style="text-align:right; font-weight:800; font-size:1.1rem; color:#38bdf8;">${timeFormatted}</td>
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

async function projectorShowOptions() {
  try {
    const res = await fetch("/api/admin/final/reveal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reveal_options" })
    });
    const data = await res.json();
    if (data.success) {
      currentState = data.state;
      renderProjectorState(currentState);
      if (window.quizAudio) window.quizAudio.playReveal();
    }
  } catch (e) {
    console.error("Show options error", e);
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
  closeWrongPassOverlay();
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
  closeWrongPassOverlay();
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
  if (currentState.question_status === "ended" || currentState.is_locked) {
    showProjectorPassToast("🔒 This question is locked and completed.");
    return;
  }
  closeWrongPassOverlay();
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
let isOptionSubmitting = false;
let pendingWrongPass = null;
let justConfirmedLocalWrongPass = false;
let passToastTimer = null;

function showProjectorPassToast(text) {
  const toast = document.getElementById("projector-pass-toast");
  if (!toast) return;
  toast.textContent = text;
  toast.style.display = "block";
  if (passToastTimer) clearTimeout(passToastTimer);
  passToastTimer = setTimeout(() => {
    toast.style.display = "none";
  }, 3500);
}

function getNextPassInfo(state) {
  if (!state) return null;
  const passHist = state.pass_history || [];
  const maxPasses = state.max_passes || 2;
  if (passHist.length >= maxPasses) return null;

  const passingOrder = (state.passing_order || []).slice(0, maxPasses);
  const attempted = new Set(passHist.map(h => h.slot));
  attempted.add(state.active_team_slot);

  let nextSlot = null;
  for (const slot of passingOrder) {
    if (!attempted.has(slot)) {
      nextSlot = slot;
      break;
    }
  }
  if (nextSlot === null) return null;

  const finalistsMap = {};
  (state.finalists || []).forEach(f => { finalistsMap[f.finalist_slot] = f; });
  const currTeam = finalistsMap[state.active_team_slot];
  const nextTeam = finalistsMap[nextSlot];
  const nextPassNum = passHist.length + 1;
  const nextMarks = nextPassNum === 1 ? 5 : 2;
  const passSeconds = (state.competition && state.competition.final_pass_timer_seconds) || 5;

  return {
    currSlot: state.active_team_slot,
    currTeamName: currTeam ? `[T${state.active_team_slot}] ${currTeam.name}` : `Team ${state.active_team_slot}`,
    nextSlot,
    nextTeamName: nextTeam ? `[T${nextSlot}] ${nextTeam.name}` : `Team ${nextSlot}`,
    nextPassNum,
    nextMarks,
    passSeconds
  };
}

function openWrongPassOverlay(type, info, chosenOptionLetter) {
  // If first param is object, handle backwards compatibility
  if (typeof type === "object") {
    chosenOptionLetter = info;
    info = type;
    type = "wrong";
  }
  const overlay = document.getElementById("projector-wrong-pass-overlay");
  const card = document.getElementById("wrong-pass-card");
  const iconEl = document.getElementById("wrong-pass-icon");
  const titleEl = document.getElementById("wrong-pass-title");
  const detailEl = document.getElementById("wrong-pass-detail");
  const nextTitleEl = document.getElementById("wrong-pass-next-title");
  const nextTeamEl = document.getElementById("wrong-pass-next-team");
  const nextMetaEl = document.getElementById("wrong-pass-next-meta");
  const confirmBtn = document.getElementById("btn-confirm-wrong-pass");

  let currName = "Current Team";
  if (currentState) {
    if (currentState.active_team && currentState.active_team.name) {
      currName = `[T${currentState.active_team_slot}] ${currentState.active_team.name}`;
    } else {
      currName = `Team ${currentState.active_team_slot}`;
    }
  }
  if (info && info.currTeamName) {
    currName = info.currTeamName;
  }

  const isWrong = type === "wrong";
  if (isWrong) {
    if (iconEl) iconEl.innerHTML = "&#10060;";
    if (card) {
      card.style.borderColor = "#ef4444";
      card.style.boxShadow = "0 0 55px rgba(239, 68, 68, 0.55)";
    }
    if (titleEl) {
      titleEl.textContent = "WRONG ANSWER!";
      titleEl.style.color = "#f87171";
    }

    if (info) {
      if (detailEl) {
        detailEl.textContent = chosenOptionLetter
          ? `${currName} selected Option ${chosenOptionLetter} — Wrong Answer!`
          : `${currName} gave a Wrong Answer!`;
      }
      if (nextTitleEl) nextTitleEl.textContent = "PASSED TO NEXT TEAM";
      if (nextTeamEl) nextTeamEl.textContent = info.nextTeamName;
      if (nextMetaEl) nextMetaEl.textContent = `PASS ${info.nextPassNum} OF 2 • ${info.nextMarks} MARKS • ${info.passSeconds}s TIMER`;
      if (confirmBtn) {
        confirmBtn.innerHTML = `👉 Click to Pass to ${info.nextTeamName} &amp; Start Timer [Enter]`;
        confirmBtn.className = "btn btn-warning";
        confirmBtn.style.background = "#f59e0b";
        confirmBtn.style.color = "#0f172a";
        confirmBtn.style.border = "2px solid #fbbf24";
      }
    } else {
      if (detailEl) {
        detailEl.textContent = chosenOptionLetter
          ? `${currName} selected Option ${chosenOptionLetter} — Wrong Answer! Pass limit reached (2 passes completed).`
          : `${currName} gave a Wrong Answer! Pass limit reached (2 passes completed).`;
      }
      if (nextTitleEl) nextTitleEl.textContent = "QUESTION ENDED";
      if (nextTeamEl) nextTeamEl.textContent = "NO FURTHER PASSES";
      if (nextMetaEl) nextMetaEl.textContent = "0 MARKS AWARDED • QUESTION LOCKED";
      if (confirmBtn) {
        confirmBtn.innerHTML = `❌ Click to End Question (0 Marks) [Enter]`;
        confirmBtn.className = "btn btn-danger";
        confirmBtn.style.background = "#ef4444";
        confirmBtn.style.color = "#ffffff";
        confirmBtn.style.border = "2px solid #f87171";
      }
    }
  } else {
    // Timeout or pass
    if (iconEl) iconEl.innerHTML = "&#9201;&#65039;";
    if (titleEl) {
      titleEl.textContent = "TIME OVER!";
    }

    if (info) {
      if (card) {
        card.style.borderColor = "#f59e0b";
        card.style.boxShadow = "0 0 55px rgba(245, 158, 11, 0.55)";
      }
      if (titleEl) titleEl.style.color = "#fbbf24";
      if (detailEl) {
        detailEl.textContent = `Time is over for ${currName}!`;
      }
      if (nextTitleEl) nextTitleEl.textContent = "PASSED TO NEXT TEAM";
      if (nextTeamEl) nextTeamEl.textContent = info.nextTeamName;
      if (nextMetaEl) nextMetaEl.textContent = `PASS ${info.nextPassNum} OF 2 • ${info.nextMarks} MARKS • ${info.passSeconds}s TIMER`;
      if (confirmBtn) {
        confirmBtn.innerHTML = `👉 Click to Pass to ${info.nextTeamName} &amp; Start Timer [Enter]`;
        confirmBtn.className = "btn btn-warning";
        confirmBtn.style.background = "#f59e0b";
        confirmBtn.style.color = "#0f172a";
        confirmBtn.style.border = "2px solid #fbbf24";
      }
    } else {
      if (card) {
        card.style.borderColor = "#ef4444";
        card.style.boxShadow = "0 0 55px rgba(239, 68, 68, 0.55)";
      }
      if (titleEl) titleEl.style.color = "#f87171";
      if (detailEl) {
        detailEl.textContent = `Time is over for ${currName}! Pass limit reached (2 passes completed).`;
      }
      if (nextTitleEl) nextTitleEl.textContent = "QUESTION ENDED";
      if (nextTeamEl) nextTeamEl.textContent = "NO FURTHER PASSES";
      if (nextMetaEl) nextMetaEl.textContent = "0 MARKS AWARDED • QUESTION LOCKED";
      if (confirmBtn) {
        confirmBtn.innerHTML = `❌ Click to End Question (0 Marks) [Enter]`;
        confirmBtn.className = "btn btn-danger";
        confirmBtn.style.background = "#ef4444";
        confirmBtn.style.color = "#ffffff";
        confirmBtn.style.border = "2px solid #f87171";
      }
    }
  }

  if (overlay) {
    overlay.style.display = "flex";
  }
}

function closeWrongPassOverlay() {
  pendingWrongPass = null;
  const overlay = document.getElementById("projector-wrong-pass-overlay");
  if (overlay) overlay.style.display = "none";
}

async function confirmPendingWrongPass() {
  if (!pendingWrongPass || isOptionSubmitting) return;
  const payload = { ...pendingWrongPass };
  closeWrongPassOverlay();

  isOptionSubmitting = true;
  justConfirmedLocalWrongPass = true;
  if (window.quizAudio) window.quizAudio.playPass();

  try {
    const res = await fetch("/api/admin/final/adjudicate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.success && data.state) {
      currentState = data.state;
      renderProjectorState(currentState);
    }
  } catch (err) {
    console.error("Confirm wrong pass error:", err);
  } finally {
    isOptionSubmitting = false;
  }
}

async function projectorSelectOption(idx) {
  if (isOptionSubmitting || pendingWrongPass) return;
  if (!currentState || !currentState.question) return;
  if (currentState.question_status === "ended" || currentState.is_locked) return;
  if (!currentState.is_question_visible) {
    projectorShowQuestion();
    return;
  }
  if (!currentState.is_options_visible) return;
  if (currentState.question_status === "ended") return;

  // Prevent clicking an option already eliminated as wrong in this question
  const alreadyWrong = (currentState.pass_history || []).some(
    h => h.result === "incorrect" && Number(h.selected_option) === idx
  );
  if (alreadyWrong) return;

  const q = currentState.question;
  const isCorrect = (idx === q.correct_index);
  localSelectedOption = idx;

  const passCount = (currentState.pass_history || []).length;
  const maxPasses = currentState.max_passes || 2;
  const nextPassInfo = !isCorrect ? getNextPassInfo(currentState) : null;
  const willEndQuestion = isCorrect || !nextPassInfo;
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
        const wrongTag = willEndQuestion
          ? `&#10006; INCORRECT (0)`
          : `&#10006; WRONG &rarr; PASSING!`;
        c.innerHTML = `
          <div class="projector-opt-letter">${letters[cIdx]}</div>
          <div class="projector-opt-text">${q.options[cIdx]}</div>
          <span class="projector-opt-tag tag-incorrect">${wrongTag}</span>
        `;
      }
    }
    // Only reveal the true correct answer when the question actually ends!
    // (Do NOT reveal if passing to another team!)
    if (!isCorrect && willEndQuestion && cIdx === q.correct_index) {
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

  // If wrong answer: show alert modal (either passing to next team or ending with 0 marks)
  if (!isCorrect) {
    pendingWrongPass = { decision: "incorrect", selected_option: idx };
    try {
      await fetch("/api/admin/final/timer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "pause" })
      });
    } catch (e) {
      console.error("Pause before wrong pass error:", e);
    }
    openWrongPassOverlay("wrong", nextPassInfo, letters[idx]);
    return;
  }

  // Submit adjudication immediately if correct
  isOptionSubmitting = true;
  try {
    const decision = "correct";
    const res = await fetch("/api/admin/final/adjudicate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision, selected_option: idx })
    });
    const data = await res.json();
    if (data.success && data.state) {
      currentState = data.state;
      renderProjectorState(currentState);
    }
  } catch (err) {
    console.error("Option adjudication error:", err);
  } finally {
    isOptionSubmitting = false;
  }
}

async function projectorAdjudicate(decision) {
  if (pendingWrongPass || isOptionSubmitting) return;
  if (!currentState || !currentState.question) return;
  if (currentState.question_status === "ended" || currentState.is_locked) return;

  const nextPassInfo = getNextPassInfo(currentState);

  if (decision === "correct") {
    if (window.quizAudio) window.quizAudio.playCorrect();
  } else if (decision === "incorrect") {
    if (window.quizAudio) window.quizAudio.playWrong();
    pendingWrongPass = { decision: "incorrect" };
    try {
      await fetch("/api/admin/final/timer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "pause" })
      });
    } catch (e) {
      console.error("Pause before wrong pass error:", e);
    }
    openWrongPassOverlay("wrong", nextPassInfo, null);
    return;
  } else if (decision === "timeout_or_pass") {
    if (window.quizAudio) window.quizAudio.playPass();
    pendingWrongPass = { decision: "timeout_or_pass" };
    try {
      await fetch("/api/admin/final/timer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "pause" })
      });
    } catch (e) {
      console.error("Pause before pass error:", e);
    }
    openWrongPassOverlay("timeout", nextPassInfo, null);
    return;
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
  if (currentState.question_status === "ended" || currentState.is_locked) return;
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

    // If Wrong Answer / Time Over Alert is open, Enter or Space confirms passing to next team
    const overlay = document.getElementById("projector-wrong-pass-overlay");
    const isOverlayOpen = overlay && overlay.style.display !== "none" && overlay.style.display !== "";
    if (pendingWrongPass || isOverlayOpen) {
      if (e.key === "Enter" || e.key === " " || e.code === "Space") {
        e.preventDefault();
        confirmPendingWrongPass();
      }
      return;
    }

    const key = e.key.toUpperCase();
    const isOptionsVis = currentState && (currentState.is_options_visible !== undefined ? currentState.is_options_visible : currentState.is_question_visible);
    const isQuestionEnded = currentState && (currentState.question_status === "ended" || Boolean(currentState.is_locked));
    const isQuestionActive = currentState && currentState.is_question_visible && isOptionsVis && !isQuestionEnded;

    if (key === " " || e.code === "Space" || key === "ENTER") {
      e.preventDefault();
      if (isQuestionEnded) return;
      if (!currentState || !currentState.is_question_visible) {
        projectorShowQuestion();
      } else if (!isOptionsVis) {
        projectorShowOptions();
      } else {
        projectorToggleTimer();
      }
    } else if (key === "1" || (key === "A" && isQuestionActive)) {
      if (isQuestionEnded) return;
      e.preventDefault();
      projectorSelectOption(0);
    } else if (key === "2" || (key === "B" && isQuestionActive)) {
      if (isQuestionEnded) return;
      e.preventDefault();
      projectorSelectOption(1);
    } else if (key === "3" || (key === "C" && isQuestionActive)) {
      if (isQuestionEnded) return;
      e.preventDefault();
      projectorSelectOption(2);
    } else if (key === "4" || (key === "D" && isQuestionActive)) {
      if (isQuestionEnded) return;
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
      if (!isQuestionEnded) projectorToggleTimer();
    } else if (key === "R") {
      e.preventDefault();
      if (!isQuestionEnded) projectorResetQuestion();
    } else if (key === "T") {
      e.preventDefault();
      if (!isQuestionEnded) projectorAdjudicate("timeout_or_pass");
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
