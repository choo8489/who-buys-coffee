/* =====================================================
   Gravity Roulette – script.js
   Matter.js 기반 Plinko 커피 내기 게임
   ===================================================== */

// ─── 전역 상태 ───────────────────────────────────────────
const MAX_PLAYERS = 10;
let players = [];           // { name, color }
let rankingOrder = [];      // 바닥에 도달한 순서
let matterEngine = null;
let matterRender = null;
let matterRunner = null;
let balls = [];             // { body, name, color, landed }
let animFrameId = null;
let gameFinished = false;

// 플레이어마다 고유한 색상
const BALL_COLORS = [
    '#a855f7', '#22d3ee', '#f59e0b', '#34d399',
    '#f87171', '#60a5fa', '#fb923c', '#a3e635',
    '#f472b6', '#94a3b8'
];

// ─── 별빛 파티클 생성 ────────────────────────────────────
(function createStars() {
    const container = document.getElementById('stars');
    for (let i = 0; i < 120; i++) {
        const s = document.createElement('div');
        s.className = 'star';
        const size = Math.random() * 2.5 + 0.5;
        s.style.cssText = `
      width:${size}px; height:${size}px;
      left:${Math.random() * 100}%;
      top:${Math.random() * 100}%;
      --d:${(Math.random() * 4 + 2).toFixed(1)}s;
      --delay:${(Math.random() * 4).toFixed(1)}s;
      --bright:${(Math.random() * 0.5 + 0.3).toFixed(2)};
    `;
        container.appendChild(s);
    }
})();

// ─── 이름 입력 / 추가 / 삭제 ─────────────────────────────
const nameInput = document.getElementById('player-name-input');
nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') addPlayer(); });

function addPlayer() {
    const name = nameInput.value.trim();
    if (!name) return;
    if (players.length >= MAX_PLAYERS) {
        shakeInput(); return;
    }
    if (players.find(p => p.name === name)) {
        shakeInput('이미 있는 이름입니다'); return;
    }
    players.push({ name, color: BALL_COLORS[players.length % BALL_COLORS.length] });
    nameInput.value = '';
    nameInput.focus();
    renderPlayerList();
    updateStartBtn();
}

function removePlayer(idx) {
    players.splice(idx, 1);
    // 색상 재배치
    players.forEach((p, i) => { p.color = BALL_COLORS[i % BALL_COLORS.length]; });
    renderPlayerList();
    updateStartBtn();
}

function renderPlayerList() {
    const list = document.getElementById('player-list');
    list.innerHTML = '';
    players.forEach((p, i) => {
        const li = document.createElement('li');
        li.className = 'player-item';
        li.innerHTML = `
      <div class="player-avatar" style="background:${p.color}">${p.name.charAt(0).toUpperCase()}</div>
      <span class="player-name-text">${escapeHtml(p.name)}</span>
      <button class="btn btn-danger" onclick="removePlayer(${i})" aria-label="삭제">✕</button>
    `;
        list.appendChild(li);
    });
    const hint = document.getElementById('player-count-hint');
    hint.textContent = `${players.length}명 입력됨 (최소 2명, 최대 ${MAX_PLAYERS}명)`;
}

function updateStartBtn() {
    document.getElementById('start-btn').disabled = players.length < 2;
}

function shakeInput(msg) {
    nameInput.style.animation = 'none';
    requestAnimationFrame(() => {
        nameInput.style.animation = 'shake .4s ease';
    });
    if (msg) {
        const hint = document.getElementById('player-count-hint');
        hint.textContent = msg;
        setTimeout(() => {
            hint.textContent = `${players.length}명 입력됨`;
        }, 2000);
    }
}

function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ─── 게임 시작 ────────────────────────────────────────────
function startGame() {
    if (players.length < 2) return;
    rankingOrder = [];
    balls = [];
    gameFinished = false;

    // 화면 전환
    document.getElementById('setup-screen').classList.remove('active');
    const gameScreen = document.getElementById('game-screen');
    gameScreen.style.display = 'flex';
    gameScreen.classList.add('active');
    document.getElementById('ranking-list').innerHTML = '';

    setTimeout(() => { initPhysics(); }, 80);
}

