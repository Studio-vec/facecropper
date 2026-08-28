// 대기 중 미니게임 로직 전체를 메인 스레드와 분리된 워커에서 실행한다.
// 얼굴 인식·업스케일·배경 제거처럼 메인 스레드를 오래 점유하는 작업이 돌아가는 동안에도
// 게임 렌더링(OffscreenCanvas)이 끊기지 않도록 하기 위함.

let canvas = null;
let ctx = null;
let sprite = null;
let obstacleSprite = null;

const SHEET_FRAME_W = 491, SHEET_FRAME_H = 619; // owl-sprite.png: idle, jump
const IDLE_FRAME = 0;
const JUMP_FRAME = 1;

const OBST_FRAME_W = 550, OBST_FRAME_H = 430; // obstacles.png: book, newspaper
const OBST_TYPES = [
  { frame: 0, minH: 20, maxH: 28 }, // 책 (낮고 넓음)
  { frame: 1, minH: 26, maxH: 38 }, // 신문 (조금 더 높음, 여유 있게 점프 가능한 높이)
];

let W = 400, H = 170;
const GROUND_Y = 140;
const CHAR_X = 30, CHAR_W = 43, CHAR_H = 54;
const GRAVITY = 0.7, JUMP_POWER = 10;

let state = 'idle'; // idle | playing | over
let jumpOffset = 0, jumpVel = 0;
let obstacles = [];
let spawnTimer = 60;
let speed = 3.2;
let score = 0;
let best = 0;
let walkPhase = 0;
let rafId = null;
let running = false; // 화면에 보이는 동안에만 루프를 돌린다

function reset() {
  state = 'idle';
  jumpOffset = 0; jumpVel = 0;
  obstacles = []; spawnTimer = 60; speed = 3.2; score = 0; walkPhase = 0;
}

function jump() {
  if (state === 'idle') { state = 'playing'; return; }
  if (state === 'over') { reset(); state = 'playing'; return; }
  if (state === 'playing' && jumpOffset === 0) jumpVel = JUMP_POWER;
}

function spawnObstacle() {
  const type = OBST_TYPES[Math.floor(Math.random() * OBST_TYPES.length)];
  const h = type.minH + Math.random() * (type.maxH - type.minH);
  const w = h * (OBST_FRAME_W / OBST_FRAME_H);
  obstacles.push({ x: W + 10, w, h, frame: type.frame });
}

function step() {
  if (state === 'playing') {
    jumpOffset += jumpVel;
    jumpVel -= GRAVITY;
    if (jumpOffset < 0) { jumpOffset = 0; jumpVel = 0; }
    if (jumpOffset === 0) walkPhase += 0.28;

    spawnTimer--;
    if (spawnTimer <= 0) {
      spawnObstacle();
      spawnTimer = Math.max(45, 90 - speed * 6) + Math.random() * 30;
    }
    obstacles.forEach(o => o.x -= speed);
    obstacles = obstacles.filter(o => o.x + o.w > -10);
    speed = Math.min(speed + 0.002, 7.5);
    score += speed * 0.08;

    const cb = { x: CHAR_X + 8, y: GROUND_Y - jumpOffset - CHAR_H + 10, w: CHAR_W - 16, h: CHAR_H - 14 };
    for (const o of obstacles) {
      const ob = { x: o.x + o.w * 0.2, y: GROUND_Y - o.h * 0.75, w: o.w * 0.6, h: o.h * 0.75 };
      if (cb.x < ob.x + ob.w && cb.x + cb.w > ob.x && cb.y < ob.y + ob.h && cb.y + cb.h > ob.y) {
        state = 'over';
        if (Math.floor(score) > best) {
          best = Math.floor(score);
          self.postMessage({ type: 'newBest', value: best });
        }
      }
    }
  }

  draw();
  rafId = running ? requestAnimationFrame(step) : null;
}

function draw() {
  if (!ctx) return;
  ctx.clearRect(0, 0, W, H);

  ctx.strokeStyle = '#111';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, GROUND_Y + 1);
  ctx.lineTo(W, GROUND_Y + 1);
  ctx.stroke();

  if (obstacleSprite) {
    obstacles.forEach(o => ctx.drawImage(
      obstacleSprite,
      o.frame * OBST_FRAME_W, 0, OBST_FRAME_W, OBST_FRAME_H,
      o.x, GROUND_Y - o.h, o.w, o.h
    ));
  }

  const frame = jumpOffset > 4 ? JUMP_FRAME : IDLE_FRAME;
  if (sprite) {
    // 걷는 모션(그라운드에서 좌우 스쿼시-스트레치 흔들림) + 진행 방향(오른쪽)으로 좌우 반전
    const wobble = (state === 'playing' && jumpOffset === 0) ? Math.sin(walkPhase) * 0.05 : 0;
    const pivotX = CHAR_X + CHAR_W / 2, pivotY = GROUND_Y;
    ctx.save();
    ctx.translate(pivotX, pivotY);
    ctx.scale(-(1 + wobble), 1 - wobble);
    ctx.translate(-pivotX, -pivotY);
    ctx.drawImage(
      sprite,
      frame * SHEET_FRAME_W, 0, SHEET_FRAME_W, SHEET_FRAME_H,
      CHAR_X, GROUND_Y - jumpOffset - CHAR_H, CHAR_W, CHAR_H
    );
    ctx.restore();
  }

  // 워커 안에서는 페이지가 불러온 웹폰트를 쓸 수 없어 기본 sans-serif로 표시(한글은 OS 기본 폰트로 정상 표시됨)
  ctx.fillStyle = '#111';
  ctx.font = '12px sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(`SCORE ${Math.floor(score)}`, W - 8, 18);
  ctx.fillText(`BEST ${best}`, W - 8, 32);

  if (state === 'idle') {
    ctx.textAlign = 'center';
    ctx.fillText('탭 / 스페이스바로 시작', W / 2, H / 2);
  } else if (state === 'over') {
    ctx.textAlign = 'center';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText('GAME OVER', W / 2, H / 2 - 8);
    ctx.font = '12px sans-serif';
    ctx.fillText('탭해서 다시 시작', W / 2, H / 2 + 10);
  }
}

function startLoop() {
  running = true;
  if (!rafId) rafId = requestAnimationFrame(step);
}
function stopLoop() {
  running = false;
  if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
}

async function loadBitmap(url) {
  const res = await fetch(url);
  const blob = await res.blob();
  return createImageBitmap(blob);
}

self.onmessage = async (e) => {
  const msg = e.data;
  if (msg.type === 'init') {
    canvas = msg.canvas;
    W = canvas.width; H = canvas.height;
    best = msg.best || 0;
    ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    draw();
    try {
      [sprite, obstacleSprite] = await Promise.all([
        loadBitmap('owl-sprite.png'),
        loadBitmap('obstacles.png'),
      ]);
    } catch (err) {
      // 스프라이트 로딩에 실패해도 게임 자체(바닥선·장애물·점수)는 계속 동작
    }
    draw();
  } else if (msg.type === 'jump') {
    jump();
  } else if (msg.type === 'visibility') {
    if (msg.visible) startLoop(); else stopLoop();
  }
};
