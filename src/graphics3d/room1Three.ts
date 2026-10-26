import * as THREE from 'three';
import { ClientCampaignSync } from '../../server/campaign/campaignSession.js';

export class Room1ThreeEnvironment {
  public group: THREE.Group;
  private ropeMesh: THREE.Mesh | null = null;
  private exitDoorGlow: THREE.PointLight | null = null;

  constructor() {
    this.group = new THREE.Group();
    this.buildArchitecture();
    this.buildLighting();
  }

  private buildArchitecture(): void {
    // 1. Concrete Back Wall (1600 x 640)
    // Three.js coordinates: X: 0..1600 (center 800), Y: 0..-640 (center -320), Z = -35
    const wallGeo = new THREE.PlaneGeometry(1600, 640, 16, 8);
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x3b4452,
      roughness: 0.85,
      metalness: 0.1
    });
    const backWall = new THREE.Mesh(wallGeo, wallMat);
    backWall.position.set(800, -320, -35);
    backWall.receiveShadow = true;
    this.group.add(backWall);

    // Formwork horizontal seam lines every 64px
    for (let y = -64; y > -640; y -= 64) {
      const seamGeo = new THREE.BoxGeometry(1600, 2, 2);
      const seamMat = new THREE.MeshStandardMaterial({ color: 0x242a34, roughness: 1 });
      const seam = new THREE.Mesh(seamGeo, seamMat);
      seam.position.set(800, y, -34);
      this.group.add(seam);
    }

    // Tie-rod holes along wall
    const tieMat = new THREE.MeshStandardMaterial({ color: 0x1e242d, roughness: 0.9 });
    for (let x = 64; x < 1600; x += 128) {
      for (let y = -48; y > -600; y -= 128) {
        const tieGeo = new THREE.CylinderGeometry(4, 4, 2, 10);
        tieGeo.rotateX(Math.PI / 2);
        const tie = new THREE.Mesh(tieGeo, tieMat);
        tie.position.set(x, y, -34.5);
        this.group.add(tie);
      }
    }

    // 2. Main Floor Foundation Slab (y: 544..640)
    // Top surface sits precisely at Three.js Y = -544!
    const floorH = 96;
    const floorGeo = new THREE.BoxGeometry(1600, floorH, 120);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x475161,
      roughness: 0.8,
      metalness: 0.2
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.position.set(800, -(544 + floorH / 2), 0);
    floor.receiveShadow = true;
    this.group.add(floor);

    // 3. Upper Catwalk / Ledge (x: 576..1600, top surface Y = -384)
    const catwalkW = 1600 - 576; // 1024 px
    const catwalkH = 20;
    const catwalkGeo = new THREE.BoxGeometry(catwalkW, catwalkH, 90);
    const catwalkMat = new THREE.MeshStandardMaterial({
      color: 0x526075,
      roughness: 0.65,
      metalness: 0.4
    });
    const catwalk = new THREE.Mesh(catwalkGeo, catwalkMat);
    catwalk.position.set(576 + catwalkW / 2, -(384 + catwalkH / 2), 0);
    catwalk.castShadow = true;
    catwalk.receiveShadow = true;
    this.group.add(catwalk);

    // Structural Steel I-Beam flange under catwalk
    const beamGeo = new THREE.BoxGeometry(catwalkW, 16, 40);
    const beamMat = new THREE.MeshStandardMaterial({ color: 0x2a3341, roughness: 0.7, metalness: 0.6 });
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.position.set(576 + catwalkW / 2, -(384 + catwalkH + 8), 0);
    this.group.add(beam);

    // Yellow/Black Hazard Chevron border stripe on drop edge (x = 576)
    const hazGeo = new THREE.BoxGeometry(32, catwalkH + 2, 92);
    const hazMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.5 });
    const hazEdge = new THREE.Mesh(hazGeo, hazMat);
    hazEdge.position.set(576 + 16, -(384 + catwalkH / 2), 0);
    this.group.add(hazEdge);

    // Boost Zone (Elevation Staging Zone) floor marker: x: 256..448, y: 544
    const boostGeo = new THREE.BoxGeometry(192, 2, 80);
    const boostMat = new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.5, metalness: 0.2 });
    const boostMarker = new THREE.Mesh(boostGeo, boostMat);
    boostMarker.position.set(256 + 96, -543, 0);
    this.group.add(boostMarker);

    // 4. Bolted Bunk Bed in Background (x: 70..210, y: 460)
    const bedFrameGeo = new THREE.BoxGeometry(130, 8, 40);
    const bedMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.6, metalness: 0.6 });
    const bed = new THREE.Mesh(bedFrameGeo, bedMat);
    bed.position.set(140, -(460 + 4), -15);
    bed.castShadow = true;
    this.group.add(bed);

    // Thin Navy Mattress & Blanket
    const matGeo = new THREE.BoxGeometry(124, 6, 36);
    const matMat = new THREE.MeshStandardMaterial({ color: 0x1e3a5f, roughness: 0.85 });
    const mattress = new THREE.Mesh(matGeo, matMat);
    mattress.position.set(140, -457, -15);
    this.group.add(mattress);

    // Support Chains
    const chainMat = new THREE.MeshStandardMaterial({ color: 0x64748b, metalness: 0.8, roughness: 0.3 });
    const chainGeo = new THREE.CylinderGeometry(1.5, 1.5, 45, 8);
    const chain1 = new THREE.Mesh(chainGeo, chainMat);
    chain1.position.set(85, -438, -15);
    const chain2 = new THREE.Mesh(chainGeo, chainMat);
    chain2.position.set(195, -438, -15);
    this.group.add(chain1);
    this.group.add(chain2);

    // 5. Deployed Manila Hemp Rope (x: 992, spans Y: -384 down to -544)
    const ropeH = 544 - 384; // 160 px
    const ropeGeo = new THREE.CylinderGeometry(3.0, 3.0, ropeH, 10);
    const ropeMat = new THREE.MeshStandardMaterial({
      color: 0xc2824e,
      roughness: 0.9,
      metalness: 0.05
    });
    this.ropeMesh = new THREE.Mesh(ropeGeo, ropeMat);
    this.ropeMesh.position.set(992, -(384 + ropeH / 2), 0);
    this.ropeMesh.castShadow = true;
    this.ropeMesh.visible = false; // toggled by puzzleState
    this.group.add(this.ropeMesh);

    // Forged Anchor Eye-Bolt
    const boltGeo = new THREE.TorusGeometry(6, 2.0, 8, 16);
    const boltMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.8, roughness: 0.3 });
    const bolt = new THREE.Mesh(boltGeo, boltMat);
    bolt.position.set(992, -380, 0);
    this.group.add(bolt);

    // 6. Heavy Industrial Exit Door (x: 1504..1568, y: 288..384)
    const doorW = 64;
    const doorH = 96;
    const doorGeo = new THREE.BoxGeometry(doorW, doorH, 16);
    const doorMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.5, metalness: 0.7 });
    const exitDoor = new THREE.Mesh(doorGeo, doorMat);
    exitDoor.position.set(1504 + doorW / 2, -(288 + doorH / 2), -10);
    exitDoor.receiveShadow = true;
    this.group.add(exitDoor);

    // Status Indicator Light
    this.exitDoorGlow = new THREE.PointLight(0x22c55e, 2.0, 120);
    this.exitDoorGlow.position.set(1504 + doorW - 8, -(288 + doorH / 2), 8);
    this.group.add(this.exitDoorGlow);
  }

  private buildLighting(): void {
    // 1. Natural Hemisphere Ambient Fill (cool sky + warm bounce)
    const hemi = new THREE.HemisphereLight(0xdbeafe, 0x1e293b, 1.8);
    hemi.position.set(800, 500, 200);
    this.group.add(hemi);

    // 2. High-Powered Directional Key Light with Real-time PCF Soft Shadows
    const dirKey = new THREE.DirectionalLight(0xffffff, 2.4);
    dirKey.position.set(500, 200, 400);
    dirKey.target.position.set(800, -400, 0);
    dirKey.castShadow = true;
    dirKey.shadow.mapSize.width = 2048;
    dirKey.shadow.mapSize.height = 2048;
    dirKey.shadow.camera.left = -900;
    dirKey.shadow.camera.right = 900;
    dirKey.shadow.camera.top = 450;
    dirKey.shadow.camera.bottom = -450;
    dirKey.shadow.camera.near = 50;
    dirKey.shadow.camera.far = 1600;
    dirKey.shadow.bias = -0.0005;
    this.group.add(dirKey);
    this.group.add(dirKey.target);

    // 3. Overhead Prison Fixture 1 (Above Bunk & Boost Zone at x: 280)
    const bulb1 = new THREE.PointLight(0xfff7ed, 3.0, 550, 0.5);
    bulb1.position.set(280, -280, 80);
    this.group.add(bulb1);

    // 4. Overhead Prison Fixture 2 (Above Catwalk & Rope Anchor at x: 992)
    const bulb2 = new THREE.PointLight(0xfff7ed, 3.0, 550, 0.5);
    bulb2.position.set(992, -220, 80);
    this.group.add(bulb2);

    // 5. Cinematic Cyan Floodlight from High Security Window (x: 200, y: -200)
    const winLight = new THREE.DirectionalLight(0x38bdf8, 1.4);
    winLight.position.set(200, -100, 250);
    winLight.target.position.set(450, -500, 0);
    this.group.add(winLight);
    this.group.add(winLight.target);
  }

  public update(campaign: ClientCampaignSync): void {
    const isRopeDeployed = campaign.puzzleState?.deployedMechanisms?.includes('rope_anchor');
    if (this.ropeMesh) {
      this.ropeMesh.visible = Boolean(isRopeDeployed);
    }
  }
}
