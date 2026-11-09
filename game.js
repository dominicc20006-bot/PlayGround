(() => {
  'use strict';

  const canvas = document.querySelector('#game');
  const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
  const mini = document.querySelector('#minimap');
  const mctx = mini.getContext('2d');
  const $ = (id) => document.getElementById(id);
  const ui = {
    fps: $('fps'), progress: $('mission-progress'), count: $('mission-count'), kills: $('kill-count'), credits: $('credits'),
    hp: $('health-fill'), hpValue: $('health-value'), armor: $('armor-fill'), armorValue: $('armor-value'),
    ammo: $('ammo-current'), reserve: $('ammo-reserve'), ammoTrack: $('ammo-track'), crosshair: $('crosshair'),
    toast: $('toast'), hit: $('hit-marker'), vignette: $('damage-vignette'), prompt: $('interaction-prompt'),
    objective: $('objective-banner'), start: $('start-overlay'), pause: $('pause-overlay'),
  };
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const rnd = (n) => Math.round(n);
  const W = 2400, H = 1800;
  const roadsX = [120, 600, 1190, 1780, 2260];
  const roadsY = [120, 500, 1010, 1430, 1690];
  let width = 1, height = 1, dpr = 1, last = 0, elapsed = 0, fpsElapsed = 0, fpsFrames = 0;
  let started = false, paused = false, ended = false, firing = false, sprint = false, soundOn = false;
  let pointer = { x: 0, y: 0, down: false, active: false };
  let aimAngle = -Math.PI / 2, aimTouchAngle = null, aimTouchId = null, stick = { x: 0, y: 0, id: null };
  let toastTimer = 0, damageFlash = 0, fireTimer = 0, reloadTimer = 0;
  let kills = 0, credits = 0, ammo = 30, reserveAmmo = 120, hp = 100, armor = 65;
  let currentVehicle = null;
  const keys = new Set();
  const world = { buildings: [], trees: [], palms: [], cars: [], decals: [], pickups: [] };
  const player = { x: 600, y: 740, vx: 0, vy: 0, radius: 13, angle: -Math.PI / 2, speed: 210, invuln: 0 };
  const camera = { x: 0, y: 0 };
  const enemies = [], bullets = [], particles = [];
  const colors = {
    grass: '#8fae8c', park: '#86a77f', sand: '#d8bc88', road: '#525c58', road2: '#626b64',
    concrete: '#c4c0aa', block: '#b3b39e', water: '#3e7880', waterLight: '#70a7a2', lime: '#d6fa79',
  };

  function resize() {
    const rect = canvas.getBoundingClientRect();
    width = Math.max(1, rect.width); height = Math.max(1, rect.height);
    dpr = Math.min(window.devicePixelRatio || 1, width < 700 ? 1.35 : 1.6);
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
  }
  window.addEventListener('resize', resize, { passive: true }); resize();

  function buildWorld() {
    const xBlocks = [[165, 555], [650, 1145], [1240, 1735], [1830, 2215]];
    const yBlocks = [[165, 455], [550, 965], [1060, 1385], [1470, 1645]];
    const styles = [
      ['#bba991', '#d2c4a4', '#a8ad97'], ['#c5b394', '#d6c6a6', '#abb49e'],
      ['#c8b697', '#ded0b0', '#afbaa1'], ['#b6ad91', '#cec3a4', '#9cae98'],
    ];
    for (let r = 0; r < yBlocks.length; r++) for (let c = 0; c < xBlocks.length; c++) {
      const [x0, x1] = xBlocks[c], [y0, y1] = yBlocks[r];
      const zone = r === 3 ? 'boardwalk' : (r === 0 && c > 1 ? 'midrise' : 'low');
      if ((r === 1 && c === 2) || (r === 2 && c === 0)) {
        world.buildings.push({ x: x0 + 26, y: y0 + 24, w: x1 - x0 - 52, h: y1 - y0 - 48, color: '#789478', roof: '#829c77', park: true });
        continue;
      }
      if (zone === 'midrise') {
        const count = 2;
        for (let i = 0; i < count; i++) {
          const bw = rand(140, 185), bh = rand(115, 150);
          const bx = x0 + 28 + i * 230 + rand(-8, 8), by = y0 + 28 + (i % 2) * 112;
          world.buildings.push(makeBuilding(bx, by, bw, bh, styles[(r + c + i) % styles.length], 'mid'));
        }
      } else {
        const cols = 2, rows = (y1 - y0) > 350 ? 2 : 1;
        for (let rr = 0; rr < rows; rr++) for (let cc = 0; cc < cols; cc++) {
          const bw = rand(130, Math.min(196, (x1 - x0) / 2 - 36));
          const bh = rand(90, Math.min(150, (y1 - y0) / rows - 28));
          const bx = x0 + (cc + .5) * (x1 - x0) / cols - bw / 2 + rand(-8, 8);
          const by = y0 + (rr + .5) * (y1 - y0) / rows - bh / 2 + rand(-8, 8);
          world.buildings.push(makeBuilding(bx, by, bw, bh, styles[(r * 3 + c + cc + rr) % styles.length], zone));
        }
      }
    }
    for (let x = 170; x < 2250; x += 65) {
      world.palms.push({ x, y: 1404 + Math.sin(x * .018) * 12, size: rand(.8, 1.15), angle: rand(-.2, .2) });
      if (x % 130 < 65) world.trees.push({ x: x + 24, y: 480 + rand(-14, 14), size: rand(.8, 1.2) });
    }
    for (let y = 190; y < 1380; y += 86) {
      for (const x of [140, 580, 1180, 1770, 2240]) world.trees.push({ x: x + rand(-13, 13), y, size: rand(.72, 1.08) });
    }
    for (let i = 0; i < 50; i++) {
      const x = rand(170, 2230), y = rand(170, 1370);
      if (!world.buildings.some(b => x > b.x - 15 && x < b.x + b.w + 15 && y > b.y - 15 && y < b.y + b.h + 15))
        world.decals.push({ x, y, kind: Math.random() < .5 ? 'crack' : 'stain', r: rand(8, 30) });
    }
    // Keep every vehicle on a clear street tile so entering one can never trap the player in a building.
    world.cars.push(makeCar(580, 740, '#c5d4cb', -Math.PI / 2), makeCar(830, 1010, '#d66c4e', 0), makeCar(1570, 475, '#e3b94e', Math.PI / 2), makeCar(1970, 1430, '#4d8c91', Math.PI));
  }
  function makeBuilding(x, y, w, h, palette, zone) {
    const paletteColors = palette;
    const color = paletteColors[Math.floor(rand(0, paletteColors.length))];
    return { x, y, w, h, color, roof: zone === 'mid' ? '#9a9682' : '#d1c3a0', zone, seed: rand(0, 1000), awning: Math.random() < .55, awningColor: ['#d57f5d', '#65918a', '#d6d1b3'][Math.floor(rand(0, 3))] };
  }
  function makeCar(x, y, color, angle) { return { x, y, color, angle, occupied: false, w: 42, h: 22, speed: 0 }; }
  function blocked(x, y, radius = 10) {
    if (x < 32 || y < 32 || x > W - 32 || y > H - 32) return true;
    return world.buildings.some(b => !b.park && x + radius > b.x && x - radius < b.x + b.w && y + radius > b.y && y - radius < b.y + b.h);
  }
  buildWorld();

  function spawnEnemies() {
    enemies.length = 0;
    const spots = [[600, 500], [1190, 500], [1780, 500], [600, 1010], [1190, 1010], [1780, 1010]];
    for (let i = 0; i < 6; i++) enemies.push({ x: spots[i][0], y: spots[i][1], hp: 100, maxHp: 100, angle: Math.PI, fire: rand(.3, 1.8), hit: 0, dead: false, state: 'idle', seed: Math.random() * 10, strafe: Math.random() < .5 ? -1 : 1 });
  }
  spawnEnemies();

  function drawWorld() {
    ctx.fillStyle = colors.grass; ctx.fillRect(0, 0, W, H);
    // Parkland and beach boardwalk
    ctx.fillStyle = '#86a47e'; ctx.fillRect(0, 1020, 2400, 340);
    ctx.fillStyle = '#d9c38f'; ctx.fillRect(0, 1368, 2400, 104);
    ctx.fillStyle = colors.water; ctx.fillRect(0, 1472, 2400, 328);
    ctx.fillStyle = '#477f83'; ctx.fillRect(0, 1480, 2400, 320);
    for (let i = 0; i < 22; i++) {
      const y = 1500 + i * 14, phase = (elapsed * 10 + i * 33) % 70;
      ctx.strokeStyle = `rgba(169,220,204,${.055 + (i % 3) * .014})`; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(-20 + phase, y); ctx.bezierCurveTo(340 + phase, y - 8, 770 + phase, y + 9, 1180 + phase, y); ctx.stroke();
    }
    ctx.fillStyle = '#d3c497'; ctx.fillRect(0, 1400, 2400, 72);
    // Street grid and sidewalks
    for (const x of roadsX) {
      ctx.fillStyle = colors.road; ctx.fillRect(x - 46, 0, 92, 1470);
      ctx.fillStyle = '#d0cbb6'; ctx.fillRect(x - 55, 0, 9, 1470); ctx.fillRect(x + 46, 0, 9, 1470);
      ctx.strokeStyle = '#d2d0b1'; ctx.lineWidth = 2; ctx.setLineDash([19, 20]);
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 1470); ctx.stroke(); ctx.setLineDash([]);
    }
    for (const y of roadsY.slice(0, 4)) {
      ctx.fillStyle = colors.road; ctx.fillRect(0, y - 43, W, 86);
      ctx.fillStyle = '#d0cbb6'; ctx.fillRect(0, y - 52, W, 9); ctx.fillRect(0, y + 43, W, 9);
      ctx.strokeStyle = '#d2d0b1'; ctx.lineWidth = 2; ctx.setLineDash([20, 20]);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); ctx.setLineDash([]);
    }
    // Crosswalks, curb marks, lanes
    for (const x of roadsX.slice(1, -1)) for (const y of roadsY.slice(1, 4)) {
      ctx.fillStyle = '#e6e3d2a8';
      for (let k = -3; k <= 3; k++) { ctx.fillRect(x - 49 + k * 11, y - 62, 6, 14); ctx.fillRect(x - 49 + k * 11, y + 48, 6, 14); }
    }
    for (const b of world.buildings) drawBuilding(b);
    for (const d of world.decals) {
      ctx.globalAlpha = d.kind === 'stain' ? .09 : .16; ctx.strokeStyle = '#566354'; ctx.fillStyle = '#4d5e51';
      if (d.kind === 'stain') { ctx.beginPath(); ctx.ellipse(d.x, d.y, d.r, d.r * .46, .2, 0, TAU); ctx.fill(); }
      else { ctx.beginPath(); ctx.moveTo(d.x, d.y); ctx.lineTo(d.x + d.r, d.y + 3); ctx.lineTo(d.x + d.r + 6, d.y - 1); ctx.stroke(); }
      ctx.globalAlpha = 1;
    }
    for (const t of world.trees) drawTree(t);
    for (const p of world.palms) drawPalm(p);
    for (const car of world.cars) drawCar(car);
  }
  function drawBuilding(b) {
    if (b.park) {
      ctx.fillStyle = '#7b9b76'; ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.fillStyle = '#b7bd9b'; ctx.fillRect(b.x + b.w * .43, b.y + 12, 14, b.h - 24);
      ctx.fillRect(b.x + 14, b.y + b.h * .52, b.w - 28, 12);
      for (let i = 0; i < 22; i++) drawTree({ x: b.x + 28 + (i % 6) * (b.w - 56) / 5, y: b.y + 25 + Math.floor(i / 6) * (b.h - 50) / 3, size: .62 });
      return;
    }
    ctx.fillStyle = '#4b5c53'; ctx.globalAlpha = .26; ctx.fillRect(b.x + 9, b.y + 13, b.w, b.h); ctx.globalAlpha = 1;
    ctx.fillStyle = b.color; ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.fillStyle = b.roof; ctx.fillRect(b.x + 7, b.y + 7, b.w - 14, b.h - 14);
    ctx.strokeStyle = '#ffffff35'; ctx.lineWidth = 2; ctx.strokeRect(b.x + 8, b.y + 8, b.w - 16, b.h - 16);
    if (b.zone === 'mid') {
      ctx.fillStyle = '#7d8c80';
      for (let i = 0; i < 4; i++) { ctx.fillRect(b.x + 17 + i * 37, b.y + 18, 19, 14); ctx.fillRect(b.x + 17 + i * 37, b.y + b.h - 31, 19, 14); }
      ctx.fillStyle = '#c9c4a9'; ctx.fillRect(b.x + b.w * .42, b.y + b.h * .38, b.w * .16, b.h * .24);
    } else {
      // Roof HVAC, skylights, and rooftop shadows add a readable city silhouette.
      ctx.fillStyle = '#928e79'; ctx.fillRect(b.x + b.w * .22, b.y + b.h * .2, b.w * .2, 16);
      ctx.fillStyle = '#a7a38a'; ctx.fillRect(b.x + b.w * .63, b.y + b.h * .58, b.w * .19, 20);
      ctx.fillStyle = '#828875'; ctx.fillRect(b.x + b.w * .49, b.y + b.h * .12, 22, 16);
      ctx.fillStyle = '#dad1b2'; ctx.fillRect(b.x + b.w * .1, b.y + b.h - 20, b.w * .28, 7);
      if (b.awning) { ctx.fillStyle = b.awningColor; ctx.fillRect(b.x + 15, b.y + b.h - 5, b.w * .38, 6); }
    }
    ctx.fillStyle = '#536254'; ctx.fillRect(b.x + 13, b.y + b.h - 12, 21, 5);
  }
  function drawTree(t) {
    const s = t.size;
    ctx.fillStyle = '#344b3d45'; ctx.beginPath(); ctx.ellipse(t.x + 5, t.y + 8, 19 * s, 11 * s, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#6f5940'; ctx.fillRect(t.x - 3 * s, t.y - 5 * s, 6 * s, 14 * s);
    ctx.fillStyle = ['#416b4d', '#527b50', '#668650'][Math.floor((t.x + t.y) % 3)];
    ctx.beginPath(); ctx.arc(t.x, t.y - 8 * s, 16 * s, 0, TAU); ctx.fill();
    ctx.fillStyle = '#81a06a'; ctx.beginPath(); ctx.arc(t.x - 5 * s, t.y - 13 * s, 7 * s, 0, TAU); ctx.fill();
  }
  function drawPalm(p) {
    const s = p.size;
    ctx.fillStyle = '#344b3d48'; ctx.beginPath(); ctx.ellipse(p.x + 5, p.y + 8, 18 * s, 8 * s, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#745a39'; ctx.lineWidth = 5 * s; ctx.beginPath(); ctx.moveTo(p.x, p.y + 5); ctx.quadraticCurveTo(p.x - 4, p.y - 11, p.x + 2, p.y - 25 * s); ctx.stroke();
    ctx.strokeStyle = '#456f4e'; ctx.lineWidth = 3.5 * s;
    for (let i = 0; i < 7; i++) { const a = i * TAU / 7; ctx.beginPath(); ctx.moveTo(p.x + 2, p.y - 24 * s); ctx.quadraticCurveTo(p.x + Math.cos(a) * 12 * s, p.y - 36 * s, p.x + Math.cos(a) * 23 * s, p.y - 28 * s + Math.sin(a) * 13 * s); ctx.stroke(); }
  }

  function drawCar(car) {
    ctx.save(); ctx.translate(car.x, car.y); ctx.rotate(car.angle);
    ctx.fillStyle = '#273b3745'; ctx.beginPath(); ctx.ellipse(2, 5, 28, 16, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#222a28';
    for (const x of [-12, 12]) { ctx.fillRect(x - 5, -12, 10, 4); ctx.fillRect(x - 5, 8, 10, 4); }
    ctx.fillStyle = car.color; ctx.beginPath(); ctx.roundRect(-22, -10, 44, 20, 6); ctx.fill();
    ctx.fillStyle = '#a8c1b6'; ctx.beginPath(); ctx.roundRect(-10, -7, 18, 14, 4); ctx.fill();
    ctx.fillStyle = '#617e78'; ctx.fillRect(-8, -6, 8, 12);
    ctx.fillStyle = '#f2d89a'; ctx.fillRect(17, -7, 3, 5); ctx.fillRect(17, 3, 3, 5);
    ctx.fillStyle = '#db6852'; ctx.fillRect(-21, -7, 2, 5); ctx.fillRect(-21, 3, 2, 5);
    if (car.occupied) { ctx.fillStyle = '#d7ff70'; ctx.beginPath(); ctx.arc(0, 0, 3, 0, TAU); ctx.fill(); }
    ctx.restore();
  }

  function drawPerson(x, y, angle, type, hit = 0) {
    const isPlayer = type === 'player';
    ctx.save(); ctx.translate(x, y); ctx.rotate(angle);
    ctx.fillStyle = '#26382f45'; ctx.beginPath(); ctx.ellipse(2, 6, isPlayer ? 13 : 12, 8, 0, 0, TAU); ctx.fill();
    if (isPlayer) {
      ctx.fillStyle = '#263831'; ctx.beginPath(); ctx.roundRect(-9, -10, 19, 22, 6); ctx.fill();
      ctx.fillStyle = '#d8e1c4'; ctx.beginPath(); ctx.arc(0, -2, 7.5, 0, TAU); ctx.fill();
      ctx.fillStyle = '#c4e46a'; ctx.beginPath(); ctx.arc(0, -2, 5.2, 0, TAU); ctx.fill();
      ctx.fillStyle = '#d6e5c4'; ctx.fillRect(4, -4, 17, 4); ctx.fillStyle = '#34443b'; ctx.fillRect(15, -3, 12, 2);
    } else {
      ctx.fillStyle = hit > 0 ? '#f5d69c' : '#27363a'; ctx.beginPath(); ctx.roundRect(-8, -9, 17, 19, 5); ctx.fill();
      ctx.fillStyle = hit > 0 ? '#fff1cb' : '#be6a51'; ctx.beginPath(); ctx.arc(0, -2, 6.7, 0, TAU); ctx.fill();
      ctx.fillStyle = '#d5d9c7'; ctx.fillRect(3, -4, 16, 4); ctx.fillStyle = '#3a4541'; ctx.fillRect(14, -3, 11, 2);
      ctx.fillStyle = '#292f30'; ctx.beginPath(); ctx.arc(0, -5, 6.9, Math.PI, TAU); ctx.fill();
    }
    ctx.restore();
  }

  function visible(x, y, margin = 80) { return x > camera.x - margin && x < camera.x + width + margin && y > camera.y - margin && y < camera.y + height + margin; }
  function render() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#8fae8c'; ctx.fillRect(0, 0, width, height);
    ctx.save(); ctx.translate(-camera.x, -camera.y); drawWorld();
    for (const b of bullets) { ctx.fillStyle = b.friendly ? '#ecffad' : '#ffb184'; ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 8; ctx.beginPath(); ctx.arc(b.x, b.y, b.friendly ? 3 : 2.5, 0, TAU); ctx.fill(); ctx.shadowBlur = 0; }
    for (const p of particles) { ctx.globalAlpha = clamp(p.life / p.maxLife, 0, 1); ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.r * p.life / p.maxLife + 1, 0, TAU); ctx.fill(); }
    ctx.globalAlpha = 1;
    for (const e of enemies) if (!e.dead && visible(e.x, e.y)) {
      drawPerson(e.x, e.y, e.angle, 'enemy', e.hit);
      if (e.hp < e.maxHp) { ctx.fillStyle = '#26372e'; ctx.fillRect(e.x - 14, e.y - 23, 28, 3); ctx.fillStyle = '#e2795c'; ctx.fillRect(e.x - 14, e.y - 23, 28 * e.hp / e.maxHp, 3); }
      if (e.state === 'alert' && dist2(player, e) < 280 * 280) { ctx.fillStyle = '#ffe27f'; ctx.font = 'bold 13px sans-serif'; ctx.fillText('!', e.x - 2, e.y - 29); }
    }
    if (currentVehicle) {
      drawCar(currentVehicle);
      ctx.save(); ctx.translate(player.x, player.y); ctx.rotate(player.angle); ctx.fillStyle = '#d8f17d'; ctx.beginPath(); ctx.arc(-3, 0, 4, 0, TAU); ctx.fill(); ctx.restore();
    } else drawPerson(player.x, player.y, player.angle, 'player');
    ctx.restore();
    drawScreenFx(); drawMinimap();
  }
  function drawScreenFx() {
    const sx = player.x - camera.x, sy = player.y - camera.y;
    const grad = ctx.createRadialGradient(sx, sy, Math.min(width, height) * .17, sx, sy, Math.max(width, height) * .72);
    grad.addColorStop(0, 'rgba(255,244,204,0)'); grad.addColorStop(1, 'rgba(30,46,34,.18)');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, width, height);
    if (damageFlash > 0) { ctx.fillStyle = `rgba(191,48,38,${damageFlash * .18})`; ctx.fillRect(0, 0, width, height); }
    // Gentle warm sunlight and restrained grain-free vignette for performant mobile rendering.
    const g = ctx.createLinearGradient(0, 0, width, height); g.addColorStop(0, '#fff0d20a'); g.addColorStop(1, '#14261d14');
    ctx.fillStyle = g; ctx.fillRect(0, 0, width, height);
  }
  function drawMinimap() {
    const w = mini.width, h = mini.height; mctx.clearRect(0, 0, w, h);
    mctx.fillStyle = '#9eb49a'; mctx.fillRect(0, 0, w, h);
    const sx = w / W, sy = h / H; mctx.save(); mctx.scale(sx, sy);
    mctx.fillStyle = '#477f83'; mctx.fillRect(0, 1472, W, H - 1472);
    mctx.fillStyle = '#d9c38f'; mctx.fillRect(0, 1368, W, 104);
    mctx.fillStyle = '#59645d';
    for (const x of roadsX) mctx.fillRect(x - 46, 0, 92, 1470);
    for (const y of roadsY.slice(0, 4)) mctx.fillRect(0, y - 43, W, 86);
    mctx.fillStyle = '#84957f';
    for (const b of world.buildings) if (!b.park) mctx.fillRect(b.x, b.y, b.w, b.h);
    for (const e of enemies) if (!e.dead) { mctx.fillStyle = '#e27559'; mctx.beginPath(); mctx.arc(e.x, e.y, 13, 0, TAU); mctx.fill(); }
    mctx.fillStyle = '#f7f4df'; mctx.beginPath(); mctx.arc(player.x, player.y, 21, 0, TAU); mctx.fill();
    mctx.fillStyle = '#c8f76c'; mctx.beginPath(); mctx.arc(player.x, player.y, 14, 0, TAU); mctx.fill();
    mctx.strokeStyle = '#f4f4db'; mctx.lineWidth = 8; mctx.beginPath(); mctx.moveTo(player.x, player.y); mctx.lineTo(player.x + Math.cos(player.angle) * 47, player.y + Math.sin(player.angle) * 47); mctx.stroke();
    mctx.restore();
  }

  function update(dt) {
    if (!started || paused || ended) return;
    elapsed += dt; fpsElapsed += dt; fpsFrames++;
    if (fpsElapsed >= .5) { ui.fps.textContent = Math.round(fpsFrames / fpsElapsed); fpsElapsed = 0; fpsFrames = 0; }
    if (player.invuln > 0) player.invuln -= dt;
    if (damageFlash > 0) damageFlash = Math.max(0, damageFlash - dt * 1.8);
    if (toastTimer > 0 && (toastTimer -= dt) <= 0) ui.toast.classList.remove('show');
    if (fireTimer > 0) fireTimer -= dt;
    if (reloadTimer > 0 && (reloadTimer -= dt) <= 0) finishReload();
    updatePlayer(dt); updateEnemies(dt); updateBullets(dt); updateParticles(dt); updateCamera(dt); updateInteraction(); updateHud();
  }
  function updatePlayer(dt) {
    let ix = (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0) + stick.x;
    let iy = (keys.has('s') || keys.has('arrowdown') ? 1 : 0) - (keys.has('w') || keys.has('arrowup') ? 1 : 0) + stick.y;
    const mag = Math.hypot(ix, iy); if (mag > 1) { ix /= mag; iy /= mag; }
    const running = sprint || keys.has('shift');
    if (currentVehicle) {
      const throttle = (keys.has('w') || keys.has('arrowup') ? 1 : 0) - (keys.has('s') || keys.has('arrowdown') ? 1 : 0) - stick.y;
      const steer = (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0) + stick.x;
      currentVehicle.speed += throttle * 290 * dt; currentVehicle.speed *= Math.pow(.982, dt * 60); currentVehicle.speed = clamp(currentVehicle.speed, -120, 330);
      currentVehicle.angle += steer * (currentVehicle.speed / 330) * 2.45 * dt;
      const nx = player.x + Math.cos(currentVehicle.angle) * currentVehicle.speed * dt, ny = player.y + Math.sin(currentVehicle.angle) * currentVehicle.speed * dt;
      if (!blocked(nx, ny, 22)) { player.x = nx; player.y = ny; currentVehicle.x = nx; currentVehicle.y = ny; }
      if (Math.abs(currentVehicle.speed) > 40) player.angle = currentVehicle.angle;
    } else {
      const max = player.speed * (running ? 1.46 : 1);
      player.vx += ((ix * max) - player.vx) * Math.min(1, dt * 10);
      player.vy += ((iy * max) - player.vy) * Math.min(1, dt * 10);
      const nx = player.x + player.vx * dt, ny = player.y + player.vy * dt;
      if (!blocked(nx, player.y, player.radius)) player.x = nx; else player.vx = 0;
      if (!blocked(player.x, ny, player.radius)) player.y = ny; else player.vy = 0;
      if (pointer.active && !isTouchDevice()) aimAngle = Math.atan2(pointer.y + camera.y - player.y, pointer.x + camera.x - player.x);
      // Aim-pad pointer movement updates aimAngle directly.
      if (Math.hypot(ix, iy) > .05 && !pointer.active && aimTouchAngle === null) aimAngle = Math.atan2(iy, ix);
      player.angle = aimAngle;
    }
    if (firing || pointer.down) attemptFire();
    // Nearby collisions and opportunistic vehicle takedowns.
    for (const e of enemies) if (!e.dead && currentVehicle && Math.abs(currentVehicle.speed) > 140 && dist2(player, e) < 34 ** 2) damageEnemy(e, 100, true);
  }
  function updateEnemies(dt) {
    for (const e of enemies) {
      if (e.dead) continue;
      e.hit = Math.max(0, e.hit - dt); e.fire -= dt;
      const d = Math.sqrt(dist2(player, e));
      if (d < 430) e.state = 'alert';
      if (d < 390) {
        const desired = Math.atan2(player.y - e.y, player.x - e.x); e.angle = desired;
        if (d > 180) {
          const strafe = Math.sin(elapsed * 1.8 + e.seed) * 25;
          const vx = Math.cos(desired) * 48 + Math.cos(desired + Math.PI / 2) * strafe * e.strafe;
          const vy = Math.sin(desired) * 48 + Math.sin(desired + Math.PI / 2) * strafe * e.strafe;
          const nx = e.x + vx * dt, ny = e.y + vy * dt;
          if (!blocked(nx, e.y, 13)) e.x = nx;
          if (!blocked(e.x, ny, 13)) e.y = ny;
        }
        if (e.fire <= 0 && d < 380) { e.fire = rand(.75, 1.5); bullets.push({ x: e.x + Math.cos(desired) * 22, y: e.y + Math.sin(desired) * 22, vx: Math.cos(desired) * 285, vy: Math.sin(desired) * 285, life: 1.5, friendly: false, damage: rand(7, 11) }); }
      }
    }
  }
  function updateBullets(dt) {
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i]; b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
      let remove = b.life <= 0 || blocked(b.x, b.y, 2);
      if (b.friendly) {
        for (const e of enemies) if (!e.dead && dist2(b, e) < 22 ** 2) { damageEnemy(e, b.damage, true); remove = true; break; }
      } else if (!currentVehicle && player.invuln <= 0 && dist2(b, player) < 18 ** 2) { damagePlayer(b.damage); remove = true; }
      else if (currentVehicle && dist2(b, player) < 23 ** 2) { damagePlayer(b.damage * .55); remove = true; }
      if (remove) bullets.splice(i, 1);
    }
  }
  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) { particles[i].life -= dt; particles[i].x += particles[i].vx * dt; particles[i].y += particles[i].vy * dt; particles[i].vx *= .97; particles[i].vy *= .97; if (particles[i].life <= 0) particles.splice(i, 1); }
  }
  function updateCamera(dt) {
    const tx = clamp(player.x - width * .5, 0, W - width), ty = clamp(player.y - height * .52, 0, H - height);
    const smooth = 1 - Math.exp(-dt * 5.5); camera.x += (tx - camera.x) * smooth; camera.y += (ty - camera.y) * smooth;
  }
  function updateInteraction() {
    const enterButton = $('enter-btn');
    if (currentVehicle) {
      ui.prompt.textContent = 'E / ENTER — EXIT VEHICLE'; ui.prompt.classList.add('show');
      if (window.innerWidth <= 750) { enterButton.innerHTML = '↗<small>EXIT</small>'; enterButton.style.display = 'flex'; }
      return;
    }
    const car = world.cars.find(c => Math.abs(c.x - player.x) < 62 && Math.abs(c.y - player.y) < 62);
    if (car) {
      currentVehicle = null; window.nearCar = car; ui.prompt.textContent = 'E / ENTER — TAKE THE WHEEL'; ui.prompt.classList.add('show');
      if (window.innerWidth <= 750) { enterButton.innerHTML = '↗<small>ENTER</small>'; enterButton.style.display = 'flex'; }
    } else { window.nearCar = null; ui.prompt.classList.remove('show'); enterButton.style.display = 'none'; }
  }
  function updateHud() {
    ui.progress.style.width = `${kills / 6 * 100}%`; ui.count.textContent = `${kills} / 6`; ui.kills.textContent = String(kills).padStart(2, '0');
    ui.credits.textContent = String(credits).padStart(3, '0'); ui.hp.style.width = `${hp}%`; ui.hpValue.textContent = rnd(hp);
    ui.armor.style.width = `${armor / 65 * 100}%`; ui.armorValue.textContent = rnd(armor); ui.ammo.textContent = ammo; ui.reserve.textContent = reserveAmmo;
    if (ui.ammoTrack.childElementCount !== 30) { ui.ammoTrack.innerHTML = ''; for (let i = 0; i < 30; i++) { const segment = document.createElement('i'); ui.ammoTrack.appendChild(segment); } }
    [...ui.ammoTrack.children].forEach((el, i) => el.classList.toggle('empty', i >= ammo));
  }
  function attemptFire() {
    if (currentVehicle || reloadTimer > 0 || ammo <= 0 || fireTimer > 0) { if (ammo <= 0 && reserveAmmo > 0 && reloadTimer <= 0) reload(); return; }
    fireTimer = .105; ammo--;
    const a = player.angle, muzzleX = player.x + Math.cos(a) * 26, muzzleY = player.y + Math.sin(a) * 26;
    bullets.push({ x: muzzleX, y: muzzleY, vx: Math.cos(a) * 760, vy: Math.sin(a) * 760, life: .72, friendly: true, damage: 38 });
    particles.push({ x: muzzleX, y: muzzleY, vx: rand(-20, 20), vy: rand(-20, 20), life: .08, maxLife: .08, r: 10, color: '#ffe6a1' });
    ui.crosshair.classList.add('firing'); setTimeout(() => ui.crosshair.classList.remove('firing'), 65);
  }
  function damageEnemy(e, amount, hit) {
    if (e.dead) return;
    e.hp -= amount; e.hit = .12; e.state = 'alert';
    if (hit) { ui.hit.classList.remove('show'); void ui.hit.offsetWidth; ui.hit.classList.add('show'); }
    if (e.hp <= 0) {
      e.dead = true; kills++; credits += 200; addToast(`TARGET DOWN  +200 CR`);
      for (let i = 0; i < 9; i++) particles.push({ x: e.x, y: e.y, vx: rand(-90, 90), vy: rand(-80, 80), life: rand(.2, .5), maxLife: .5, r: rand(2, 4), color: ['#db835e', '#e1d3a6', '#9daf78'][i % 3] });
      if (kills >= 6) finishMission();
    }
  }
  function damagePlayer(amount) {
    if (ended || player.invuln > 0 || hp <= 0) return;
    if (armor > 0) { const absorbed = Math.min(armor, amount * .72); armor -= absorbed; amount -= absorbed; }
    hp = Math.max(0, hp - amount); player.invuln = .32; damageFlash = 1;
    ui.vignette.classList.add('active'); setTimeout(() => ui.vignette.classList.remove('active'), 180);
    if (hp <= 0) { ended = true; setTimeout(() => showEnd(false), 350); }
  }
  function finishReload() { const n = Math.min(30 - ammo, reserveAmmo); ammo += n; reserveAmmo -= n; reloadTimer = 0; addToast('MAGAZINE RELOADED'); }
  function reload() { if (started && !paused && !ended && ammo < 30 && reserveAmmo > 0 && reloadTimer <= 0) { reloadTimer = 1.15; addToast('RELOADING…'); } }
  function finishMission() { ended = true; credits += 0; ui.objective.classList.add('show'); addToast('CONTRACT COMPLETE'); setTimeout(() => showEnd(true), 2800); }
  function showEnd(won) {
    paused = false; ui.pause.classList.add('hidden');
    const overlay = document.createElement('section'); overlay.className = 'overlay'; overlay.innerHTML = `<div class="pause-box"><div class="eyebrow">${won ? 'CONTRACT COMPLETE' : 'RUN ENDED'}</div><h2>${won ? 'BLOCK<br><em>SECURED.</em>' : 'YOU WENT<br><em>DOWN.</em>'}</h2><p>${won ? 'The boardwalk is yours. The coast remembers.' : 'The coast is unforgiving. Give it another run.'}</p><button class="primary-btn" id="again-btn">${won ? 'RUN IT BACK' : 'REDEPLOY'} <span>↗</span></button></div>`;
    $('game-shell').appendChild(overlay); $('again-btn').addEventListener('click', () => location.reload());
  }
  function addToast(text) { ui.toast.textContent = text; ui.toast.classList.add('show'); toastTimer = 1.5; }
  function enterVehicle() {
    if (!started || paused || ended) return;
    if (currentVehicle) {
      const car = currentVehicle;
      car.occupied = false; car.speed = 0; currentVehicle = null;
      const offsets = [Math.PI / 2, -Math.PI / 2, Math.PI, 0];
      const exit = offsets.map(a => ({ x: car.x + Math.cos(car.angle + a) * 34, y: car.y + Math.sin(car.angle + a) * 34 })).find(p => !blocked(p.x, p.y, player.radius));
      if (exit) { player.x = exit.x; player.y = exit.y; }
      player.vx = 0; player.vy = 0;
      return;
    }
    const c = window.nearCar; if (!c) return;
    currentVehicle = c; c.occupied = true; player.x = c.x; player.y = c.y; player.vx = 0; player.vy = 0; player.angle = c.angle; addToast('VEHICLE ACQUIRED  —  DRIVE SAFE');
  }
  function togglePause(force) {
    if (!started || ended) return;
    paused = force ?? !paused; ui.pause.classList.toggle('hidden', !paused);
    if (paused) { pointer.down = false; firing = false; sprint = false; keys.clear(); document.exitPointerLock?.(); }
  }
  function startGame() {
    if (started) return; started = true; ui.start.classList.add('hidden'); camera.x = clamp(player.x - width / 2, 0, W - width); camera.y = clamp(player.y - height / 2, 0, H - height);
    addToast('CLEAR THE BLOCK  —  ELIMINATE ALL HOSTILES'); canvas.focus?.();
  }
  function restart() { location.reload(); }
  function isTouchDevice() { return matchMedia('(pointer: coarse)').matches; }

  function bindInput() {
    $('start-btn').addEventListener('click', startGame);
    $('pause-btn').addEventListener('click', () => togglePause());
    $('resume-btn').addEventListener('click', () => togglePause(false));
    $('restart-btn').addEventListener('click', restart);
    $('sound-btn').addEventListener('click', () => { soundOn = !soundOn; $('sound-btn').style.color = soundOn ? '#d7ff70' : ''; addToast(soundOn ? 'SOUND ON' : 'SOUND OFF'); });
    $('reload-btn').addEventListener('pointerdown', (e) => { e.preventDefault(); reload(); });
    $('enter-btn').addEventListener('pointerdown', (e) => { e.preventDefault(); enterVehicle(); });
    $('jump-btn').addEventListener('pointerdown', (e) => { e.preventDefault(); if (!started || paused || ended) return; sprint = true; $('jump-btn').setPointerCapture(e.pointerId); });
    ['pointerup', 'pointercancel'].forEach(type => $('jump-btn').addEventListener(type, () => { sprint = false; }));
    $('fire-btn').addEventListener('pointerdown', (e) => { e.preventDefault(); if (!started || paused || ended) return; firing = true; attemptFire(); $('fire-btn').setPointerCapture(e.pointerId); });
    ['pointerup', 'pointercancel'].forEach(type => $('fire-btn').addEventListener(type, () => { firing = false; }));
    window.addEventListener('keydown', (e) => {
      const key = e.key.toLowerCase(); if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(key)) e.preventDefault();
      if (key === 'escape' || key === 'p') { togglePause(); return; }
      if (key === 'e' && !e.repeat) { enterVehicle(); return; }
      if (key === 'r' && !e.repeat) { reload(); return; }
      if (!started || paused || ended) return;
      if (key === 'shift') sprint = true;
      keys.add(key);
    });
    window.addEventListener('keyup', (e) => { const key = e.key.toLowerCase(); keys.delete(key); if (key === 'shift') sprint = false; });
    window.addEventListener('blur', () => { pointer.down = false; firing = false; sprint = false; keys.clear(); });
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'mouse') { pointer.x = e.clientX; pointer.y = e.clientY; pointer.active = true; }
      else if (aimTouchAngle !== null) {
        const dx = e.clientX - aimTouchLast.x, dy = e.clientY - aimTouchLast.y;
        aimAngle += dx * .009; aimTouchLast = { x: e.clientX, y: e.clientY };
      }
    });
    canvas.addEventListener('pointerdown', (e) => {
      if (!started || paused) return;
      if (e.pointerType === 'mouse') {
        pointer.active = true; pointer.x = e.clientX; pointer.y = e.clientY;
        if (e.button === 0) pointer.down = true;
      }
    });
    window.addEventListener('pointerup', (e) => { if (e.pointerType === 'mouse') pointer.down = false; });
    document.addEventListener('pointerlockchange', () => { if (document.pointerLockElement === canvas) { pointer.active = true; } });
    const zone = $('stick-zone'), knob = $('stick-knob');
    zone.addEventListener('pointerdown', (e) => { e.preventDefault(); if (!started || paused || ended) return; stick.id = e.pointerId; zone.setPointerCapture(e.pointerId); moveStick(e); });
    zone.addEventListener('pointermove', (e) => { if (stick.id === e.pointerId) moveStick(e); });
    const endStick = (e) => { if (stick.id === e.pointerId) { stick = { x: 0, y: 0, id: null }; knob.style.transform = 'translate(0px,0px)'; } };
    zone.addEventListener('pointerup', endStick); zone.addEventListener('pointercancel', endStick);
    function moveStick(e) {
      const r = zone.querySelector('.stick-base').getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      let dx = e.clientX - cx, dy = e.clientY - cy; const len = Math.hypot(dx, dy), radius = 37;
      if (len > radius) { dx = dx / len * radius; dy = dy / len * radius; }
      stick.x = dx / radius; stick.y = dy / radius; knob.style.transform = `translate(${dx}px,${dy}px)`;
    }
    const pad = $('aim-pad'), aimKnob = pad.querySelector('.aim-knob');
    pad.addEventListener('pointerdown', (e) => { e.preventDefault(); aimTouchAngle = aimAngle; aimTouchId = e.pointerId; aimTouchLast = { x: e.clientX, y: e.clientY }; pad.setPointerCapture(e.pointerId); });
    pad.addEventListener('pointermove', (e) => { if (aimTouchId === e.pointerId) { const dx = e.clientX - aimTouchLast.x, dy = e.clientY - aimTouchLast.y; aimAngle += (dx + dy) * .012; aimTouchLast = { x: e.clientX, y: e.clientY }; const r = pad.getBoundingClientRect(); aimKnob.style.transform = `translate(${clamp(e.clientX - (r.left + r.width / 2), -27, 27)}px,${clamp(e.clientY - (r.top + r.height / 2), -25, 25)}px)`; } });
    const endAim = (e) => { if (aimTouchId !== e.pointerId) return; aimTouchAngle = null; aimTouchId = null; aimKnob.style.transform = ''; };
    pad.addEventListener('pointerup', endAim); pad.addEventListener('pointercancel', endAim);
  }
  let aimTouchLast = { x: 0, y: 0 };

  bindInput(); updateHud();
  function frame(now) {
    const dt = Math.min(.035, last ? (now - last) / 1000 : .016); last = now;
    update(dt); render(); requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
