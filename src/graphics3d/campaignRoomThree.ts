import * as THREE from 'three';
import { ClientCampaignSync } from '../../server/campaign/campaignSession.js';
import { CampaignItem } from '../../server/campaign/roomRuntime.js';

/**
 * Recursively disposes all geometries, materials, and textures within an Object3D hierarchy
 * to prevent GPU/WebGL memory leaks during repeated room transitions or item pickups.
 */
export function disposeHierarchy(obj: THREE.Object3D): void {
  obj.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) {
      mesh.geometry.dispose();
    }
    if (mesh.material) {
      if (Array.isArray(mesh.material)) {
        for (const mat of mesh.material) {
          disposeMaterial(mat);
        }
      } else {
        disposeMaterial(mesh.material);
      }
    }
    if ((child as any).dispose && typeof (child as any).dispose === 'function' && !mesh.geometry) {
      (child as any).dispose();
    }
  });
}

export function disposeMaterial(mat: THREE.Material): void {
  for (const key of Object.keys(mat)) {
    const val = (mat as any)[key];
    if (val && typeof val === 'object' && val.isTexture) {
      val.dispose();
    }
  }
  mat.dispose();
}

/**
 * Procedural 3D prison architecture and interactive mechanism renderer for all campaign rooms.
 * Dynamically renders:
 * - Authoritative room geometry (concrete walls, floors, catwalks, airlock doors, ladders)
 * - Authoritative 3D ground items (keys, bolt cutters, ropes with bobbing/rotating glowing animations)
 * - Room-specific puzzle mechanisms (searchlights, guards, switches, Box C, emergency ladder, surface breach)
 */
export class CampaignRoomThreeEnvironment {
  public group: THREE.Group;
  private currentRoomId: number = 0;

  // Static room geometry group (rebuilt when roomId changes)
  private staticGroup: THREE.Group;

  // Dynamic interactive elements group (updated every frame)
  private dynamicGroup: THREE.Group;

  // Specific mechanism mesh caches
  private itemMeshes: Map<string, THREE.Group> = new Map();
  private doorLights: Map<string, THREE.PointLight> = new Map();
  private switchALight: THREE.PointLight | null = null;
  private switchAMesh: THREE.Mesh | null = null;
  private switchBLight: THREE.PointLight | null = null;
  private switchBMesh: THREE.Mesh | null = null;
  private searchlightObj: THREE.SpotLight | null = null;
  private searchlightBeam: THREE.Mesh | null = null;
  private guardObj: THREE.Group | null = null;
  private room1RopeMesh: THREE.Mesh | null = null;
  private emergencyLadderGroup: THREE.Group | null = null;
  private hatchRebarGroup: THREE.Group | null = null;
  private hatchPortalMesh: THREE.Mesh | null = null;
  private hatchPortalLight: THREE.PointLight | null = null;
  private boxCMesh: THREE.Mesh | null = null;

  constructor() {
    this.group = new THREE.Group();

    this.staticGroup = new THREE.Group();
    this.group.add(this.staticGroup);

    this.dynamicGroup = new THREE.Group();
    this.group.add(this.dynamicGroup);
  }

  /**
   * Called every frame from ThreeGameRenderer.renderCampaign()
   */
  public update(campaign: ClientCampaignSync): void {
    const now = performance.now();

    // 1. Rebuild static architecture when entering a new room
    if (this.currentRoomId !== campaign.roomId) {
      this.buildStaticRoom(campaign);
      this.currentRoomId = campaign.roomId;
    }

    // 2. Update dynamic ground items (keys, tools, ropes)
    this.updateGroundItems(campaign.groundItems, now);

    // 3. Update room-specific interactive mechanism states
    this.updateRoomMechanisms(campaign, now);
  }

