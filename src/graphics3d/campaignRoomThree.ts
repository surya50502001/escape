import * as THREE from 'three';
import { ClientCampaignSync } from '../../server/campaign/campaignSession.js';
import { Room1ThreeEnvironment } from './room1Three.js';

/**
 * Procedural 3D prison architecture for any campaign room (Rooms 2 through 10).
 * Builds concrete walls, floors, stepping ledges, airlock doors, and ladders
 * directly from authoritative campaign room geometry.
 */
export class CampaignRoomThreeEnvironment {
  public group: THREE.Group;
  public room1Env: Room1ThreeEnvironment;
  private currentRoomId: number = 0;
  private genericGroup: THREE.Group;

  constructor() {
    this.group = new THREE.Group();
    this.room1Env = new Room1ThreeEnvironment();
    this.group.add(this.room1Env.group);

    this.genericGroup = new THREE.Group();
    this.group.add(this.genericGroup);
  }

  public update(campaign: ClientCampaignSync): void {
    if (campaign.roomId === 1) {
      this.room1Env.group.visible = true;
      this.genericGroup.visible = false;
      this.room1Env.update(campaign);
      return;
    }

    // Room 2..10: Procedural 3D Environment
    this.room1Env.group.visible = false;
    this.genericGroup.visible = true;

    if (this.currentRoomId !== campaign.roomId) {
      this.buildRoom(campaign);
      this.currentRoomId = campaign.roomId;
    }
  }

  private buildRoom(campaign: ClientCampaignSync): void {
    // Clear previous generic meshes
    while (this.genericGroup.children.length > 0) {
      const child = this.genericGroup.children[0];
      this.genericGroup.remove(child);
      if ((child as any).geometry) (child as any).geometry.dispose();
    }

    const roomW = campaign.roomWidth || 1600;
    const roomH = campaign.roomHeight || 640;

    // 1. Concrete Back Wall
    const wallGeo = new THREE.PlaneGeometry(roomW, roomH);
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x1e2632,
      roughness: 0.88,
      metalness: 0.1
    });
    const backWall = new THREE.Mesh(wallGeo, wallMat);
    backWall.position.set(roomW / 2, -roomH / 2, -35);
    backWall.receiveShadow = true;
    this.genericGroup.add(backWall);

    // Horizontal architectural panel seams
    for (let y = -64; y > -roomH; y -= 64) {
      const seamGeo = new THREE.BoxGeometry(roomW, 2, 2);
      const seamMat = new THREE.MeshStandardMaterial({ color: 0x11161d, roughness: 1 });
      const seam = new THREE.Mesh(seamGeo, seamMat);
      seam.position.set(roomW / 2, y, -34);
      this.genericGroup.add(seam);
    }

    // 2. Concrete Platforms & Walls from authoritative campaign geometry
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
      this.genericGroup.add(mesh);

      // Steel edging on top edge
      const edgeGeo = new THREE.BoxGeometry(w.width, 3, 82);
      const edgeMesh = new THREE.Mesh(edgeGeo, borderMat);
      edgeMesh.position.set(w.x + w.width / 2, -(w.y + 1.5), 0);
      this.genericGroup.add(edgeMesh);
    }

    // 3. Doors (Airlocks & Blast Doors)
    for (const d of campaign.doors) {
      const isExit = d.id.includes('exit');
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
      this.genericGroup.add(doorMesh);

      // Door indicator light
      const lightColor = isExit ? 0x22c55e : 0x0284c7;
      const light = new THREE.PointLight(lightColor, 1.2, 160);
      light.position.set(
        d.rect.x + d.rect.width / 2,
        -(d.rect.y + 16),
        15
      );
      this.genericGroup.add(light);
    }

    // 4. Ladders (Steel rails and rungs)
    const ladderRailMat = new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.8, roughness: 0.3 });
    const ladderRungMat = new THREE.MeshStandardMaterial({ color: 0x64748b, metalness: 0.7, roughness: 0.4 });

    for (const lad of campaign.ladders) {
      const ladX = lad.x;
      const ladY = lad.y;
      const ladW = Math.max(24, lad.width);
      const ladH = lad.height;

      // Left and right rails
      const railGeo = new THREE.BoxGeometry(4, ladH, 8);
      const leftRail = new THREE.Mesh(railGeo, ladderRailMat);
      leftRail.position.set(ladX - ladW / 2 + 2, -(ladY + ladH / 2), 0);
      const rightRail = new THREE.Mesh(railGeo, ladderRailMat);
      rightRail.position.set(ladX + ladW / 2 - 2, -(ladY + ladH / 2), 0);
      this.genericGroup.add(leftRail);
      this.genericGroup.add(rightRail);

      // Rungs every 24px
      for (let ry = ladY + 12; ry < ladY + ladH; ry += 24) {
        const rungGeo = new THREE.CylinderGeometry(2, 2, ladW - 6, 8);
        rungGeo.rotateZ(Math.PI / 2);
        const rung = new THREE.Mesh(rungGeo, ladderRungMat);
        rung.position.set(ladX, -ry, 0);
        this.genericGroup.add(rung);
      }
    }

    // 5. Overhead Industrial Lighting
    for (let lx = 200; lx < roomW; lx += 350) {
      const lampGeo = new THREE.BoxGeometry(48, 8, 16);
      const lampMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.5 });
      const lamp = new THREE.Mesh(lampGeo, lampMat);
      lamp.position.set(lx, -24, 0);
      this.genericGroup.add(lamp);

      const bulbGeo = new THREE.BoxGeometry(40, 3, 10);
      const bulbMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
      const bulb = new THREE.Mesh(bulbGeo, bulbMat);
      bulb.position.set(lx, -28, 0);
      this.genericGroup.add(bulb);

      const pLight = new THREE.PointLight(0xfef08a, 0.9, 420);
      pLight.position.set(lx, -36, 40);
      this.genericGroup.add(pLight);
    }
  }
}