// ─── Matter.js 물리 엔진 초기화 ──────────────────────────
function initPhysics() {
    const { Engine, Render, Runner, Bodies, Body, Composite, Events, Vector } = Matter;

    // 엔진 크기 결정 (뷰포트 기준)
    const maxW = Math.min(window.innerWidth - 32, 860);
    const maxH = Math.min(window.innerHeight - 160, 680);
    const W = maxW;
    const H = maxH;

    const canvas = document.getElementById('game-canvas');
    canvas.width = W;
    canvas.height = H;

    // 이전 엔진 정리
    if (matterRender) { Render.stop(matterRender); matterRender.canvas = null; }
    if (matterRunner) Runner.stop(matterRunner);
    if (animFrameId) cancelAnimationFrame(animFrameId);
    document.getElementById('labels-layer').innerHTML = '';

    // 엔진 + 렌더러
    matterEngine = Engine.create({ gravity: { x: 0, y: 1.5 } });
    matterRender = Render.create({
        canvas,
        engine: matterEngine,
        options: {
            width: W, height: H,
            wireframes: false,
            background: 'transparent',
        }
    });
    matterRunner = Runner.create();

    // ── 벽·바닥 ──
    const wallOpts = { isStatic: true, render: { fillStyle: 'rgba(168,85,247,0.15)', strokeStyle: 'rgba(168,85,247,0.4)', lineWidth: 2 } };
    const wallThick = 30;
    const walls = [
        Bodies.rectangle(W / 2, H + wallThick / 2, W + 40, wallThick, { isStatic: true, label: 'floor', render: { fillStyle: '#a855f710', strokeStyle: '#a855f730', lineWidth: 1 } }),
        Bodies.rectangle(-wallThick / 2, H / 2, wallThick, H * 2, wallOpts),   // 좌벽
        Bodies.rectangle(W + wallThick / 2, H / 2, wallThick, H * 2, wallOpts), // 우벽
    ];
    Composite.add(matterEngine.world, walls);

    // ── Plinko 핀(Peg) 배치 ──
    addPegs(W, H);

    // ── 플레이어 볼 생성 ──
    const ballR = Math.max(18, Math.min(26, W / (players.length * 5 + 8)));
    const spread = (W * 0.6) / Math.max(players.length - 1, 1);
    const startX = W * 0.2;

    players.forEach((p, i) => {
        const x = players.length === 1 ? W / 2 : startX + i * spread;
        // 약간의 랜덤 오프셋 (예측 불가)
        const jitterX = (Math.random() - 0.5) * 20;
        const jitterY = Math.random() * 15;

        const body = Bodies.circle(x + jitterX, 30 + jitterY, ballR, {
            label: 'player_' + i,
            restitution: 0.35 + Math.random() * 0.25,   // 플레이어마다 탄성 다름
            friction: 0.01 + Math.random() * 0.04,
            frictionAir: 0.005 + Math.random() * 0.008,
            density: 0.002,
            render: {
                fillStyle: p.color,
                strokeStyle: lighten(p.color),
                lineWidth: 2,
            }
        });
        Composite.add(matterEngine.world, body);

        // 레이블 div
        const label = document.createElement('div');
        label.className = 'ball-label';
        label.id = `label-${i}`;
        label.textContent = p.name;
        document.getElementById('labels-layer').appendChild(label);

        balls.push({ body, name: p.name, color: p.color, idx: i, landed: false, r: ballR });
    });

    // ── 바닥 충돌 감지 ──
    Events.on(matterEngine, 'collisionStart', (event) => {
        event.pairs.forEach(pair => {
            let ballBody = null;
            if (pair.bodyB.label === 'floor') ballBody = pair.bodyA;
            else if (pair.bodyA.label === 'floor') ballBody = pair.bodyB;

            if (ballBody) {
                const ballData = balls.find(b => b.body === ballBody && !b.landed);
                if (ballData) {
                    ballData.landed = true;
                    rankingOrder.push(ballData);
                    addRankingItem(rankingOrder.length, ballData);
                    // 착지한 볼은 정지
                    Body.setStatic(ballBody, true);

                    if (rankingOrder.length === players.length) {
                        gameFinished = true;
                        setTimeout(showResult, 800);
                    }
                }
            }
        });
    });

    // ── 렌더 루프 (레이블 동기화) ──
    function labelLoop() {
        balls.forEach((b) => {
            const lbl = document.getElementById(`label-${b.idx}`);
            if (lbl) {
                lbl.style.left = b.body.position.x + 'px';
                lbl.style.top = b.body.position.y + 'px';
            }
        });
        animFrameId = requestAnimationFrame(labelLoop);
    }
    labelLoop();

    // 엔진 시작
    Render.run(matterRender);
    Runner.run(matterRunner, matterEngine);

    // 안전망: 20초 후 아직 안 끝났으면 강제 종료
    setTimeout(() => {
        if (!gameFinished) {
            balls.filter(b => !b.landed).forEach(b => {
                b.landed = true;
                rankingOrder.push(b);
                addRankingItem(rankingOrder.length, b);
            });
            if (rankingOrder.length > 0) showResult();
        }
    }, 20000);
}

