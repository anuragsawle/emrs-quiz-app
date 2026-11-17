# EMRS School Quiz Competition Application
**LAN-Based Two-Stage School Quiz Competition Platform**  
*Compliant with EMRS Functional Specification Version 1.0*

---

## 1. Overview
This application is designed specifically for school computer laboratories without requiring any internet connection. It powers a two-stage competition:
1. **Qualifier Round (Lab-based)**:
   - 15+ participating teams taking a 20-minute computer-based test simultaneously on assigned lab stations.
   - Questions and answer options are independently shuffled for each team.
   - Scoring: **+1 for correct**, **0 for incorrect** (no negative marking).
   - Tie-breaker: Highest score ranks first; ties are automatically broken by the **lower elapsed time** (recorded accurately by the server).
   - **Top 6 teams** advance to the Final Round.
2. **Final Round (Auditorium Projector & Host Console)**:
   - 6 qualified finalist teams (T1 to T6).
   - Displayed on a big screen / projector with audio countdown and live scoreboard.
   - First-team rotation:
     - Q1: T1 &rarr; Pass queue: T2 &rarr; T3 &rarr; T4 &rarr; T5 &rarr; T6
     - Q2: T2 &rarr; Pass queue: T3 &rarr; T4 &rarr; T5 &rarr; T6 &rarr; T1
     - Q3: T3 &rarr; Pass queue: T4 &rarr; T5 &rarr; T6 &rarr; T1 &rarr; T2
     - Q4: T4 &rarr; Pass queue: T5 &rarr; T6 &rarr; T1 &rarr; T2 &rarr; T3
     - Q5: T5 &rarr; Pass queue: T6 &rarr; T1 &rarr; T2 &rarr; T3 &rarr; T4
     - Q6: T6 &rarr; Pass queue: T1 &rarr; T2 &rarr; T3 &rarr; T4 &rarr; T5
     - Q7 onward: Repeats modulo 6 from T1.
   - Timing & Adjudication:
     - **Main Turn (60s)**: +5 marks if correct (question ends immediately). If incorrect, question ends immediately (NO pass). If timeout, passes to next team with 5s.
     - **Passing Turn (5s)**: +5 marks if correct (question ends). If incorrect, question ends immediately. If timeout, passes to next remaining team in sequence (5s).
     - If all teams fail or time out: question ends with 0 marks.
   - Host controls: Single-click or keyboard adjudication (`Space` for timer, `C`/`1` for Correct, `X`/`2` for Incorrect, `P`/`3` for Pass, `N` for Next Question).

---

## 2. Quick Start (Teacher / Host Computer)

### Requirements
- Python 3.8+ (standard library + `tornado`, which is pre-installed in Anaconda or via `pip install tornado`).
- Modern web browser (Chrome, Firefox, Safari, Edge).
- No internet access required!

### Starting the Server
Open Terminal, navigate to the folder, and run:
```bash
./start.sh
```
or
```bash
python3 run.py
```

The terminal will print:
```
======================================================================
  EMRS SCHOOL QUIZ COMPETITION - SERVER STARTED
  LAN Access URL for Student PCs : http://192.168.1.XX:8888/
  Admin / Host Console           : http://192.168.1.XX:8888/admin
  Big-Screen Projector View      : http://192.168.1.XX:8888/projector
======================================================================
```
The **Admin Console** will open automatically in your browser.

---

## 3. How to Conduct the Event

### Step 1: Student Lab Setup (Qualifier Round)
1. On each student PC in the computer lab, open a web browser and navigate to:
   ```
   http://<HOST-IP>:8888/
   ```
   *(For example: `http://192.168.1.45:8888/`)*
2. Each team enters their assigned **Team Code** (e.g. `T01`) and **PIN** (default `1001`, `1002`, etc., visible in the Admin Teams tab).
3. The 20-minute countdown begins when the team enters. Answers are saved automatically in real-time on every click.
4. On the **Admin Console &rarr; Qualifier Monitor**, the teacher can see each team's live answering progress and elapsed time.

### Step 2: Finalist Promotion
1. Once all teams submit (or 20 minutes expire), click on the **Finalists Selection** tab in the Admin Console.
2. The system displays the official ranking (Score & Tie-breaker).
3. Click **"Confirm & Promote Top 6 to Final Round"**. The top 6 teams are assigned slots `T1` through `T6`.

### Step 3: Auditorium Final Round
1. Connect the teacher's laptop to the projector or open a second window on the projector screen:
   ```
   http://localhost:8888/projector
   ```
   Press `F` to enter full-screen mode.
2. The teacher manages questions from the **Admin Console &rarr; Final Round Console**:
   - Press **Spacebar** to start the 60s timer.
   - If the team answers correctly: Press **C** or **1** (+5 marks awarded, question ends, answer revealed).
   - If the team answers incorrectly: Press **X** or **2** (Question ends immediately, 0 marks, answer revealed).
   - If the team times out or passes: Press **P** or **3** (Passes to next team in rotation with 5 seconds).
   - Press **N** to advance to the next question.

---

## 4. Disaster Recovery & Power Outage Protection
- The application uses **SQLite in Write-Ahead Logging (WAL) mode**. Every click, response, timer state, and score change is written immediately to disk (`emrs_quiz.db`).
- **If power fails or the host restarts**:
  Simply re-run `./start.sh`. The application restores the exact state, active question, time remaining, and submitted scores seamlessly.

---

## 5. Reports & Exports
From the **Reports & Recovery** tab in the Admin Console:
- Export Qualifier Results (CSV) with rank, PC station, score, and elapsed milliseconds.
- Export Final Round Scorecard (CSV).
- Download full score transaction ledger and audit logs.
