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

class MainScene extends Phaser.Scene {
  constructor() {
    super('MainScene');
  }

  preload() {
    // Simple colored-square "sprites" as placeholders until real art is swapped in.
    this.createTileTexture('grass', 0x2e3a24);
    this.createTileTexture('wall', 0x4a4038);
    this.createTileTexture('road', 0x3a3a3a);
    this.createTileTexture('shelter', 0x6a8a4a);
    this.createPlayerTexture();
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

  create() {
    this.walls = this.physics.add.staticGroup();

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
        }
      }
    }

    this.player = this.physics.add.sprite(3 * TILE, 3 * TILE, 'player');
    this.player.setCollideWorldBounds(true);
    this.player.body.setSize(TILE - 8, TILE - 8);

    this.physics.add.collider(this.player, this.walls);

    this.cursors = this.input.keyboard.createCursorKeys();
    this.wasd = this.input.keyboard.addKeys('W,A,S,D');

    this.cameras.main.setBounds(0, 0, MAP_W * TILE, MAP_H * TILE);
    this.cameras.main.startFollow(this.player, true, 0.1, 0.1);
    this.physics.world.setBounds(0, 0, MAP_W * TILE, MAP_H * TILE);
  }

  update() {
    const speed = 140;
    this.player.setVelocity(0);

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

new Phaser.Game(config);