// ─── Plinko 핀 배치 ──────────────────────────────────────
function addPegs(W, H) {
    const { Bodies, Composite } = Matter;
    const pegOpts = (r) => ({
        isStatic: true,
        restitution: 0.5,
        friction: 0.05,
        render: { fillStyle: 'rgba(34,211,238,0.25)', strokeStyle: 'rgba(34,211,238,0.7)', lineWidth: 1.5 },
    });

    const rows = 9;
    const cols = 11;
    const marginX = W * 0.06;
    const marginTop = H * 0.10;
    const marginBot = H * 0.18;
    const gapX = (W - marginX * 2) / (cols - 1);
    const gapY = (H - marginTop - marginBot) / (rows - 1);
    const pegR = Math.max(5, Math.min(9, gapX * 0.18));

    for (let row = 0; row < rows; row++) {
        const count = row % 2 === 0 ? cols : cols - 1;
        const offsetX = row % 2 === 0 ? 0 : gapX / 2;
        for (let col = 0; col < count; col++) {
            const x = marginX + offsetX + col * gapX;
            const y = marginTop + row * gapY;
            // 가끔 삼각형 장애물도 추가 (짝수 행 중간)
            if (row % 3 === 1 && col % 4 === 2) {
                const tri = Bodies.polygon(x, y, 3, pegR * 2.2, { ...pegOpts(), angle: Math.PI });
                Composite.add(matterEngine.world, tri);
            } else {
                Composite.add(matterEngine.world, Bodies.circle(x, y, pegR, pegOpts()));
            }
        }
    }

    // 양 사이드 경사 가이드
    const bumperOpts = {
        isStatic: true, angle: Math.PI / 10, restitution: 0.6, friction: 0.02,
        render: { fillStyle: 'rgba(168,85,247,0.2)', strokeStyle: 'rgba(168,85,247,0.6)', lineWidth: 2 }
    };
    const bW = W * 0.10, bH = 20;
    Composite.add(matterEngine.world, Matter.Bodies.rectangle(W * 0.12, H * 0.55, bW, bH, bumperOpts));
    Composite.add(matterEngine.world, Matter.Bodies.rectangle(W * 0.88, H * 0.55, bW, bH, { ...bumperOpts, angle: -Math.PI / 10 }));
}

// ─── 순위 아이템 추가 ─────────────────────────────────────
function addRankingItem(rank, ballData) {
    const list = document.getElementById('ranking-list');
    const li = document.createElement('li');
    li.className = 'ranking-item';
    const badgeClass = rank === 1 ? 'rank-1' : rank === 2 ? 'rank-2' : rank === 3 ? 'rank-3' : 'rank-other';
    li.innerHTML = `
    <span class="rank-badge ${badgeClass}">${rank}</span>
    <span style="color:${ballData.color}; font-weight:700">${escapeHtml(ballData.name)}</span>
  `;
    list.appendChild(li);
}

