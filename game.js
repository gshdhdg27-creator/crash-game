(() => {
  const BET_SECONDS = 10;
  const START_BALANCE = 1000;

  const el = {
    balance: document.getElementById("balance"),
    mult: document.getElementById("mult"),
    status: document.getElementById("status"),
    phase: document.getElementById("phase-banner"),
    history: document.getElementById("history"),
    betInput: document.getElementById("bet-input"),
    btnBet: document.getElementById("btn-bet"),
    btnCashout: document.getElementById("btn-cashout"),
    canvas: document.getElementById("canvas"),
    confetti: document.getElementById("confetti"),
  };

  const ctx = el.canvas.getContext("2d");
  const cctx = el.confetti.getContext("2d");

  let balance = loadBalance();
  let phase = "betting"; // betting | flying | crashed
  let betWindowLeft = BET_SECONDS;
  let betWindowTimer = null;
  let animId = null;
  let crashPoint = 1;
  let multiplier = 1;
  let flightStart = 0;
  let activeBet = null; // { amount, cashedOut, cashoutMult }
  let history = [];
  let path = [];
  let confettiParts = [];

  function loadBalance() {
    try {
      const v = parseFloat(localStorage.getItem("crash_bal"));
      if (!isNaN(v) && v >= 0) return v;
    } catch (e) {}
    return START_BALANCE;
  }
  function saveBalance() {
    try { localStorage.setItem("crash_bal", String(balance)); } catch (e) {}
  }
  function fmt(n) {
    return (Math.round(n * 100) / 100).toFixed(2);
  }
  function updateBalance() {
    el.balance.textContent = fmt(balance);
    saveBalance();
  }

  /** Crash point: fair-ish house edge, most rounds low, rare high. */
  function rollCrashPoint() {
    const r = Math.random();
    // Instant crash chance ~3%
    if (r < 0.03) return 1.00;
    // Inverse curve: higher mult rarer
    const u = Math.max(0.0001, Math.random());
    const m = Math.max(1.01, 0.97 / u);
    return Math.min(Math.round(m * 100) / 100, 100);
  }

  /** Smooth growth: reaches crashPoint over several seconds, not instant. */
  function multAt(elapsedMs) {
    // e^(k*t) growth; k tuned so ~1.5x at ~2.5s, ~3x around 6s
    const t = elapsedMs / 1000;
    const k = 0.28;
    return Math.exp(k * t);
  }

  function setPhase(p) {
    phase = p;
    el.phase.className = "phase " + p;
    if (p === "betting") {
      el.phase.textContent = "СТАВКИ · " + Math.ceil(betWindowLeft);
      el.mult.className = "mult";
      el.mult.textContent = "1.00×";
      el.status.textContent = "Сделайте ставку";
      el.btnBet.disabled = false;
      el.btnCashout.disabled = true;
    } else if (p === "flying") {
      el.phase.textContent = "В ПОЛЁТЕ";
      el.mult.className = "mult up";
      el.status.textContent = activeBet && !activeBet.cashedOut ? "Можно забрать" : "Смотрите";
      el.btnBet.disabled = true;
      el.btnCashout.disabled = !(activeBet && !activeBet.cashedOut);
    } else {
      el.phase.textContent = "CRASH";
      el.mult.className = "mult crash";
      el.btnBet.disabled = true;
      el.btnCashout.disabled = true;
    }
  }

  function pushHistory(m) {
    history.unshift(m);
    if (history.length > 12) history.pop();
    el.history.innerHTML = history.map((x) => {
      const cls = x < 1.5 ? "low" : x < 3 ? "mid" : "high";
      return `<span class="${cls}">${x.toFixed(2)}×</span>`;
    }).join("");
  }

  function startBettingWindow() {
    if (betWindowTimer) clearInterval(betWindowTimer);
    betWindowLeft = BET_SECONDS;
    activeBet = null;
    path = [];
    multiplier = 1;
    setPhase("betting");
    drawScene(1, false);

    betWindowTimer = setInterval(() => {
      betWindowLeft -= 0.1;
      if (betWindowLeft <= 0) {
        clearInterval(betWindowTimer);
        betWindowTimer = null;
        startFlight();
        return;
      }
      el.phase.textContent = "СТАВКИ · " + Math.ceil(betWindowLeft);
    }, 100);
  }

  function startFlight() {
    crashPoint = rollCrashPoint();
    flightStart = performance.now();
    path = [{ t: 0, m: 1 }];
    setPhase("flying");

    const loop = (now) => {
      if (phase !== "flying") return;
      const elapsed = now - flightStart;
      let m = multAt(elapsed);
      if (m >= crashPoint) {
        m = crashPoint;
        multiplier = m;
        el.mult.textContent = m.toFixed(2) + "×";
        endRound(false);
        return;
      }
      multiplier = m;
      path.push({ t: elapsed, m });
      if (path.length > 400) path.shift();
      el.mult.textContent = m.toFixed(2) + "×";
      if (activeBet && !activeBet.cashedOut) {
        el.status.textContent = "Выигрыш сейчас: " + fmt(activeBet.amount * m);
      }
      drawScene(m, true);
      animId = requestAnimationFrame(loop);
    };
    animId = requestAnimationFrame(loop);
  }

  function endRound(fromCashout) {
    if (animId) cancelAnimationFrame(animId);
    animId = null;
    const finalMult = multiplier;

    if (activeBet && !activeBet.cashedOut) {
      // lost
      el.status.textContent = "Проигрыш · crash @ " + finalMult.toFixed(2) + "×";
    } else if (activeBet && activeBet.cashedOut) {
      el.status.textContent = "Забрали @ " + activeBet.cashoutMult.toFixed(2) + "×";
    } else {
      el.status.textContent = "Crash @ " + finalMult.toFixed(2) + "×";
    }

    setPhase("crashed");
    el.mult.textContent = finalMult.toFixed(2) + "×";
    pushHistory(finalMult);
    drawScene(finalMult, false, true);

    // Next round after short pause — continuous loop
    setTimeout(() => startBettingWindow(), 2200);
  }

  function placeBet() {
    if (phase !== "betting") return;
    const amount = parseFloat(el.betInput.value);
    if (isNaN(amount) || amount < 1) {
      el.status.textContent = "Минимум 1";
      return;
    }
    if (amount > balance) {
      el.status.textContent = "Недостаточно средств";
      return;
    }
    if (activeBet) {
      el.status.textContent = "Ставка уже сделана в этом раунде";
      return;
    }
    balance -= amount;
    updateBalance();
    activeBet = { amount, cashedOut: false, cashoutMult: 0 };
    el.status.textContent = "Ставка " + fmt(amount) + " принята";
    el.btnBet.disabled = true;
  }

  function cashOut() {
    if (phase !== "flying" || !activeBet || activeBet.cashedOut) return;
    activeBet.cashedOut = true;
    activeBet.cashoutMult = multiplier;
    const win = activeBet.amount * multiplier;
    balance += win;
    updateBalance();
    el.btnCashout.disabled = true;
    el.status.textContent = "Забрали " + fmt(win) + " @ " + multiplier.toFixed(2) + "×";
    burstConfetti();
  }

  function drawScene(m, flying, crashed) {
    const w = el.canvas.width;
    const h = el.canvas.height;
    ctx.clearRect(0, 0, w, h);

    // grid
    ctx.strokeStyle = "rgba(30,35,41,0.9)";
    ctx.lineWidth = 1;
    for (let i = 1; i < 6; i++) {
      const y = (h / 6) * i;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // curve from path
    if (path.length > 1) {
      ctx.beginPath();
      ctx.strokeStyle = crashed ? "#f6465d" : "#0ecb81";
      ctx.lineWidth = 3;
      const maxT = Math.max(path[path.length - 1].t, 1);
      const maxM = Math.max(m, 2);
      path.forEach((p, i) => {
        const x = 40 + (p.t / Math.max(maxT, 8000)) * (w - 80);
        const y = h - 40 - ((p.m - 1) / (maxM - 1 || 1)) * (h - 100);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();

      // ball at tip
      const last = path[path.length - 1];
      const bx = 40 + (last.t / Math.max(maxT, 8000)) * (w - 80);
      const by = h - 40 - ((last.m - 1) / (maxM - 1 || 1)) * (h - 100);
      ctx.beginPath();
      ctx.fillStyle = crashed ? "#f6465d" : "#f0b90b";
      ctx.arc(bx, by, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.fillStyle = "rgba(240,185,11,0.25)";
      ctx.arc(bx, by, 16, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // idle ball on ground during betting
      ctx.beginPath();
      ctx.fillStyle = "#f0b90b";
      ctx.arc(50, h - 40, 8, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function burstConfetti() {
    const rect = el.confetti.getBoundingClientRect();
    el.confetti.width = rect.width * devicePixelRatio;
    el.confetti.height = rect.height * devicePixelRatio;
    cctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    const colors = ["#f0b90b", "#0ecb81", "#eaecef", "#3b82f6", "#f6465d"];
    confettiParts = [];
    for (let i = 0; i < 48; i++) {
      confettiParts.push({
        x: rect.width * 0.5 + (Math.random() - 0.5) * 80,
        y: rect.height * 0.35,
        vx: (Math.random() - 0.5) * 6,
        vy: -Math.random() * 7 - 2,
        g: 0.18 + Math.random() * 0.08,
        size: 3 + Math.random() * 4,
        color: colors[i % colors.length],
        life: 60 + Math.random() * 30,
      });
    }
    const tick = () => {
      cctx.clearRect(0, 0, rect.width, rect.height);
      let alive = false;
      confettiParts.forEach((p) => {
        if (p.life <= 0) return;
        alive = true;
        p.vy += p.g;
        p.x += p.vx;
        p.y += p.vy;
        p.life -= 1;
        cctx.globalAlpha = Math.max(0, p.life / 40);
        cctx.fillStyle = p.color;
        cctx.fillRect(p.x, p.y, p.size, p.size * 0.6);
      });
      cctx.globalAlpha = 1;
      if (alive) requestAnimationFrame(tick);
      else cctx.clearRect(0, 0, rect.width, rect.height);
    };
    requestAnimationFrame(tick);
  }

  // UI
  document.querySelectorAll(".chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      el.betInput.value = btn.getAttribute("data-bet");
    });
  });
  el.btnBet.addEventListener("click", placeBet);
  el.btnCashout.addEventListener("click", cashOut);

  updateBalance();
  startBettingWindow(); // continuous rounds from the start
})();
