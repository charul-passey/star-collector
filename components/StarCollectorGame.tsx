"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

const PLANET_RADIUS = 10;
const PLAYER_SPEED = 0.018;
const CAMERA_HEIGHT = 5;
const CAMERA_DISTANCE = 8;
const STAR_COUNT = 12;
const STAR_SPAWN_HEIGHT = 25;
const STAR_FALL_SPEED = 0.04;
const COLLECT_RADIUS = 1.2;
const STAR_FADE_TIME = 8000; // ms before landed star fades

interface StarObj {
  mesh: THREE.Mesh;
  landed: boolean;
  landedAt: number;
  collected: boolean;
  velocity: THREE.Vector3;
  light: THREE.PointLight;
}

interface ConstellationLine {
  from: THREE.Vector3;
  to: THREE.Vector3;
  line: THREE.Line;
}

export default function StarCollectorGame() {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    // --- Renderer ---
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    mount.appendChild(renderer.domElement);

    // --- Scene ---
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0a1a);
    scene.fog = new THREE.Fog(0x0a0a1a, 40, 80);

    // --- Camera ---
    const camera = new THREE.PerspectiveCamera(
      60,
      mount.clientWidth / mount.clientHeight,
      0.1,
      200
    );

    // --- Lighting ---
    const ambientLight = new THREE.AmbientLight(0x223366, 1.2);
    scene.add(ambientLight);
    const sunLight = new THREE.DirectionalLight(0xffeebb, 1.0);
    sunLight.position.set(20, 30, 10);
    sunLight.castShadow = true;
    scene.add(sunLight);

    // --- Planet ---
    const planetGeo = new THREE.IcosahedronGeometry(PLANET_RADIUS, 4);
    // Slightly randomize vertices for organic low-poly look
    const posAttr = planetGeo.attributes.position;
    for (let i = 0; i < posAttr.count; i++) {
      const v = new THREE.Vector3(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
      const noise = 1 + (Math.random() - 0.5) * 0.12;
      v.multiplyScalar(noise);
      posAttr.setXYZ(i, v.x, v.y, v.z);
    }
    planetGeo.computeVertexNormals();
    const planetMat = new THREE.MeshPhongMaterial({
      color: 0x2d5a3d,
      flatShading: true,
    });
    const planet = new THREE.Mesh(planetGeo, planetMat);
    planet.receiveShadow = true;
    scene.add(planet);

    // Ocean sphere slightly smaller
    const oceanGeo = new THREE.IcosahedronGeometry(PLANET_RADIUS * 0.97, 3);
    const oceanMat = new THREE.MeshPhongMaterial({
      color: 0x1a3a6b,
      flatShading: true,
      transparent: true,
      opacity: 0.85,
    });
    scene.add(new THREE.Mesh(oceanGeo, oceanMat));

    // Small trees scattered on surface
    const treePositions: THREE.Vector3[] = [];
    for (let i = 0; i < 30; i++) {
      const dir = new THREE.Vector3(
        Math.random() - 0.5,
        Math.random() - 0.5,
        Math.random() - 0.5
      ).normalize();
      treePositions.push(dir);
      const treeGroup = new THREE.Group();
      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.06, 0.1, 0.5, 5),
        new THREE.MeshPhongMaterial({ color: 0x5c3317, flatShading: true })
      );
      const foliage = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.35, 1),
        new THREE.MeshPhongMaterial({ color: 0x2d7a3d + Math.floor(Math.random() * 0x101010), flatShading: true })
      );
      foliage.position.y = 0.45;
      treeGroup.add(trunk, foliage);
      treeGroup.position.copy(dir.clone().multiplyScalar(PLANET_RADIUS + 0.1));
      treeGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      treeGroup.scale.setScalar(0.7 + Math.random() * 0.6);
      scene.add(treeGroup);
    }

    // Background stars (static)
    const bgStarGeo = new THREE.BufferGeometry();
    const bgStarVerts: number[] = [];
    for (let i = 0; i < 800; i++) {
      const r = 80 + Math.random() * 20;
      const phi = Math.acos(2 * Math.random() - 1);
      const theta = Math.random() * Math.PI * 2;
      bgStarVerts.push(
        r * Math.sin(phi) * Math.cos(theta),
        r * Math.cos(phi),
        r * Math.sin(phi) * Math.sin(theta)
      );
    }
    bgStarGeo.setAttribute("position", new THREE.Float32BufferAttribute(bgStarVerts, 3));
    scene.add(new THREE.Points(bgStarGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.3 })));

    // --- Player ---
    const playerGroup = new THREE.Group();
    const bodyGeo = new THREE.CylinderGeometry(0.18, 0.22, 0.55, 6);
    const bodyMat = new THREE.MeshPhongMaterial({ color: 0xe8c87a, flatShading: true });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 0.28;
    const headGeo = new THREE.IcosahedronGeometry(0.22, 1);
    const headMat = new THREE.MeshPhongMaterial({ color: 0xf5deb3, flatShading: true });
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = 0.72;
    playerGroup.add(body, head);
    scene.add(playerGroup);

    // --- Game state ---
    let playerDir = new THREE.Vector3(0, 1, 0); // unit vector pointing from center to player
    let cameraYaw = 0;
    const keys = new Set<string>();
    const stars: StarObj[] = [];
    const constellationPoints: THREE.Vector3[] = [];
    const constellationLines: ConstellationLine[] = [];
    let score = 0;
    let nextStarTimer = 0;
    const STAR_SPAWN_INTERVAL = 4000;

    // Score display
    const scoreEl = document.createElement("div");
    scoreEl.style.cssText = `
      position:absolute;top:20px;left:50%;transform:translateX(-50%);
      color:#fffde7;font-family:sans-serif;font-size:18px;font-weight:600;
      text-shadow:0 0 10px #ffe082;letter-spacing:2px;pointer-events:none;
    `;
    scoreEl.textContent = "Stars: 0";
    mount.style.position = "relative";
    mount.appendChild(scoreEl);

    const hintEl = document.createElement("div");
    hintEl.style.cssText = `
      position:absolute;bottom:20px;left:50%;transform:translateX(-50%);
      color:rgba(255,255,255,0.5);font-family:sans-serif;font-size:13px;
      pointer-events:none;
    `;
    hintEl.textContent = "WASD / Arrow Keys to move · Mouse to look";
    mount.appendChild(hintEl);

    // --- Input ---
    const onKey = (e: KeyboardEvent, down: boolean) => {
      keys[down ? "add" : "delete"](e.key.toLowerCase());
    };
    window.addEventListener("keydown", (e) => onKey(e, true));
    window.addEventListener("keyup", (e) => onKey(e, false));

    let mouseDown = false;
    let lastMouseX = 0;
    mount.addEventListener("mousedown", (e) => { mouseDown = true; lastMouseX = e.clientX; });
    window.addEventListener("mouseup", () => { mouseDown = false; });
    window.addEventListener("mousemove", (e) => {
      if (mouseDown) {
        cameraYaw += (e.clientX - lastMouseX) * 0.005;
        lastMouseX = e.clientX;
      }
    });

    // Touch support
    let lastTouchX = 0;
    mount.addEventListener("touchstart", (e) => { lastTouchX = e.touches[0].clientX; });
    mount.addEventListener("touchmove", (e) => {
      cameraYaw += (e.touches[0].clientX - lastTouchX) * 0.006;
      lastTouchX = e.touches[0].clientX;
    });

    // --- Spawn star ---
    function spawnStar() {
      const dir = new THREE.Vector3(
        Math.random() - 0.5,
        Math.random() - 0.5,
        Math.random() - 0.5
      ).normalize();
      const startPos = dir.clone().multiplyScalar(STAR_SPAWN_HEIGHT);
      const velocity = dir.clone().multiplyScalar(-STAR_FALL_SPEED);

      const starGeo = new THREE.IcosahedronGeometry(0.25, 1);
      const hue = 0.1 + Math.random() * 0.1; // gold/yellow hues
      const starMat = new THREE.MeshPhongMaterial({
        color: new THREE.Color().setHSL(hue, 1, 0.7),
        emissive: new THREE.Color().setHSL(hue, 1, 0.3),
        flatShading: true,
      });
      const starMesh = new THREE.Mesh(starGeo, starMat);
      starMesh.position.copy(startPos);

      const light = new THREE.PointLight(new THREE.Color().setHSL(hue, 1, 0.6), 1.5, 6);
      starMesh.add(light);

      scene.add(starMesh);
      stars.push({ mesh: starMesh, landed: false, landedAt: 0, collected: false, velocity, light });
    }

    // --- Add constellation line ---
    function addConstellationLine(from: THREE.Vector3, to: THREE.Vector3) {
      const points = [from.clone().multiplyScalar(1.05), to.clone().multiplyScalar(1.05)];
      const geo = new THREE.BufferGeometry().setFromPoints(points);
      const mat = new THREE.LineBasicMaterial({ color: 0xffe082, transparent: true, opacity: 0.5 });
      const line = new THREE.Line(geo, mat);
      scene.add(line);
      constellationLines.push({ from, to, line });
    }

    // --- Helpers ---
    function getTangentBasis(up: THREE.Vector3) {
      const worldRef = Math.abs(up.y) < 0.99
        ? new THREE.Vector3(0, 1, 0)
        : new THREE.Vector3(1, 0, 0);
      const east = new THREE.Vector3().crossVectors(worldRef, up).normalize();
      const north = new THREE.Vector3().crossVectors(up, east).normalize();
      return { north, east };
    }

    // --- Resize ---
    const onResize = () => {
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
    };
    window.addEventListener("resize", onResize);

    // --- Game loop ---
    let lastTime = performance.now();
    let animId: number;

    function animate(now: number) {
      animId = requestAnimationFrame(animate);
      const dt = Math.min(now - lastTime, 50);
      lastTime = now;

      // Spawn stars
      nextStarTimer += dt;
      if (nextStarTimer > STAR_SPAWN_INTERVAL && stars.filter(s => !s.collected).length < STAR_COUNT) {
        spawnStar();
        nextStarTimer = 0;
      }

      // Move player
      const up = playerDir.clone();
      const { north, east } = getTangentBasis(up);
      const camForward = north.clone().multiplyScalar(Math.cos(cameraYaw))
        .addScaledVector(east, Math.sin(cameraYaw));
      const camRight = north.clone().multiplyScalar(-Math.sin(cameraYaw))
        .addScaledVector(east, Math.cos(cameraYaw));

      let moved = false;
      if (keys.has("w") || keys.has("arrowup")) { playerDir.addScaledVector(camForward, PLAYER_SPEED); moved = true; }
      if (keys.has("s") || keys.has("arrowdown")) { playerDir.addScaledVector(camForward, -PLAYER_SPEED); moved = true; }
      if (keys.has("a") || keys.has("arrowleft")) { playerDir.addScaledVector(camRight, -PLAYER_SPEED); moved = true; }
      if (keys.has("d") || keys.has("arrowright")) { playerDir.addScaledVector(camRight, PLAYER_SPEED); moved = true; }
      playerDir.normalize();

      // Update player mesh
      const playerPos = playerDir.clone().multiplyScalar(PLANET_RADIUS + 0.05);
      playerGroup.position.copy(playerPos);
      playerGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), playerDir);
      if (moved) {
        const t = now * 0.01;
        body.position.y = 0.28 + Math.sin(t * 2) * 0.04;
      }

      // Update camera
      const upNow = playerDir.clone();
      const { north: n2, east: e2 } = getTangentBasis(upNow);
      const camBack = n2.clone().multiplyScalar(-Math.cos(cameraYaw))
        .addScaledVector(e2, -Math.sin(cameraYaw));
      const camPos = playerPos.clone()
        .addScaledVector(upNow, CAMERA_HEIGHT)
        .addScaledVector(camBack, CAMERA_DISTANCE);
      camera.position.lerp(camPos, 0.08);
      camera.lookAt(playerPos);

      // Update stars
      const playerWorldPos = playerPos.clone();
      for (const star of stars) {
        if (star.collected) continue;

        if (!star.landed) {
          star.mesh.position.add(star.velocity);
          star.mesh.rotation.y += 0.02;
          // Check landing
          if (star.mesh.position.length() <= PLANET_RADIUS + 0.3) {
            star.landed = true;
            star.landedAt = now;
            const surfaceDir = star.mesh.position.clone().normalize();
            star.mesh.position.copy(surfaceDir.multiplyScalar(PLANET_RADIUS + 0.25));
            star.velocity.set(0, 0, 0);
          }
        } else {
          // Gentle bob
          const landedDir = star.mesh.position.clone().normalize();
          star.mesh.position.copy(landedDir.multiplyScalar(PLANET_RADIUS + 0.25 + Math.sin(now * 0.002) * 0.08));
          star.mesh.rotation.y += 0.01;

          // Fade out over time
          const age = now - star.landedAt;
          if (age > STAR_FADE_TIME) {
            const fade = 1 - (age - STAR_FADE_TIME) / 3000;
            (star.mesh.material as THREE.MeshPhongMaterial).opacity = Math.max(0, fade);
            (star.mesh.material as THREE.MeshPhongMaterial).transparent = true;
            star.light.intensity = Math.max(0, fade * 1.5);
            if (fade <= 0) {
              scene.remove(star.mesh);
              star.collected = true;
            }
          }

          // Check collection
          if (playerWorldPos.distanceTo(star.mesh.position) < COLLECT_RADIUS) {
            scene.remove(star.mesh);
            star.collected = true;
            score++;
            scoreEl.textContent = `Stars: ${score}`;

            const worldPos = star.mesh.position.clone();
            if (constellationPoints.length > 0) {
              addConstellationLine(constellationPoints[constellationPoints.length - 1], worldPos);
            }
            constellationPoints.push(worldPos);

            // Flash effect
            const flash = new THREE.PointLight(0xffe082, 4, 8);
            flash.position.copy(worldPos);
            scene.add(flash);
            setTimeout(() => scene.remove(flash), 300);
          }
        }
      }

      renderer.render(scene, camera);
    }

    // Spawn initial stars
    for (let i = 0; i < 4; i++) spawnStar();
    animId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("keydown", (e) => onKey(e, true));
      window.removeEventListener("keyup", (e) => onKey(e, false));
      window.removeEventListener("resize", onResize);
      renderer.dispose();
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
      if (mount.contains(scoreEl)) mount.removeChild(scoreEl);
      if (mount.contains(hintEl)) mount.removeChild(hintEl);
    };
  }, []);

  return <div ref={mountRef} className="w-full h-full" />;
}