  /**
   * Build static room architecture from authoritative campaign geometry.
   */
  private buildStaticRoom(campaign: ClientCampaignSync): void {
    // 1. Recursively dispose all previous static meshes, geometries, materials, and textures
    disposeHierarchy(this.staticGroup);
    while (this.staticGroup.children.length > 0) {
      this.staticGroup.remove(this.staticGroup.children[0]);
    }

    // 2. Clean up dynamic ground items from previous room with full disposal
    for (const grp of this.itemMeshes.values()) {
      this.dynamicGroup.remove(grp);
      disposeHierarchy(grp);
    }
    this.itemMeshes.clear();

    this.doorLights.clear();
    this.switchALight = null;
    this.switchAMesh = null;
    this.switchBLight = null;
    this.switchBMesh = null;
    this.searchlightObj = null;
    this.searchlightBeam = null;
    this.guardObj = null;
    this.room1RopeMesh = null;
    this.emergencyLadderGroup = null;
    this.hatchRebarGroup = null;
    this.hatchPortalMesh = null;
    this.hatchPortalLight = null;
    this.boxCMesh = null;

    const roomW = campaign.roomWidth || 1600;
    const roomH = campaign.roomHeight || 640;

    // A. Concrete Back Wall
    const wallGeo = new THREE.PlaneGeometry(roomW, roomH);
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x1e2632,
      roughness: 0.88,
      metalness: 0.1
    });
    const backWall = new THREE.Mesh(wallGeo, wallMat);
    backWall.position.set(roomW / 2, -roomH / 2, -35);
    backWall.receiveShadow = true;
    this.staticGroup.add(backWall);

    // Formwork horizontal panel seams
    for (let y = -64; y > -roomH; y -= 64) {
      const seamGeo = new THREE.BoxGeometry(roomW, 2, 2);
      const seamMat = new THREE.MeshStandardMaterial({ color: 0x11161d, roughness: 1 });
      const seam = new THREE.Mesh(seamGeo, seamMat);
      seam.position.set(roomW / 2, y, -34);
      this.staticGroup.add(seam);
    }

    // Tie-rod indentations
    const tieMat = new THREE.MeshStandardMaterial({ color: 0x0f151c, roughness: 0.9 });
    for (let x = 64; x < roomW; x += 128) {
      for (let y = -48; y > -roomH; y -= 128) {
        const tieGeo = new THREE.CylinderGeometry(3.5, 3.5, 2, 8);
        tieGeo.rotateX(Math.PI / 2);
        const tie = new THREE.Mesh(tieGeo, tieMat);
        tie.position.set(x, y, -34.5);
        this.staticGroup.add(tie);
      }
    }

    // B. Concrete Platforms & Walls from authoritative geometry
    const platformMat = new THREE.MeshStandardMaterial({
      color: 0x3d4959,
      roughness: 0.75,
      metalness: 0.25
    });
    const crateMat = new THREE.MeshStandardMaterial({
      color: 0x925b29,
      roughness: 0.65,
      metalness: 0.15
    });
    const borderMat = new THREE.MeshStandardMaterial({
      color: 0x242d38,
      roughness: 0.9
    });

    for (const w of campaign.walls) {
      const isCrate = w.width <= 128 && w.height <= 80 && w.solid && w.isPlatform;
      const mat = isCrate ? crateMat : platformMat;

      const boxGeo = new THREE.BoxGeometry(w.width, w.height, 80);
      const mesh = new THREE.Mesh(boxGeo, mat);
      mesh.position.set(w.x + w.width / 2, -(w.y + w.height / 2), 0);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.staticGroup.add(mesh);

      // Steel edging on platform top
      const edgeGeo = new THREE.BoxGeometry(w.width, 3, 82);
      const edgeMesh = new THREE.Mesh(edgeGeo, borderMat);
      edgeMesh.position.set(w.x + w.width / 2, -(w.y + 1.5), 0);
      this.staticGroup.add(edgeMesh);
    }

    // C. Doors (Airlocks & Blast Doors)
    for (const d of campaign.doors) {
      const doorMat = new THREE.MeshStandardMaterial({
        color: 0x222b35,
        metalness: 0.7,
        roughness: 0.4
      });
      const doorGeo = new THREE.BoxGeometry(d.rect.width, d.rect.height, 30);
      const doorMesh = new THREE.Mesh(doorGeo, doorMat);
      doorMesh.position.set(
        d.rect.x + d.rect.width / 2,
        -(d.rect.y + d.rect.height / 2),
        -10
      );
      doorMesh.castShadow = true;
      this.staticGroup.add(doorMesh);

      // Door indicator light
      const isExit = d.id.includes('exit');
      const lightColor = isExit ? 0x22c55e : 0x0284c7;
      const light = new THREE.PointLight(lightColor, 1.2, 160);
      light.position.set(
        d.rect.x + d.rect.width / 2,
        -(d.rect.y + 16),
        15
      );
      this.staticGroup.add(light);
      this.doorLights.set(d.id, light);
    }

    // D. Ladders (Steel rails and horizontal rungs)
    const ladderRailMat = new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.8, roughness: 0.3 });
    const ladderRungMat = new THREE.MeshStandardMaterial({ color: 0x64748b, metalness: 0.7, roughness: 0.4 });

    for (const lad of campaign.ladders) {
      if (lad.id === 'emergency_ladder') {
        // Special mechanism: built dynamically below
        continue;
      }
      if (lad.id === 'cell_rope') {
        continue; // Handled as rope mechanism
      }

      const ladX = lad.x;
      const ladY = lad.y;
      const ladW = Math.max(24, lad.width);
      const ladH = lad.height;

      const railGeo = new THREE.BoxGeometry(4, ladH, 8);
      const leftRail = new THREE.Mesh(railGeo, ladderRailMat);
      leftRail.position.set(ladX - ladW / 2 + 2, -(ladY + ladH / 2), 0);
      const rightRail = new THREE.Mesh(railGeo, ladderRailMat);
      rightRail.position.set(ladX + ladW / 2 - 2, -(ladY + ladH / 2), 0);
      this.staticGroup.add(leftRail);
      this.staticGroup.add(rightRail);

      for (let ry = ladY + 12; ry < ladY + ladH; ry += 24) {
        const rungGeo = new THREE.CylinderGeometry(2, 2, ladW - 6, 8);
        rungGeo.rotateZ(Math.PI / 2);
        const rung = new THREE.Mesh(rungGeo, ladderRungMat);
        rung.position.set(ladX, -ry, 0);
        this.staticGroup.add(rung);
      }
    }

    // E. Ceiling Overhead Floodlights
    for (let lx = 200; lx < roomW; lx += 350) {
      const lampGeo = new THREE.BoxGeometry(48, 8, 16);
      const lampMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.5 });
      const lamp = new THREE.Mesh(lampGeo, lampMat);
      lamp.position.set(lx, -24, 0);
      this.staticGroup.add(lamp);

      const bulbGeo = new THREE.BoxGeometry(40, 3, 10);
      const bulbMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
      const bulb = new THREE.Mesh(bulbGeo, bulbMat);
      bulb.position.set(lx, -28, 0);
      this.staticGroup.add(bulb);

      const pLight = new THREE.PointLight(0xfef08a, 0.9, 420);
      pLight.position.set(lx, -36, 40);
      this.staticGroup.add(pLight);
    }

    // F. Construct static anchors and pedestals for room-specific puzzles
    this.buildStaticPuzzleAnchors(campaign);
  }

  /**
   * Build room-specific mechanism anchors (levers, switches, pedestals).
   */
  private buildStaticPuzzleAnchors(campaign: ClientCampaignSync): void {
    const roomId = campaign.roomId;

    if (roomId === 1) {
      // Room 1 Deployed Rope (spans y: 384..544 at x=992)
      const ropeH = 544 - 384;
      const ropeGeo = new THREE.CylinderGeometry(3.0, 3.0, ropeH, 10);
      const ropeMat = new THREE.MeshStandardMaterial({ color: 0xc2824e, roughness: 0.9 });
      this.room1RopeMesh = new THREE.Mesh(ropeGeo, ropeMat);
      this.room1RopeMesh.position.set(992, -(384 + ropeH / 2), 0);
      this.room1RopeMesh.visible = false;
      this.staticGroup.add(this.room1RopeMesh);

      // Anchor bolt
      const boltGeo = new THREE.TorusGeometry(6, 2.0, 8, 16);
      const boltMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.8 });
      const bolt = new THREE.Mesh(boltGeo, boltMat);
      bolt.position.set(992, -380, 0);
      this.staticGroup.add(bolt);

    } else if (roomId === 2) {
      // Reset Lever Pedestal at x=384, y=544
      const levGeo = new THREE.BoxGeometry(12, 24, 8);
      const levMat = new THREE.MeshStandardMaterial({ color: 0x7f1d1d, metalness: 0.5 });
      const levMesh = new THREE.Mesh(levGeo, levMat);
      levMesh.position.set(384, -(544 - 12), 0);
      this.staticGroup.add(levMesh);

    } else if (roomId === 3) {
      // Sleeping Guard mesh at x=768, y=544
      const guardG = new THREE.Group();
      const bodyMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.8 });
      const bodyGeo = new THREE.BoxGeometry(26, 24, 18);
      const body = new THREE.Mesh(bodyGeo, bodyMat);
      body.position.set(0, 12, 0);
      guardG.add(body);

      const headMat = new THREE.MeshStandardMaterial({ color: 0xdfb18c });
      const headGeo = new THREE.SphereGeometry(7, 8, 8);
      const head = new THREE.Mesh(headGeo, headMat);
      head.position.set(0, 28, 0);
      guardG.add(head);

      guardG.position.set(768, -544, 0);
      this.staticGroup.add(guardG);

    } else if (roomId === 4) {
      // Searchlight Spotlight fixture at top ceiling
      const sSpot = new THREE.SpotLight(0xfef08a, 2.5, 750, Math.PI / 8, 0.45);
      sSpot.position.set(160, -10, 50);
      sSpot.castShadow = true;
      this.staticGroup.add(sSpot);
      this.staticGroup.add(sSpot.target);
      this.searchlightObj = sSpot;

      // Volumetric beam cone (matching ±40px detection radius at floor y=544)
      const coneGeo = new THREE.ConeGeometry(45, 540, 16, 1, true);
      coneGeo.translate(0, -270, 0);
      const coneMat = new THREE.MeshBasicMaterial({
        color: 0xfef08a,
        transparent: true,
        opacity: 0.18,
        side: THREE.DoubleSide
      });
      const cone = new THREE.Mesh(coneGeo, coneMat);
      cone.position.set(160, 0, 0);
      this.staticGroup.add(cone);
      this.searchlightBeam = cone;

    } else if (roomId === 7) {
      // Patrolling Guard
      const gGroup = new THREE.Group();
      const gMat = new THREE.MeshStandardMaterial({ color: 0x991b1b });
      const gBody = new THREE.Mesh(new THREE.BoxGeometry(22, 36, 16), gMat);
      gBody.position.set(0, 18, 0);
      gGroup.add(gBody);

      const gEyeMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
      const gVisor = new THREE.Mesh(new THREE.BoxGeometry(10, 4, 18), gEyeMat);
      gVisor.position.set(6, 30, 0);
      gGroup.add(gVisor);

      gGroup.position.set(576, -544, 0);
      this.staticGroup.add(gGroup);
      this.guardObj = gGroup;

    } else if (roomId === 8) {
      // Dual Switches A & B
      const sGeo = new THREE.BoxGeometry(24, 32, 12);
      const sMatA = new THREE.MeshStandardMaterial({ color: 0x7f1d1d });
      const switchA = new THREE.Mesh(sGeo, sMatA);
      switchA.position.set(384, -(544 - 16), 0);
      this.staticGroup.add(switchA);
      this.switchAMesh = switchA;

      this.switchALight = new THREE.PointLight(0xef4444, 1.0, 80);
      this.switchALight.position.set(384, -(544 - 36), 15);
      this.staticGroup.add(this.switchALight);

      const sMatB = new THREE.MeshStandardMaterial({ color: 0x7f1d1d });
      const switchB = new THREE.Mesh(sGeo, sMatB);
      switchB.position.set(1152, -(544 - 16), 0);
      this.staticGroup.add(switchB);
      this.switchBMesh = switchB;

      this.switchBLight = new THREE.PointLight(0xef4444, 1.0, 80);
      this.switchBLight.position.set(1152, -(544 - 36), 15);
      this.staticGroup.add(this.switchBLight);

    } else if (roomId === 9) {
      // Key Niche Pedestal at x=256, y=544
      const nPedMat = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.8 });
      const nPed = new THREE.Mesh(new THREE.BoxGeometry(28, 28, 20), nPedMat);
      nPed.position.set(256, -(544 - 14), 0);
      this.staticGroup.add(nPed);

      // Heavy Box C Safe at x=1160, y=512 (matches authoritative interaction trigger)
      const boxMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.6, roughness: 0.4 });
      const boxC = new THREE.Mesh(new THREE.BoxGeometry(96, 64, 40), boxMat);
      boxC.position.set(1160, -512, 0);
      this.staticGroup.add(boxC);
      this.boxCMesh = boxC;

    } else if (roomId === 10) {
      // Emergency Ladder Group (deployed on platform C to floor)
      // Authoritative coordinates: x = 912, y = 192, width = 28, height = 352 (bottom at 544)
      const ladObj = campaign.ladders.find(l => l.id === 'emergency_ladder');
      const ladX = ladObj ? ladObj.x : 912;
      const ladY = ladObj ? ladObj.y : 192;
      const ladW = ladObj ? ladObj.width : 28;
      const ladH = ladObj ? ladObj.height : 352;

      const ladGroup = new THREE.Group();
      const ladRailMat = new THREE.MeshStandardMaterial({ color: 0xeab308, metalness: 0.6 });
      const ladRungMat = new THREE.MeshStandardMaterial({ color: 0xfde047, metalness: 0.5 });
      const rL = new THREE.Mesh(new THREE.BoxGeometry(4, ladH, 8), ladRailMat);
      rL.position.set(ladX - ladW / 2 + 2, -(ladY + ladH / 2), 0);
      const rR = new THREE.Mesh(new THREE.BoxGeometry(4, ladH, 8), ladRailMat);
      rR.position.set(ladX + ladW / 2 - 2, -(ladY + ladH / 2), 0);
      ladGroup.add(rL); ladGroup.add(rR);

      for (let ry = ladY + 16; ry < ladY + ladH; ry += 20) {
        const rung = new THREE.Mesh(new THREE.CylinderGeometry(2, 2, ladW - 4, 8), ladRungMat);
        rung.rotateZ(Math.PI / 2);
        rung.position.set(ladX, -ry, 0);
        ladGroup.add(rung);
      }
      ladGroup.visible = false;
      this.staticGroup.add(ladGroup);
      this.emergencyLadderGroup = ladGroup;

      // Sealed Hatch Rebar Grid centered at x=1248, y=144 (matches authoritative hatch trigger)
      const rebarG = new THREE.Group();
      const rebarMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.8, roughness: 0.2 });
      for (let bx = 1224; bx <= 1272; bx += 24) {
        const bar = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.5, 64, 8), rebarMat);
        bar.position.set(bx, -144, 5);
        rebarG.add(bar);
      }
      for (let by = 124; by <= 164; by += 20) {
        const bar = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.5, 64, 8), rebarMat);
        bar.rotateZ(Math.PI / 2);
        bar.position.set(1248, -by, 5);
        rebarG.add(bar);
      }
      this.staticGroup.add(rebarG);
      this.hatchRebarGroup = rebarG;

      // Surface Escape Breach Radiant Light
      const pMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(120, 120),
        new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.45, side: THREE.DoubleSide })
      );
      pMesh.position.set(1248, -144, 2);
      pMesh.visible = false;
      this.staticGroup.add(pMesh);
      this.hatchPortalMesh = pMesh;

      const pLight = new THREE.PointLight(0x38bdf8, 3.5, 450);
      pLight.position.set(1248, -144, 30);
      pLight.visible = false;
      this.staticGroup.add(pLight);
      this.hatchPortalLight = pLight;
    }
  }

  /**
   * Dynamically update 3D ground item models (Keys, Bolt Cutters, Ropes).
   * Animates idle hover bobbing, rotation, and particle glow.
   */
  private updateGroundItems(items: CampaignItem[], now: number): void {
    const activeItemIds = new Set(items.map(it => it.id));

    // Remove picked up items with full GPU disposal
    for (const [id, grp] of this.itemMeshes.entries()) {
      if (!activeItemIds.has(id)) {
        this.dynamicGroup.remove(grp);
        disposeHierarchy(grp);
        this.itemMeshes.delete(id);
      }
    }

    // Add or animate each item
    for (const item of items) {
      let grp = this.itemMeshes.get(item.id);
      if (!grp) {
        grp = this.createItemMesh(item.type);
        this.dynamicGroup.add(grp);
        this.itemMeshes.set(item.id, grp);
      }

      // Smooth hover bobbing and 3D spinning
      const bob = Math.sin(now * 0.005 + item.x) * 4;
      grp.position.set(item.x, -(item.y - 14) + bob, 5);
      grp.rotation.y = now * 0.0025;
    }
  }

  /**
   * Procedural 3D mesh factory for items with distinct shapes and colored glow.
   */
  private createItemMesh(type: string): THREE.Group {
    const grp = new THREE.Group();

    if (type === 'key') {
      // 3D Forged Brass Key
      const keyMat = new THREE.MeshStandardMaterial({
        color: 0xf59e0b,
        metalness: 0.9,
        roughness: 0.2
      });
      // Ring head
      const ring = new THREE.Mesh(new THREE.TorusGeometry(4.5, 1.4, 8, 16), keyMat);
      ring.position.set(0, 8, 0);
      grp.add(ring);
      // Shaft
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 14, 8), keyMat);
      shaft.position.set(0, 0, 0);
      grp.add(shaft);
      // Teeth bit
      const bit = new THREE.Mesh(new THREE.BoxGeometry(4, 2, 1.5), keyMat);
      bit.position.set(2, -4, 0);
      grp.add(bit);

      // Golden item aura light
      const pLight = new THREE.PointLight(0xfbbf24, 1.2, 70);
      pLight.position.set(0, 0, 8);
      grp.add(pLight);

    } else if (type === 'cutting_tool') {
      // 3D Heavy Bolt Cutters / Rebar Shears
      const steelMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.85, roughness: 0.25 });
      const handleMat = new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.6 });

      // Crossed shear blades
      const b1 = new THREE.Mesh(new THREE.BoxGeometry(3, 16, 2), steelMat);
      b1.rotation.z = Math.PI / 8;
      b1.position.set(-2, 4, 0);
      const b2 = new THREE.Mesh(new THREE.BoxGeometry(3, 16, 2), steelMat);
      b2.rotation.z = -Math.PI / 8;
      b2.position.set(2, 4, 0);
      grp.add(b1); grp.add(b2);

      // Ergonomic red vinyl handles
      const h1 = new THREE.Mesh(new THREE.BoxGeometry(4, 14, 3), handleMat);
      h1.position.set(-5, -8, 0);
      const h2 = new THREE.Mesh(new THREE.BoxGeometry(4, 14, 3), handleMat);
      h2.position.set(5, -8, 0);
      grp.add(h1); grp.add(h2);

      // Cyan industrial aura light
      const pLight = new THREE.PointLight(0x38bdf8, 1.2, 70);
      pLight.position.set(0, 0, 8);
      grp.add(pLight);

    } else {
      // 3D Coiled Manila Hemp Rope Bundle
      const ropeMat = new THREE.MeshStandardMaterial({ color: 0xc2824e, roughness: 0.95 });
      const coil1 = new THREE.Mesh(new THREE.TorusGeometry(6, 2.5, 8, 16), ropeMat);
      coil1.position.set(0, 0, 0);
      const coil2 = new THREE.Mesh(new THREE.TorusGeometry(5, 2.5, 8, 16), ropeMat);
      coil2.position.set(0, 2, 2);
      grp.add(coil1); grp.add(coil2);

      const pLight = new THREE.PointLight(0xeab308, 1.0, 60);
      pLight.position.set(0, 0, 8);
      grp.add(pLight);
    }

    // Glowing ground projection disk
    const haloMat = new THREE.MeshBasicMaterial({
      color: 0xfacc15,
      transparent: true,
      opacity: 0.25,
      side: THREE.DoubleSide
    });
    const halo = new THREE.Mesh(new THREE.RingGeometry(2, 12, 16), haloMat);
    halo.rotateX(Math.PI / 2);
    halo.position.set(0, -12, 0);
    grp.add(halo);

    return grp;
  }

  /**
   * Update puzzle mechanism states per tick.
   */
  private updateRoomMechanisms(campaign: ClientCampaignSync, now: number): void {
    const pz = campaign.puzzleState;
    const roomId = campaign.roomId;

    // 1. Room 1 Rope Anchor
    if (roomId === 1 && this.room1RopeMesh) {
      const deployed = pz.deployedMechanisms.includes('rope_anchor');
      this.room1RopeMesh.visible = deployed;
    }

    // 2. Room 4 Searchlight
    if (roomId === 4 && this.searchlightObj && this.searchlightBeam) {
      const sX = pz.searchlightX || 160;
      this.searchlightObj.position.set(sX, -10, 50);
      this.searchlightObj.target.position.set(sX, -544, 0);
      this.searchlightObj.target.updateMatrixWorld();
      this.searchlightBeam.position.set(sX, 0, 0);
    }

    // 3. Room 7 Patrolling Guard
    if (roomId === 7 && this.guardObj) {
      const gX = pz.guardX || 576;
      this.guardObj.position.set(gX, -544, 0);
    }

    // 4. Room 8 Dual Switches A & B
    if (roomId === 8) {
      const isA = pz.activatedSwitches.includes('switch_a');
      const isB = pz.activatedSwitches.includes('switch_b');

      if (this.switchALight && this.switchAMesh) {
        this.switchALight.color.setHex(isA ? 0x22c55e : 0xef4444);
        (this.switchAMesh.material as THREE.MeshStandardMaterial).color.setHex(isA ? 0x16a34a : 0x7f1d1d);
      }
      if (this.switchBLight && this.switchBMesh) {
        this.switchBLight.color.setHex(isB ? 0x22c55e : 0xef4444);
        (this.switchBMesh.material as THREE.MeshStandardMaterial).color.setHex(isB ? 0x16a34a : 0x7f1d1d);
      }

      // Exit Door unlock state
      const doorLight = this.doorLights.get('exit_door');
      if (doorLight) {
        const unlocked = pz.deployedMechanisms.includes('door_unlocked');
        doorLight.color.setHex(unlocked ? 0x22c55e : 0xef4444);
      }
    }

    // 5. Room 9 Box C
    if (roomId === 9 && this.boxCMesh) {
      const unlocked = pz.unlockedContainers.includes('box_c');
      (this.boxCMesh.material as THREE.MeshStandardMaterial).color.setHex(unlocked ? 0x16a34a : 0x334155);
    }

    // 6. Room 10 Emergency Ladder & Surface Hatch
    if (roomId === 10) {
      if (this.emergencyLadderGroup) {
        this.emergencyLadderGroup.visible = pz.deployedMechanisms.includes('emergency_ladder');
      }

      const isCut = pz.cutHatches.includes('sealed_hatch');
      if (this.hatchRebarGroup) {
        this.hatchRebarGroup.visible = !isCut;
      }
      if (this.hatchPortalMesh && this.hatchPortalLight) {
        this.hatchPortalMesh.visible = isCut;
        this.hatchPortalLight.visible = isCut;
        if (isCut) {
          this.hatchPortalLight.intensity = 2.5 + Math.sin(now * 0.008) * 0.8;
        }
      }
    }
  }

  /**
   * Complete GPU resource disposal for the 3D environment.
   */
  public dispose(): void {
    disposeHierarchy(this.staticGroup);
    while (this.staticGroup.children.length > 0) {
      this.staticGroup.remove(this.staticGroup.children[0]);
    }
    for (const grp of this.itemMeshes.values()) {
      this.dynamicGroup.remove(grp);
      disposeHierarchy(grp);
    }
    this.itemMeshes.clear();
    disposeHierarchy(this.dynamicGroup);
    while (this.dynamicGroup.children.length > 0) {
      this.dynamicGroup.remove(this.dynamicGroup.children[0]);
    }
  }
}
