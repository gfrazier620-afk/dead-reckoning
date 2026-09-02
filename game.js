const TILE = 32;
const MAP_W = 20;
const MAP_H = 15;

// 0 = grass, 1 = wall/obstacle, 2 = road, 3 = shelter marker
const mapLayout = [
  "11111111111111111111",
  "10000000000000000001",
  "10022222220000220001",
  "10022222220000220001",
  "10000000000000220001",
  "10000011100000000001",
  "10000011100002222001",
  "10000011100000000001",
  "10000000000000000001",
  "10002220000011100001",
  "10002220000011100001",
  "10000000000000000001",
  "10000000330000000001",
  "10000000330000000001",
  "11111111111111111111"
];

// Hand-placed resource nodes: { type, col, row }
// type: 'tree' -> wood, 'car' -> scrap, 'bush' -> food
const resourceNodeData = [
  { type: 'tree', col: 2, row: 3 },
  { type: 'tree', col: 3, row: 3 },
  { type: 'tree', col: 2, row: 4 },
  { type: 'bush', col: 16, row: 3 },
  { type: 'bush', col: 17, row: 3 },
  { type: 'car', col: 14, row: 9 },
  { type: 'car', col: 15, row: 10 },
  { type: 'tree', col: 4, row: 11 },
  { type: 'bush', col: 5, row: 11 }
];

const RESOURCE_CONFIG = {
  tree: { key: 'wood', min: 1, max: 3, respawnMs: 12000 },
  bush: { key: 'food', min: 1, max: 2, respawnMs: 9000 },
  car: { key: 'scrap', min: 2, max: 4, respawnMs: 18000 }
};

// Buildable structures and their costs
const BUILDABLES = {
  wall: { label: 'Wall', cost: { wood: 3 }, solid: true },
  bed: { label: 'Bed', cost: { wood: 4, scrap: 1 }, solid: false }
};

const DEMOLISH_REFUND_RATE = 0.5;

// Day/night + zombie tuning
const DAY_LENGTH_MS = 45000;
const NIGHT_LENGTH_MS = 30000;
const ZOMBIE_BASE_SPEED = 55;
const ZOMBIE_SPEED_PER_DAY = 3;
const ZOMBIE_BASE_HEALTH = 2;
const PLAYER_MAX_HEALTH = 100;
const ZOMBIE_DAMAGE = 8;
const ATTACK_RANGE = TILE * 0.9;
const ATTACK_COOLDOWN_MS = 400;

// Hunger tuning
const HUNGER_MAX = 100;
const HUNGER_DECAY_INTERVAL_MS = 6000;
const HUNGER_AUTO_EAT_THRESHOLD = 50;
const HUNGER_AUTO_EAT_GAIN = 15;
const STARVE_DAMAGE = 2;
const STARVE_INTERVAL_MS = 3000;

// Survivor perks
const PERKS = {
  scavenger: { label: 'Scavenger', desc: '+1 to every resource gathered' },
  medic: { label: 'Medic', desc: 'slowly regenerates your health' },
  guard: { label: 'Guard', desc: 'reduces zombie damage to you' }
};

const survivorData = [
  { name: 'Mara', perk: 'scavenger', col: 18, row: 12 },
  { name: 'Doc Ellis', perk: 'medic', col: 1, row: 12 },
  { name: 'Reyes', perk: 'guard', col: 9, row: 1 }
];

// ---------- Save / load ----------

const SAVE_KEY = 'dead-reckoning-save-v1';

