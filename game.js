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
  tree: { key: 'wood', color: 0x3d5a2c, min: 1, max: 3, respawnMs: 12000 },
  bush: { key: 'food', color: 0x8a4a5a, min: 1, max: 2, respawnMs: 9000 },
  car: { key: 'scrap', color: 0x6a6a72, min: 2, max: 4, respawnMs: 18000 }
};

// Buildable structures and their costs
const BUILDABLES = {
  wall: { label: 'Wall', cost: { wood: 3 }, color: 0x5a4a3a, solid: true },
  bed: { label: 'Bed', cost: { wood: 4, scrap: 1 }, color: 0x4a5a6a, solid: false }
};

const inventory = { wood: 0, food: 0, scrap: 0 };

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

class MainScene extends Phaser.Scene {
  constructor() {
    super('MainScene');
    this.resourceNodes = [];
    this.interactKey = null;
    this.promptText = null;
    this.nearbyNode = null;

    this.buildMode = false;
    this.selectedBuild = 'wall';
    this.buildGhost = null;
    this.placedStructures = null;
    this.occupiedTiles = new Set();
  }

  preload() {
    this.createTileTexture('grass', 0x2e3a24);
    this.createTileTexture('wall', 0x4a4038);
    this.createTileTexture('road', 0x3a3a3a);
    this.createTileTexture('shelter', 0x6a8a4a);
    this.createPlayerTexture();

    Object.entries(RESOURCE_CONFIG).forEach(([type, cfg]) => {
      this.createNodeTexture(type, cfg.color);
      this.createNodeTexture(type + '_depleted', 0x1e241a);
    });

    Object.entries(BUILDABLES).forEach(([key, cfg]) => {
      this.createNodeTexture('build_' + key, cfg.color);
    });
  }

  createTileTexture(key, color) {
    const g = this.make.graphics({ x: 0, y: 0, add: false });
    g.fillStyle(color, 1);
    g.fillRect(0, 0, TILE, TILE);
    g.lineStyle(1, 0x000000, 0.15);
    g.strokeRect(0, 0, TILE, TILE);
    g.generateTexture(key, TILE, TILE);
    g.destroy();
  }

  createPlayerTexture() {
    const g = this.make.graphics({ x: 0, y: 0, add: false });
    g.fillStyle(0xd97757, 1);
    g.fillCircle(TILE / 2, TILE / 2, TILE / 2 - 4);
    g.lineStyle(2, 0x2b1a12, 1);
    g.strokeCircle(TILE / 2, TILE / 2, TILE / 2 - 4);
    g.generateTexture('player', TILE, TILE);
    g.destroy();
  }

  createNodeTexture(key, color) {
    const g = this.make.graphics({ x: 0, y: 0, add: false });
    g.fillStyle(color, 1);
    g.fillRoundedRect(4, 4, TILE - 8, TILE - 8, 6);
    g.lineStyle(2, 0x000000, 0.3);
    g.strokeRoundedRect(4, 4, TILE - 8, TILE - 8, 6);
    g.generateTexture(key, TILE, TILE);
    g.destroy();
  }

  create() {
    this.walls = this.physics.add.staticGroup();
    this.placedStructures = this.physics.add.staticGroup();

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

    this.player = this.physics.add.sprite(3 * TILE, 3 * TILE, 'player');
    this.player.setCollideWorldBounds(true);
    this.player.body.setSize(TILE - 8, TILE - 8);

    this.physics.add.collider(this.player, this.walls);
    this.physics.add.collider(this.player, this.placedStructures);

    this.cursors = this.input.keyboard.createCursorKeys();
    this.wasd = this.input.keyboard.addKeys('W,A,S,D');
    this.interactKey = this.input.keyboard.addKey('E');
    this.buildKey = this.input.keyboard.addKey('B');
    this.key1 = this.input.keyboard.addKey('ONE');
    this.key2 = this.input.keyboard.addKey('TWO');

    this.cameras.main.setBounds(0, 0, MAP_W * TILE, MAP_H * TILE);
    this.cameras.main.startFollow(this.player, true, 0.1, 0.1);
    this.physics.world.setBounds(0, 0, MAP_W * TILE, MAP_H * TILE);

    this.promptText = this.add.text(0, 0, 'Press E to gather', {
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

    this.input.on('pointerdown', (pointer) => this.handlePointerDown(pointer));

    updateHud();
    this.syncBuildMenu();
  }

  syncBuildMenu() {
    const menu = document.getElementById('build-menu');
    if (menu) {
      menu.style.display = this.buildMode ? 'flex' : 'none';
    }
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
    const amount = Phaser.Math.Between(cfg.min, cfg.max);
    inventory[cfg.key] += amount;
    updateHud();

    node.depleted = true;
    node.sprite.setTexture(node.type + '_depleted');
    node.sprite.setAlpha(0.5);

    node.respawnTimer = this.time.delayedCall(cfg.respawnMs, () => {
      node.depleted = false;
      node.sprite.setTexture(node.type);
      node.sprite.setAlpha(1);
    });

    this.showFloatText(node.x, node.y, `+${amount} ${cfg.key}`);
  }

  showFloatText(x, y, message, color) {
    const txt = this.add.text(x, y - TILE / 2, message, {
      fontFamily: 'Courier New',
      fontSize: '13px',
      color: color || '#b5c99a'
    });
    txt.setDepth(11);
    this.tweens.add({
      targets: txt,
      y: y - TILE * 1.6,
      alpha: 0,
      duration: 900,
      onComplete: () => txt.destroy()
    });
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

    if (cfg.solid) {
      const body = this.placedStructures.create(x, y, 'build_' + key);
      body.setVisible(false);
      body.refreshBody();
    }

    this.occupiedTiles.add(`${col},${row}`);
    this.showFloatText(x, y, `${cfg.label} built`, '#b5c99a');
  }

  update() {
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

      this.nearbyNode = this.getNearbyNode();

      if (this.nearbyNode) {
        this.promptText.setVisible(true);
        this.promptText.setPosition(this.nearbyNode.x - 40, this.nearbyNode.y - TILE - 6);

        if (Phaser.Input.Keyboard.JustDown(this.interactKey)) {
          this.gatherNode(this.nearbyNode);
        }
      } else {
        this.promptText.setVisible(false);
      }
    } else {
      this.promptText.setVisible(false);
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
    arcade: {
      gravity: { y: 0 },
      debug: false
    }
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