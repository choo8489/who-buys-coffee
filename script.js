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
    const rawInput = nameInput.value.trim();
    if (!rawInput) return;

    // 쉼표(,) 기준으로 분리 후 여백 제거, 빈 문자열 제외
    const newNames = rawInput.split(',').map(n => n.trim()).filter(n => n);

    let addedCount = 0;
    let duplicateCount = 0;
    let maxReached = false;

    for (let name of newNames) {
        if (name.length > 12) {
            name = name.substring(0, 12); // 최대 12자 제한 (기존 maxlength 처리 대체)
        }
        if (players.length >= MAX_PLAYERS) {
            maxReached = true;
            break;
        }
        if (players.find(p => p.name === name)) {
            duplicateCount++;
            continue;
        }
        players.push({ name, color: BALL_COLORS[players.length % BALL_COLORS.length] });
        addedCount++;
    }

    if (maxReached && addedCount === 0) {
        shakeInput('최대 10명까지 가능합니다');
    } else if (duplicateCount > 0 && addedCount === 0) {
        shakeInput('이미 있는 이름입니다');
    } else if (maxReached && addedCount > 0) {
        shakeInput('최대 인원(10명)까지만 추가되었습니다');
    } else if (duplicateCount > 0 && addedCount > 0) {
        shakeInput('중복된 이름을 제외하고 추가되었습니다');
    }

    if (addedCount > 0 || (newNames.length > 1 && addedCount === 0)) {
        nameInput.value = '';
    }

    if (addedCount > 0) {
        renderPlayerList();
        updateStartBtn();
    }
    nameInput.focus();
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

    // 엔진 크기 결정 (뷰포트 기준, 높이는 5배)
    const maxW = Math.min(window.innerWidth - 32, 860);
    const viewH = Math.min(window.innerHeight - 160, 680);
    const W = maxW;
    const H = viewH * 5;  // 5배 깊이

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

    // 바닥이 얇으면 빠른 공이 뚫고 나갈 수 있으므로 두껍게(100) 설정
    const wallThick = 30;
    const floorThick = 150;

    const walls = [
        Bodies.rectangle(W / 2, H + floorThick / 2, W + 40, floorThick, { isStatic: true, label: 'floor', render: { fillStyle: '#a855f718', strokeStyle: '#a855f750', lineWidth: 2 } }),
        Bodies.rectangle(-wallThick / 2, H / 2, wallThick, H + 200, wallOpts),   // 좌벽
        Bodies.rectangle(W + wallThick / 2, H / 2, wallThick, H + 200, wallOpts), // 우벽
    ];
    Composite.add(matterEngine.world, walls);

    // ── 플레이어 볼 생성 ──
    const ballR = Math.max(10, Math.min(16, W / (players.length * 6 + 12)));
    const ballDiam = ballR * 2 + 2;  // 공 사이 여백 2px

    // 시작 순서 랜덤 셔플 (왼쪽부터 순서는 랜덤)
    const slots = [...Array(players.length).keys()];
    for (let k = slots.length - 1; k > 0; k--) {
        const j = Math.floor(Math.random() * (k + 1));
        [slots[k], slots[j]] = [slots[j], slots[k]];
    }

    // 중앙 기준 나란히 배치
    const groupW = players.length * ballDiam;
    const groupStartX = W / 2 - groupW / 2;

    // 핀 배치는 ballR을 알아야 하므로 여기서 실행
    addPegs(W, H, ballR);

    players.forEach((p, i) => {
        const x = groupStartX + slots[i] * ballDiam + ballR;
        const jitterY = Math.random() * 8;  // Y 방향 약간 망이만

        const body = Bodies.circle(x, 28 + jitterY, ballR, {
            label: 'player_' + i,
            restitution: 0.35 + Math.random() * 0.25,
            friction: 0.01 + Math.random() * 0.04,
            frictionAir: 0.005 + Math.random() * 0.008,
            density: 0.002,
            bullet: true, // CCD(연속 충돌 감지) 활성화: 빠르게 떨어져도 바닥을 뚫지 않게 방지
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

    // ── 카메라 트래킹 옵션 렌더링 ──
    const cameraSelect = document.getElementById('camera-select');
    cameraSelect.innerHTML = '<option value="auto">가장 앞선 사람 (기본)</option>';
    players.forEach((p, i) => {
        const opt = document.createElement('option');
        opt.value = i;
        opt.textContent = `[${i + 1}] ${p.name}`;
        cameraSelect.appendChild(opt);
    });
    cameraSelect.value = 'auto'; // 기본값

    // ── 렌더 루프 (레이블 동기화 + 카메라 스크롤) ──
    const canvasWrapper = document.querySelector('.canvas-wrapper');
    function labelLoop() {
        let maxY = 0; // 'auto' 모드용 최대 깊이
        let targetY = 0;
        let isAuto = cameraSelect.value === 'auto';

        balls.forEach((b) => {
            const lbl = document.getElementById(`label-${b.idx}`);
            if (lbl) {
                lbl.style.left = b.body.position.x + 'px';
                lbl.style.top = b.body.position.y + 'px';
            }

            if (isAuto && !b.landed && b.body.position.y > maxY) {
                maxY = b.body.position.y;
            }

            // 특정 플레이어 추적 모드
            if (!isAuto && b.idx === parseInt(cameraSelect.value)) {
                targetY = b.body.position.y;
            }
        });

        // 카메라 타겟 위치 결정
        const finalTargetY = isAuto ? maxY : targetY;

        // 타겟 위치를 화면 약간 아래에(60%) 두어 공이 덜 가려지게 조정
        const targetScroll = finalTargetY - canvasWrapper.clientHeight * 0.6;

        // 부드럽지만 재빠르게 쫓아가기 (계수 0.5)
        canvasWrapper.scrollTop += (targetScroll - canvasWrapper.scrollTop) * 0.5;

        animFrameId = requestAnimationFrame(labelLoop);
    }
    labelLoop();

    // 엔진 시작
    Render.run(matterRender);
    Runner.run(matterRunner, matterEngine);

    // 안전망: 45초 후 아직 안 끝났으면 강제 종료
    setTimeout(() => {
        if (!gameFinished) {
            balls.filter(b => !b.landed).forEach(b => {
                b.landed = true;
                rankingOrder.push(b);
                addRankingItem(rankingOrder.length, b);
            });
            if (rankingOrder.length > 0) showResult();
        }
    }, 45000);
}

// 카메라 셀렉트 변경 시 빈 함수 (onchange 용)
function changeCameraTarget() {
    // 뷰포트 내 스크롤 계산은 labelLoop에서 처리됨
}

// ─── 지형 배치 (램프 없음 – 공이 절대 막히지 않음) ─────────
function addPegs(W, H, ballR) {
    const { Bodies, Composite } = Matter;

    const pegStyle = { fillStyle: 'rgba(34,211,238,0.30)', strokeStyle: 'rgba(34,211,238,0.9)', lineWidth: 1.5 };
    const bumperStyle = { fillStyle: 'rgba(245,158,11,0.38)', strokeStyle: 'rgba(245,158,11,1.0)', lineWidth: 2.5 };

    function peg(x, y, r) { return Bodies.circle(x, y, r, { isStatic: true, restitution: 0.45, friction: 0.04, render: pegStyle }); }
    function bumper(x, y, r) { return Bodies.circle(x, y, r, { isStatic: true, restitution: 0.72, friction: 0.0, render: bumperStyle }); }

    const pegR = Math.max(4, Math.min(7, W / 110));

    // ── 범퍼 – 각 20% 구간마다 배치할 좌표들을 먼저 미리 정의 ──
    const BUMPER_ZONES = 5;
    const bumperPositions = [
        // [xRatio, yRatio, radius]
        [0.20, 0.12, 11], [0.50, 0.11, 13], [0.80, 0.12, 11],
        [0.30, 0.30, 12], [0.70, 0.30, 12],
        [0.15, 0.47, 11], [0.50, 0.46, 14], [0.85, 0.47, 11],
        [0.28, 0.63, 12], [0.72, 0.63, 12],
        [0.18, 0.79, 11], /* [0.50, 0.78, 14] 중앙 범퍼는 공이 빠지는데 방해되므로 제거 */[0.82, 0.79, 11],
    ];

    // ── 지그재그 핀 – 20행, 5배 높이 전체 균등 배치 ──
    const TOTAL_ROWS = 20;
    const COLS = 11;
    const marginX = W * 0.06;
    const gapX = (W - marginX * 2) / (COLS - 1);
    // 상단 8%, 하단 4% 여백
    const topY = H * 0.04;
    const botY = H * 0.96;
    const gapY = (botY - topY) / (TOTAL_ROWS - 1);

    for (let row = 0; row < TOTAL_ROWS; row++) {
        const even = row % 2 === 0;
        const cnt = even ? COLS : COLS - 1;
        const ox = even ? 0 : gapX / 2;
        const y = topY + row * gapY;

        for (let c = 0; c < cnt; c++) {
            const x = marginX + ox + c * gapX;
            // 벽 근처 핀은 살짝 안쪽으로 (공 낄 공간 없애기)
            if (x < 20 || x > W - 20) continue;

            // 하단 V자 깔때기 부근 핀 제거 조건 강화
            if (y > H * 0.94) continue;
            if (y > H * 0.88 && (x < W * 0.35 || x > W * 0.65)) continue;

            // 핵심: 범퍼(노란색) 주변의 핀(파란색)은 길막/겹침 방지를 위해 아예 생성하지 않음
            let isTooCloseToBumper = false;
            for (let [bxRatio, byRatio, br] of bumperPositions) {
                const bx = W * bxRatio;
                const by = H * byRatio;
                // 두 점 사이의 거리 계산
                const dist = Math.hypot(x - bx, y - by);
                // 공이 지나갈 수 있는 충분한 여백(공 지름의 1.8배 + 범퍼 반경) 확보
                if (dist < br + (ballR * 2 * 1.8)) {
                    isTooCloseToBumper = true;
                    break;
                }
            }
            if (isTooCloseToBumper) continue;

            Composite.add(matterEngine.world, peg(x, y, pegR));
        }
    }

    bumperPositions.forEach(([xr, yr, r]) => {
        Composite.add(matterEngine.world, bumper(W * xr, H * yr, r));
    });

    // ── 마지막 게이트: 공 3개 너비만 남기고 좌우 벽 막기 (V자 깔때기 형태) ──
    const gateGap = Math.max(ballR * 2 * 3 + 10, 80); // 공 3개 지름 + 여유
    const gateY = H * 0.965; // 위치 약간 조정
    const gateH = 16;
    const wallStyle = { fillStyle: 'rgba(168,85,247,0.45)', strokeStyle: 'rgba(168,85,247,1)', lineWidth: 2 };

    // 좌우 벽의 길이 계산 (대각선 길이 고려)
    const gateW = W / 2 - gateGap / 2 + 20;

    // 기울기 각도 (라디안)
    const angle = 0.25; // 약 14도 기울기

    if (gateW > 30) {
        // 왼쪽 벽 (오른쪽 아래로 기울어짐)
        Composite.add(matterEngine.world, Bodies.rectangle(
            gateW / 2 - 10, gateY - Math.sin(angle) * (gateW / 2), gateW, gateH,
            { isStatic: true, restitution: 0.3, angle: angle, render: wallStyle }
        ));
        // 오른쪽 벽 (왼쪽 아래로 기울어짐)
        Composite.add(matterEngine.world, Bodies.rectangle(
            W - gateW / 2 + 10, gateY - Math.sin(angle) * (gateW / 2), gateW, gateH,
            { isStatic: true, restitution: 0.3, angle: -angle, render: wallStyle }
        ));
    }
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

    // 카메라(스크롤) 맨 위로 초기화
    document.querySelector('.canvas-wrapper').scrollTop = 0;

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