function saveGame(dayNumber, hungerValue) {
  try {
    const data = {
      inventory: { ...inventory },
      roster: roster.map(s => ({ name: s.name, perk: s.perk })),
      dayNumber,
      hunger: hungerValue
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch (e) {
    // Storage may be unavailable in a sandboxed preview - that's fine, just skip.
  }
}

function loadGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function clearSave() {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch (e) {
    // ignore
  }
}

const inventory = { wood: 0, food: 0, scrap: 0 };
const roster = [];

const savedGame = loadGame();
if (savedGame) {
  if (savedGame.inventory) Object.assign(inventory, savedGame.inventory);
  if (Array.isArray(savedGame.roster)) savedGame.roster.forEach(s => roster.push(s));
}
const startingDay = savedGame && savedGame.dayNumber ? savedGame.dayNumber : 1;
let hunger = savedGame && typeof savedGame.hunger === 'number' ? savedGame.hunger : HUNGER_MAX;

// ---------- HUD helpers ----------

function updateHud() {
  const el = document.getElementById('resource-hud');
  if (el) {
    el.textContent = `Wood: ${inventory.wood}   Food: ${inventory.food}   Scrap: ${inventory.scrap}`;
  }
}

function canAfford(cost) {
  return Object.entries(cost).every(([key, amt]) => inventory[key] >= amt);
}

function spend(cost) {
  Object.entries(cost).forEach(([key, amt]) => { inventory[key] -= amt; });
  updateHud();
}

function refund(cost, rate) {
  Object.entries(cost).forEach(([key, amt]) => {
    inventory[key] += Math.ceil(amt * rate);
  });
  updateHud();
}

function updateStatusLine(text) {
  const el = document.getElementById('status-line');
  if (el) el.textContent = text;
}

function updateHealthBar(current, max) {
  const fill = document.getElementById('health-fill');
  const label = document.getElementById('health-label');
  if (fill) fill.style.width = `${Math.max(0, (current / max) * 100)}%`;
  if (label) label.textContent = `${Math.max(0, Math.ceil(current))} / ${max}`;
}

function updateHungerBar(current, max) {
  const fill = document.getElementById('hunger-fill');
  const label = document.getElementById('hunger-label');
  if (fill) fill.style.width = `${Math.max(0, (current / max) * 100)}%`;
  if (label) label.textContent = `${Math.max(0, Math.ceil(current))} / ${max}`;
}

function hasPerk(perkKey) {
  return roster.some(s => s.perk === perkKey);
}

function updateRosterPanel() {
  const list = document.getElementById('roster-list');
  const countEl = document.getElementById('roster-count');
  if (countEl) countEl.textContent = roster.length;
  if (!list) return;

  if (roster.length === 0) {
    list.innerHTML = '<div class="roster-empty">No survivors rescued yet.</div>';
    return;
  }

  list.innerHTML = roster.map(s => {
    const perkInfo = PERKS[s.perk];
    return `<div class="roster-member">
      <span class="roster-name">${s.name}</span>
      <span class="roster-perk">${perkInfo.label} — ${perkInfo.desc}</span>
    </div>`;
  }).join('');
}

class MainScene extends Phaser.Scene {
  constructor() {
    super('MainScene');
    this.resourceNodes = [];
    this.survivorSprites = [];
    this.placedList = [];
    this.interactKey = null;
    this.demolishKey = null;
    this.promptText = null;
    this.nearbyNode = null;
    this.nearbySurvivor = null;
    this.nearbyStructure = null;

    this.buildMode = false;
    this.selectedBuild = 'wall';
    this.buildGhost = null;
    this.placedStructures = null;
    this.occupiedTiles = new Set();

    this.isNight = false;
    this.dayNumber = startingDay;
    this.phaseTimer = 0;
    this.nightOverlay = null;

    this.zombies = null;
    this.attackKey = null;
    this.lastAttackTime = 0;
    this.lastDamageTime = 0;
    this.lastRegenTime = 0;
    this.lastHungerDecay = 0;
    this.lastStarveDamage = 0;

    this.playerHealth = PLAYER_MAX_HEALTH;
    this.gameOver = false;
  }

  preload() {
    this.createGroundTexture('grass', 0x2e3a24, 'grass');
    this.createGroundTexture('wall', 0x4a4038, 'brick');
    this.createGroundTexture('road', 0x3a3a3a, 'road');
    this.createGroundTexture('shelter', 0x6a8a4a, 'grass');
    this.createPlayerTexture();
    this.createZombieTexture();
    this.createSurvivorTexture();
    this.createTreeTexture();
    this.createBushTexture();
    this.createCarTexture();
    this.createDepletedTexture('tree_depleted');
    this.createDepletedTexture('bush_depleted');
    this.createDepletedTexture('car_depleted');
    this.createBuildTexture('build_wall', 0x5a4a3a);
    this.createBuildTexture('build_bed', 0x4a5a6a, true);
  }

  createGroundTexture(key, color, pattern) {
    const g = this.make.graphics({ x: 0, y: 0, add: false });
    g.fillStyle(color, 1);
    g.fillRect(0, 0, TILE, TILE);

    if (pattern === 'grass') {
      g.fillStyle(Phaser.Display.Color.GetColor(
        Math.min(255, ((color >> 16) & 0xff) + 12),
        Math.min(255, ((color >> 8) & 0xff) + 12),
        Math.min(255, (color & 0xff) + 12)
      ), 0.5);
      for (let i = 0; i < 5; i++) {
        const x = Phaser.Math.Between(3, TILE - 3);
        const y = Phaser.Math.Between(3, TILE - 3);
        g.fillRect(x, y, 2, 2);
      }
    } else if (pattern === 'brick') {
      g.lineStyle(1, 0x2b241d, 0.6);
      g.strokeRect(0, 8, TILE, 0);
      g.strokeRect(0, 20, TILE, 0);
      g.strokeRect(8, 0, 0, 8);
      g.strokeRect(24, 8, 0, 12);
      g.strokeRect(16, 20, 0, 12);
    } else if (pattern === 'road') {
      g.fillStyle(0x2a2a2a, 0.5);
      g.fillRect(0, TILE / 2 - 1, TILE, 2);
    }

    g.lineStyle(1, 0x000000, 0.12);
    g.strokeRect(0, 0, TILE, TILE);
    g.generateTexture(key, TILE, TILE);
    g.destroy();
  }

  createPlayerTexture() {
    const g = this.make.graphics({ x: 0, y: 0, add: false });
    // body
    g.fillStyle(0xd97757, 1);
    g.fillCircle(TILE / 2, TILE / 2 + 2, TILE / 2 - 6);
    // head
    g.fillStyle(0xe8a87c, 1);
    g.fillCircle(TILE / 2, TILE / 2 - 6, 6);
    // outline
    g.lineStyle(2, 0x2b1a12, 0.8);
    g.strokeCircle(TILE / 2, TILE / 2 + 2, TILE / 2 - 6);
    g.generateTexture('player', TILE, TILE);
    g.destroy();
  }

  createZombieTexture() {
    const g = this.make.graphics({ x: 0, y: 0, add: false });
    g.fillStyle(0x5a7a4a, 1);
    g.fillCircle(TILE / 2, TILE / 2 + 2, TILE / 2 - 6);
    g.fillStyle(0x4a6a3e, 1);
    g.fillCircle(TILE / 2, TILE / 2 - 6, 6);
    g.lineStyle(2, 0x2a3a20, 0.8);
    g.strokeCircle(TILE / 2, TILE / 2 + 2, TILE / 2 - 6);
    g.fillStyle(0xc94a3a, 1);
    g.fillCircle(TILE / 2 - 4, TILE / 2 - 7, 1.6);
    g.fillCircle(TILE / 2 + 4, TILE / 2 - 7, 1.6);
    // torn edge detail
    g.fillStyle(0x3a4a30, 1);
    g.fillTriangle(TILE / 2 - 8, TILE / 2 + 8, TILE / 2 - 4, TILE / 2 + 14, TILE / 2, TILE / 2 + 8);
    g.generateTexture('zombie', TILE, TILE);
    g.destroy();
  }

  createSurvivorTexture() {
    const g = this.make.graphics({ x: 0, y: 0, add: false });
    g.fillStyle(0x5a86a8, 1);
    g.fillCircle(TILE / 2, TILE / 2 + 2, TILE / 2 - 6);
    g.fillStyle(0xe8b88c, 1);
    g.fillCircle(TILE / 2, TILE / 2 - 6, 6);
    g.lineStyle(2, 0x1e3a4a, 0.8);
    g.strokeCircle(TILE / 2, TILE / 2 + 2, TILE / 2 - 6);
    g.lineStyle(2, 0xe8e8d0, 1);
    g.beginPath();
    g.moveTo(TILE / 2 - 5, TILE / 2 + 10);
    g.lineTo(TILE / 2 + 5, TILE / 2 + 10);
    g.moveTo(TILE / 2, TILE / 2 + 5);
    g.lineTo(TILE / 2, TILE / 2 + 15);
    g.strokePath();
    g.generateTexture('survivor', TILE, TILE);
    g.destroy();
  }

  createTreeTexture() {
    const g = this.make.graphics({ x: 0, y: 0, add: false });
    // trunk
    g.fillStyle(0x4a3826, 1);
    g.fillRect(TILE / 2 - 3, TILE / 2 + 4, 6, 12);
    // foliage - layered circles
    g.fillStyle(0x2f4a24, 1);
    g.fillCircle(TILE / 2, TILE / 2, 12);
    g.fillStyle(0x3d5a2c, 1);
    g.fillCircle(TILE / 2 - 5, TILE / 2 - 2, 8);
    g.fillCircle(TILE / 2 + 5, TILE / 2 - 2, 8);
    g.fillCircle(TILE / 2, TILE / 2 - 8, 8);
    g.generateTexture('tree', TILE, TILE);
    g.destroy();
  }

  createBushTexture() {
    const g = this.make.graphics({ x: 0, y: 0, add: false });
    g.fillStyle(0x5a3a42, 1);
    g.fillCircle(TILE / 2, TILE / 2 + 4, 10);
    g.fillStyle(0x8a4a5a, 1);
    g.fillCircle(TILE / 2 - 5, TILE / 2, 6);
    g.fillCircle(TILE / 2 + 5, TILE / 2, 6);
    g.fillCircle(TILE / 2, TILE / 2 - 4, 6);
    // berries
    g.fillStyle(0xc96a7a, 1);
    g.fillCircle(TILE / 2 - 3, TILE / 2, 1.6);
    g.fillCircle(TILE / 2 + 4, TILE / 2 + 2, 1.6);
    g.fillCircle(TILE / 2, TILE / 2 - 3, 1.6);
    g.generateTexture('bush', TILE, TILE);
    g.destroy();
  }

  createCarTexture() {
    const g = this.make.graphics({ x: 0, y: 0, add: false });
    g.fillStyle(0x54545c, 1);
    g.fillRoundedRect(3, 10, TILE - 6, 14, 4);
    g.fillStyle(0x3a3a40, 1);
    g.fillRoundedRect(7, 6, TILE - 14, 10, 3);
    g.fillStyle(0x7a8a94, 0.7);
    g.fillRoundedRect(9, 7, TILE - 18, 5, 2);
    g.fillStyle(0x1a1a1a, 1);
    g.fillCircle(9, 25, 3);
    g.fillCircle(TILE - 9, 25, 3);
    g.generateTexture('car', TILE, TILE);
    g.destroy();
  }

  createDepletedTexture(key) {
    const g = this.make.graphics({ x: 0, y: 0, add: false });
    g.fillStyle(0x1e241a, 1);
    g.fillCircle(TILE / 2, TILE / 2, 8);
    g.lineStyle(1, 0x0d0f0c, 0.6);
    g.strokeCircle(TILE / 2, TILE / 2, 8);
    g.generateTexture(key, TILE, TILE);
    g.destroy();
  }

  createBuildTexture(key, color, isBed) {
    const g = this.make.graphics({ x: 0, y: 0, add: false });
    g.fillStyle(color, 1);
    if (isBed) {
      g.fillRoundedRect(4, 8, TILE - 8, TILE - 14, 4);
      g.fillStyle(0xdedecb, 1);
      g.fillRoundedRect(6, 10, 8, 8, 2);
    } else {
      g.fillRoundedRect(2, 2, TILE - 4, TILE - 4, 3);
      g.lineStyle(1, 0x2b2318, 0.5);
      g.strokeRect(2, 2, TILE - 4, (TILE - 4) / 2);
    }
    g.lineStyle(2, 0x000000, 0.3);
    g.strokeRoundedRect(2, 2, TILE - 4, TILE - 4, 3);
    g.generateTexture(key, TILE, TILE);
    g.destroy();
  }

  create() {
    this.walls = this.physics.add.staticGroup();
    this.placedStructures = this.physics.add.staticGroup();
    this.zombies = this.physics.add.group();

    for (let row = 0; row < MAP_H; row++) {
      for (let col = 0; col < MAP_W; col++) {
        const code = mapLayout[row][col];
        const x = col * TILE + TILE / 2;
        const y = row * TILE + TILE / 2;
        let key = 'grass';
        if (code === '1') key = 'wall';
        else if (code === '2') key = 'road';
        else if (code === '3') key = 'shelter';

        this.add.image(x, y, key);

        if (code === '1') {
          this.walls.create(x, y, key).setVisible(false).refreshBody();
          this.occupiedTiles.add(`${col},${row}`);
        }
      }
    }

    resourceNodeData.forEach(data => {
      const x = data.col * TILE + TILE / 2;
      const y = data.row * TILE + TILE / 2;
      const sprite = this.add.image(x, y, data.type);
      this.resourceNodes.push({
        type: data.type,
        sprite,
        x,
        y,
        depleted: false,
        respawnTimer: null
      });
      this.occupiedTiles.add(`${data.col},${data.row}`);
    });

    // Skip survivors already rescued in a previous saved session
    survivorData.forEach(data => {
      if (roster.some(r => r.name === data.name)) return;

      const x = data.col * TILE + TILE / 2;
      const y = data.row * TILE + TILE / 2;
      const sprite = this.add.image(x, y, 'survivor');
      this.tweens.add({
        targets: sprite,
        y: y - 4,
        duration: 700,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut'
      });
      this.survivorSprites.push({ name: data.name, perk: data.perk, sprite, x, y, rescued: false });
      this.occupiedTiles.add(`${data.col},${data.row}`);
    });

    this.player = this.physics.add.sprite(3 * TILE, 3 * TILE, 'player');
    this.player.setCollideWorldBounds(true);
    this.player.body.setSize(TILE - 8, TILE - 8);

    this.physics.add.collider(this.player, this.walls);
    this.physics.add.collider(this.player, this.placedStructures);
    this.physics.add.collider(this.zombies, this.walls);
    this.physics.add.collider(this.zombies, this.placedStructures);
    this.physics.add.collider(this.zombies, this.zombies);

    this.physics.add.overlap(this.player, this.zombies, (player, zombie) => {
      this.handlePlayerZombieContact(zombie);
    });

    this.cursors = this.input.keyboard.createCursorKeys();
    this.wasd = this.input.keyboard.addKeys('W,A,S,D');
    this.interactKey = this.input.keyboard.addKey('E');
    this.demolishKey = this.input.keyboard.addKey('R');
    this.buildKey = this.input.keyboard.addKey('B');
    this.attackKey = this.input.keyboard.addKey('SPACE');
    this.key1 = this.input.keyboard.addKey('ONE');
    this.key2 = this.input.keyboard.addKey('TWO');

    this.cameras.main.setBounds(0, 0, MAP_W * TILE, MAP_H * TILE);
    this.cameras.main.startFollow(this.player, true, 0.1, 0.1);
    this.physics.world.setBounds(0, 0, MAP_W * TILE, MAP_H * TILE);

    this.promptText = this.add.text(0, 0, '', {
      fontFamily: 'Courier New',
      fontSize: '12px',
      color: '#e8e8d0',
      backgroundColor: '#000000aa',
      padding: { x: 4, y: 2 }
    });
    this.promptText.setVisible(false);
    this.promptText.setDepth(10);

    this.buildGhost = this.add.image(0, 0, 'build_wall');
    this.buildGhost.setAlpha(0.5);
    this.buildGhost.setVisible(false);
    this.buildGhost.setDepth(9);

    this.nightOverlay = this.add.rectangle(0, 0, MAP_W * TILE * 2, MAP_H * TILE * 2, 0x0a0e14, 0);
    this.nightOverlay.setOrigin(0.5, 0.5);
    this.nightOverlay.setDepth(20);
    this.nightOverlay.setScrollFactor(0);
    this.nightOverlay.setPosition((MAP_W * TILE) / 2, (MAP_H * TILE) / 2);

    this.input.on('pointerdown', (pointer) => this.handlePointerDown(pointer));

    updateHud();
    updateHealthBar(this.playerHealth, PLAYER_MAX_HEALTH);
    updateHungerBar(hunger, HUNGER_MAX);
    updateRosterPanel();
    this.syncBuildMenu();
    this.startDay();

    // Hold gameplay at the title screen until the player presses Start
    this.scene.pause();

    // Wire the title screen's start button once (guard against duplicate scene creation)
    if (!window.__deadReckoningStartWired) {
      window.__deadReckoningStartWired = true;
      const startBtn = document.getElementById('start-button');
      const startScreen = document.getElementById('start-screen');
      if (startBtn && startScreen) {
        startBtn.addEventListener('click', () => {
          startScreen.style.display = 'none';
          const scene = game.scene.getScene('MainScene');
          if (scene) scene.scene.resume();
        });
      }

      const restartBtn = document.getElementById('restart-button');
      if (restartBtn) {
        restartBtn.addEventListener('click', () => {
          window.location.reload();
        });
      }
    }

    if (savedGame) {
      updateStatusLine(`continuing from day ${this.dayNumber} — press Start`);
      const p = document.getElementById('start-detail');
      if (p) p.textContent = `Welcome back — resuming on day ${this.dayNumber} with your saved supplies and survivors.`;
    }
  }

  saveProgress() {
    saveGame(this.dayNumber, hunger);
  }

  syncBuildMenu() {
    const menu = document.getElementById('build-menu');
    if (menu) menu.style.display = this.buildMode ? 'flex' : 'none';
    document.querySelectorAll('.build-option').forEach(el => {
      el.classList.toggle('selected', el.dataset.build === this.selectedBuild);
    });
  }

  setSelectedBuild(key) {
    this.selectedBuild = key;
    this.buildGhost.setTexture('build_' + key);
    this.syncBuildMenu();
  }

  toggleBuildMode(force) {
    this.buildMode = (force !== undefined) ? force : !this.buildMode;
    this.buildGhost.setVisible(this.buildMode);
    this.syncBuildMenu();
  }

  // ---------- Day / Night ----------

  startDay() {
    this.isNight = false;
    this.phaseTimer = DAY_LENGTH_MS;
    updateStatusLine(`day ${this.dayNumber} — gather and build before nightfall`);
    this.tweens.add({ targets: this.nightOverlay, alpha: 0, duration: 2000 });
    this.zombies.getChildren().slice().forEach(z => z.destroy());
    this.saveProgress();
  }

  startNight() {
    this.isNight = true;
    this.phaseTimer = NIGHT_LENGTH_MS;
    updateStatusLine(`night ${this.dayNumber} — zombies are coming, defend yourself`);
    this.tweens.add({ targets: this.nightOverlay, alpha: 0.55, duration: 3000 });
    this.spawnZombieWave();
  }

  spawnZombieWave() {
    const count = 3 + this.dayNumber;
    for (let i = 0; i < count; i++) {
      this.time.delayedCall(i * 900, () => this.spawnZombie());
    }
  }

  spawnZombie() {
    if (this.gameOver) return;
    const edge = Phaser.Math.Between(0, 3);
    let x, y;
    if (edge === 0) { x = 0; y = Phaser.Math.Between(0, MAP_H * TILE); }
    else if (edge === 1) { x = MAP_W * TILE; y = Phaser.Math.Between(0, MAP_H * TILE); }
    else if (edge === 2) { x = Phaser.Math.Between(0, MAP_W * TILE); y = 0; }
    else { x = Phaser.Math.Between(0, MAP_W * TILE); y = MAP_H * TILE; }

    const zombie = this.zombies.create(x, y, 'zombie');
    zombie.setCollideWorldBounds(true);
    zombie.body.setSize(TILE - 10, TILE - 10);
    zombie.health = ZOMBIE_BASE_HEALTH + Math.floor((this.dayNumber - 1) / 3);
    zombie.speed = ZOMBIE_BASE_SPEED + (this.dayNumber - 1) * ZOMBIE_SPEED_PER_DAY;
  }

  // ---------- Combat ----------

  handlePlayerZombieContact(zombie) {
    if (this.gameOver) return;
    const now = this.time.now;
    if (now - this.lastDamageTime > 500) {
      this.lastDamageTime = now;
      const damage = hasPerk('guard') ? ZOMBIE_DAMAGE * 0.5 : ZOMBIE_DAMAGE;
      this.playerHealth -= damage;
      updateHealthBar(this.playerHealth, PLAYER_MAX_HEALTH);
      this.cameras.main.shake(120, 0.004);
      if (this.playerHealth <= 0) this.handleGameOver();
    }
  }

  attackNearestZombie() {
    let closest = null;
    let closestDist = Infinity;
    this.zombies.getChildren().forEach(z => {
      const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, z.x, z.y);
      if (dist < ATTACK_RANGE && dist < closestDist) {
        closest = z;
        closestDist = dist;
      }
    });

    if (closest) {
      closest.health -= 1;
      this.showFloatText(closest.x, closest.y, 'hit!', '#e8c05a');
      if (closest.health <= 0) {
        this.showFloatText(closest.x, closest.y, 'zombie down', '#c96a5a');
        closest.destroy();
      } else {
        closest.setTint(0xff8888);
        this.time.delayedCall(150, () => { if (closest.active) closest.clearTint(); });
      }
    }
  }

  handleGameOver() {
    this.gameOver = true;
    this.zombies.getChildren().forEach(z => z.setVelocity(0));
    this.player.setVelocity(0);
    updateStatusLine(`you died on night ${this.dayNumber}`);
    clearSave();

    const overlay = document.getElementById('gameover-screen');
    const detail = document.getElementById('gameover-detail');
    if (detail) detail.textContent = `You survived to day ${this.dayNumber} with ${roster.length} survivor(s) at your side.`;
    if (overlay) overlay.style.display = 'flex';
  }

  // ---------- Resources ----------

  getNearbyNode() {
    const GATHER_RANGE = TILE * 1.1;
    let closest = null;
    let closestDist = Infinity;

    this.resourceNodes.forEach(node => {
      if (node.depleted) return;
      const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, node.x, node.y);
      if (dist < GATHER_RANGE && dist < closestDist) {
        closest = node;
        closestDist = dist;
      }
    });

    return closest;
  }

  gatherNode(node) {
    const cfg = RESOURCE_CONFIG[node.type];
    const bonus = hasPerk('scavenger') ? 1 : 0;
    const amount = Phaser.Math.Between(cfg.min, cfg.max) + bonus;
    inventory[cfg.key] += amount;
    updateHud();
    this.saveProgress();

    node.depleted = true;
    node.sprite.setTexture(node.type + '_depleted');
    node.sprite.setAlpha(0.6);

    node.respawnTimer = this.time.delayedCall(cfg.respawnMs, () => {
      node.depleted = false;
      node.sprite.setTexture(node.type);
      node.sprite.setAlpha(1);
    });

    this.showFloatText(node.x, node.y, `+${amount} ${cfg.key}`);
  }

  // ---------- Survivors ----------

  getNearbySurvivor() {
    const RESCUE_RANGE = TILE * 1.1;
    let closest = null;
    let closestDist = Infinity;

    this.survivorSprites.forEach(s => {
      if (s.rescued) return;
      const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, s.x, s.y);
      if (dist < RESCUE_RANGE && dist < closestDist) {
        closest = s;
        closestDist = dist;
      }
    });

    return closest;
  }

  rescueSurvivor(survivor) {
    survivor.rescued = true;
    survivor.sprite.destroy();
    roster.push({ name: survivor.name, perk: survivor.perk });
    updateRosterPanel();
    this.saveProgress();

    const perkInfo = PERKS[survivor.perk];
    this.showFloatText(survivor.x, survivor.y, `${survivor.name} rescued!`, '#7ab5d9');
    updateStatusLine(`${survivor.name} joined you — ${perkInfo.label}: ${perkInfo.desc}`);
  }

  // ---------- Building & Demolishing ----------

  getNearbyStructure() {
    const RANGE = TILE * 1.1;
    let closest = null;
    let closestDist = Infinity;

    this.placedList.forEach(s => {
      const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, s.sprite.x, s.sprite.y);
      if (dist < RANGE && dist < closestDist) {
        closest = s;
        closestDist = dist;
      }
    });

    return closest;
  }

  demolishStructure(structure) {
    const cfg = BUILDABLES[structure.key];
    refund(cfg.cost, DEMOLISH_REFUND_RATE);

    if (structure.body) structure.body.destroy();
    structure.sprite.destroy();

    this.occupiedTiles.delete(`${structure.col},${structure.row}`);
    this.placedList = this.placedList.filter(s => s !== structure);
    this.saveProgress();

    this.showFloatText(
      structure.col * TILE + TILE / 2,
      structure.row * TILE + TILE / 2,
      `${cfg.label} demolished (refunded)`,
      '#c9a25a'
    );
  }

  handlePointerDown(pointer) {
    if (!this.buildMode) return;

    const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const col = Math.floor(worldPoint.x / TILE);
    const row = Math.floor(worldPoint.y / TILE);

    if (col < 0 || col >= MAP_W || row < 0 || row >= MAP_H) return;

    const tileKey = `${col},${row}`;
    if (this.occupiedTiles.has(tileKey)) {
      this.showFloatText(col * TILE + TILE / 2, row * TILE + TILE / 2, 'tile occupied', '#c96a5a');
      return;
    }

    const px = col * TILE + TILE / 2;
    const py = row * TILE + TILE / 2;
    const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, px, py);
    if (dist > TILE * 5) {
      this.showFloatText(px, py, 'too far', '#c96a5a');
      return;
    }

    const cfg = BUILDABLES[this.selectedBuild];
    if (!canAfford(cfg.cost)) {
      this.showFloatText(px, py, 'not enough resources', '#c96a5a');
      return;
    }

    spend(cfg.cost);
    this.placeStructure(this.selectedBuild, col, row);
  }

  placeStructure(key, col, row) {
    const cfg = BUILDABLES[key];
    const x = col * TILE + TILE / 2;
    const y = row * TILE + TILE / 2;

    const sprite = this.add.image(x, y, 'build_' + key);
    let body = null;

    if (cfg.solid) {
      body = this.placedStructures.create(x, y, 'build_' + key);
      body.setVisible(false);
      body.refreshBody();
    }

    this.occupiedTiles.add(`${col},${row}`);
    this.placedList.push({ key, sprite, body, col, row });
    this.saveProgress();
    this.showFloatText(x, y, `${cfg.label} built`, '#b5c99a');
  }

  showFloatText(x, y, message, color) {
    const txt = this.add.text(x, y - TILE / 2, message, {
      fontFamily: 'Courier New',
      fontSize: '13px',
      color: color || '#b5c99a'
    });
    txt.setDepth(21);
    this.tweens.add({
      targets: txt,
      y: y - TILE * 1.6,
      alpha: 0,
      duration: 900,
      onComplete: () => txt.destroy()
    });
  }

  // ---------- Main loop ----------

  update(time, delta) {
    if (this.gameOver) return;

    const speed = 140;
    this.player.setVelocity(0);

    if (Phaser.Input.Keyboard.JustDown(this.buildKey)) {
      this.toggleBuildMode();
    }

    if (this.buildMode) {
      if (Phaser.Input.Keyboard.JustDown(this.key1)) this.setSelectedBuild('wall');
      if (Phaser.Input.Keyboard.JustDown(this.key2)) this.setSelectedBuild('bed');

      const pointer = this.input.activePointer;
      const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      const col = Math.floor(worldPoint.x / TILE);
      const row = Math.floor(worldPoint.y / TILE);
      this.buildGhost.setPosition(col * TILE + TILE / 2, row * TILE + TILE / 2);
      this.buildGhost.setVisible(true);
    } else {
      this.buildGhost.setVisible(false);
    }

    if (!this.buildMode) {
      const left = this.cursors.left.isDown || this.wasd.A.isDown;
      const right = this.cursors.right.isDown || this.wasd.D.isDown;
      const up = this.cursors.up.isDown || this.wasd.W.isDown;
      const down = this.cursors.down.isDown || this.wasd.S.isDown;

      let vx = 0, vy = 0;
      if (left) vx -= 1;
      if (right) vx += 1;
      if (up) vy -= 1;
      if (down) vy += 1;

      if (vx !== 0 || vy !== 0) {
        const len = Math.sqrt(vx * vx + vy * vy);
        this.player.setVelocity((vx / len) * speed, (vy / len) * speed);
      }

      this.nearbySurvivor = this.getNearbySurvivor();
      this.nearbyStructure = this.nearbySurvivor ? null : this.getNearbyStructure();
      this.nearbyNode = (this.nearbySurvivor || this.nearbyStructure) ? null : this.getNearbyNode();

      if (this.nearbySurvivor) {
        this.promptText.setText(`Press E to rescue ${this.nearbySurvivor.name}`);
        this.promptText.setVisible(true);
        this.promptText.setPosition(this.nearbySurvivor.x - 55, this.nearbySurvivor.y - TILE - 6);
        if (Phaser.Input.Keyboard.JustDown(this.interactKey)) this.rescueSurvivor(this.nearbySurvivor);
      } else if (this.nearbyStructure) {
        const cfg = BUILDABLES[this.nearbyStructure.key];
        const refundAmt = Object.entries(cfg.cost).map(([k, v]) => `${Math.ceil(v * DEMOLISH_REFUND_RATE)} ${k}`).join(', ');
        this.promptText.setText(`Press R to demolish ${cfg.label} (+${refundAmt})`);
        this.promptText.setVisible(true);
        this.promptText.setPosition(this.nearbyStructure.sprite.x - 70, this.nearbyStructure.sprite.y - TILE - 6);
        if (Phaser.Input.Keyboard.JustDown(this.demolishKey)) this.demolishStructure(this.nearbyStructure);
      } else if (this.nearbyNode) {
        this.promptText.setText('Press E to gather');
        this.promptText.setVisible(true);
        this.promptText.setPosition(this.nearbyNode.x - 40, this.nearbyNode.y - TILE - 6);
        if (Phaser.Input.Keyboard.JustDown(this.interactKey)) this.gatherNode(this.nearbyNode);
      } else {
        this.promptText.setVisible(false);
      }

      if (Phaser.Input.Keyboard.JustDown(this.attackKey) && time - this.lastAttackTime > ATTACK_COOLDOWN_MS) {
        this.lastAttackTime = time;
        this.attackNearestZombie();
      }
    } else {
      this.promptText.setVisible(false);
    }

    // Zombie AI: move toward player at their own (difficulty-scaled) speed
    this.zombies.getChildren().forEach(zombie => {
      const dx = this.player.x - zombie.x;
      const dy = this.player.y - zombie.y;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const spd = zombie.speed || ZOMBIE_BASE_SPEED;
      zombie.setVelocity((dx / len) * spd, (dy / len) * spd);
    });

    // Medic perk: slow passive regen
    if (hasPerk('medic') && this.playerHealth < PLAYER_MAX_HEALTH) {
      if (time - this.lastRegenTime > 2000) {
        this.lastRegenTime = time;
        this.playerHealth = Math.min(PLAYER_MAX_HEALTH, this.playerHealth + 2);
        updateHealthBar(this.playerHealth, PLAYER_MAX_HEALTH);
      }
    }

    // Hunger decay + auto-eat
    if (time - this.lastHungerDecay > HUNGER_DECAY_INTERVAL_MS) {
      this.lastHungerDecay = time;
      hunger = Math.max(0, hunger - 1);

      if (hunger <= HUNGER_AUTO_EAT_THRESHOLD && inventory.food > 0) {
        inventory.food -= 1;
        hunger = Math.min(HUNGER_MAX, hunger + HUNGER_AUTO_EAT_GAIN);
        updateHud();
        this.showFloatText(this.player.x, this.player.y, 'ate food', '#c9a25a');
      }

      updateHungerBar(hunger, HUNGER_MAX);
      this.saveProgress();
    }

    // Starvation damage when hunger is empty and there's no food to eat
    if (hunger <= 0) {
      if (time - this.lastStarveDamage > STARVE_INTERVAL_MS) {
        this.lastStarveDamage = time;
        this.playerHealth -= STARVE_DAMAGE;
        updateHealthBar(this.playerHealth, PLAYER_MAX_HEALTH);
        this.showFloatText(this.player.x, this.player.y, 'starving!', '#c96a5a');
        if (this.playerHealth <= 0) this.handleGameOver();
      }
    }

    // Day/night timer
    this.phaseTimer -= delta;
    if (this.phaseTimer <= 0) {
      if (this.isNight) {
        this.dayNumber += 1;
        this.startDay();
      } else {
        this.startNight();
      }
    }
  }
}

const config = {
  type: Phaser.AUTO,
  width: MAP_W * TILE,
  height: MAP_H * TILE,
  parent: 'game-container',
  backgroundColor: '#0d0f0c',
  physics: {
    default: 'arcade',
    arcade: { gravity: { y: 0 }, debug: false }
  },
  scene: MainScene
};

const game = new Phaser.Game(config);

window.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.build-option').forEach(el => {
    el.addEventListener('click', () => {
      const scene = game.scene.getScene('MainScene');
      if (scene) scene.setSelectedBuild(el.dataset.build);
    });
  });
});