// ─── 결과 모달 표시 ──────────────────────────────────────
function showResult() {
    if (rankingOrder.length === 0) return;

    const winner = rankingOrder[0];
    const loser = rankingOrder[rankingOrder.length - 1];

    document.getElementById('modal-emoji').textContent = '☕';
    document.getElementById('modal-title').textContent = '결과 발표!';
    document.getElementById('modal-body').innerHTML =
        `<span style="color:${winner.color}; font-weight:800; font-size:1.2rem">${escapeHtml(winner.name)}</span>님이 커피를 삽니다! ☕<br>` +
        `<span style="color:${loser.color};">${escapeHtml(loser.name)}</span>님은 가장 늦게 도착 ✨`;

    // 전체 순위 렌더링
    const rankingDiv = document.getElementById('modal-ranking');
    const ul = document.createElement('ul');
    ul.className = 'modal-ranking-list';
    rankingOrder.forEach((b, i) => {
        const li = document.createElement('li');
        const isWinner = i === 0;
        const isLoser = i === rankingOrder.length - 1;
        li.className = `modal-rank-item${isWinner ? ' winner' : isLoser ? ' loser' : ''}`;
        const medal = ['🥇', '🥈', '🥉'][i] || `${i + 1}.`;
        li.innerHTML = `<span>${medal}</span>
      <span class="rank-badge" style="background:${b.color};color:#000;font-size:.65rem">${b.name.charAt(0)}</span>
      <span style="font-weight:600">${escapeHtml(b.name)}</span>
      ${isWinner ? '<span style="margin-left:auto;font-size:.8rem;color:#f59e0b">☕ 커피 당첨!</span>' : ''}
      ${isLoser ? '<span style="margin-left:auto;font-size:.8rem;color:#94a3b8">꼴등 🎖️</span>' : ''}`;
        ul.appendChild(li);
    });
    rankingDiv.innerHTML = '';
    rankingDiv.appendChild(ul);

    // 모달 표시
    const modal = document.getElementById('result-modal');
    modal.classList.add('show');
    launchConfetti();
}

function closeModal() {
    document.getElementById('result-modal').classList.remove('show');
}

// ─── 게임 리셋 ───────────────────────────────────────────
function resetGame() {
    closeModal();
    if (matterRender) { Matter.Render.stop(matterRender); matterRender.canvas = null; }
    if (matterRunner) Matter.Runner.stop(matterRunner);
    if (animFrameId) cancelAnimationFrame(animFrameId);
    if (matterEngine) Matter.Composite.clear(matterEngine.world);

    document.getElementById('labels-layer').innerHTML = '';
    document.getElementById('game-screen').classList.remove('active');
    document.getElementById('game-screen').style.display = 'none';
    document.getElementById('setup-screen').classList.add('active');

    // 기존 플레이어 목록은 유지 (편의를 위해)
    rankingOrder = [];
    balls = [];
    gameFinished = false;
}

// ─── 유틸: 색상 밝게 ─────────────────────────────────────
function lighten(hex) {
    try {
        const n = parseInt(hex.slice(1), 16);
        const r = Math.min(255, (n >> 16) + 80);
        const g = Math.min(255, ((n >> 8) & 0xff) + 80);
        const b = Math.min(255, (n & 0xff) + 80);
        return `rgb(${r},${g},${b})`;
    } catch { return '#ffffff'; }
}

// ─── 유틸: 컨페티 ─────────────────────────────────────────
function launchConfetti() {
    const container = document.getElementById('confetti-container');
    container.innerHTML = '';
    const colors = ['#a855f7', '#22d3ee', '#f59e0b', '#34d399', '#f87171', '#60a5fa'];
    for (let i = 0; i < 55; i++) {
        const p = document.createElement('div');
        p.className = 'confetti-piece';
        p.style.cssText = `
      left:${Math.random() * 100}%;
      background:${colors[Math.floor(Math.random() * colors.length)]};
      --dur:${(Math.random() * 1.8 + 1).toFixed(2)}s;
      --delay:${(Math.random() * 0.8).toFixed(2)}s;
      transform:rotate(${Math.random() * 360}deg);
    `;
        container.appendChild(p);
    }
}

// CSS의 shake 애니메이션 (인라인 keyframes 추가)
const shakeStyle = document.createElement('style');
shakeStyle.textContent = `
  @keyframes shake {
    0%,100% { transform:translateX(0); }
    20%      { transform:translateX(-6px); }
    40%      { transform:translateX(6px); }
    60%      { transform:translateX(-4px); }
    80%      { transform:translateX(4px); }
  }
`;
document.head.appendChild(shakeStyle);
