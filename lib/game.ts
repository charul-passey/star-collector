import * as THREE from "three";

const PLANET_RADIUS = 10;
const MAX_SPEED = 0.012;
const ACCELERATION = 0.1;
const DAMPING = 0.82;
const CAMERA_HEIGHT = 4.5;
const CAMERA_DISTANCE = 9;
const CAMERA_FOLLOW = 6;
const STAR_COUNT = 12;
const STAR_SPAWN_INTERVAL = 4500;
const COLLECT_RADIUS = 1.2;
const STAR_FADE_TIME = 9000;

interface StarObj {
  mesh: THREE.Mesh;
  light: THREE.PointLight;
  landed: boolean;
  landedAt: number;
  collected: boolean;
  fallDir: THREE.Vector3;
}

function getTangentBasis(up: THREE.Vector3) {
  const ref = Math.abs(up.y) < 0.99 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const east = new THREE.Vector3().crossVectors(ref, up).normalize();
  const north = new THREE.Vector3().crossVectors(up, east).normalize();
  return { north, east };
}

export function startGame(mount: HTMLElement): () => void {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  mount.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x080818);
  scene.fog = new THREE.FogExp2(0x080818, 0.012);

  const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 200);
  camera.position.set(0, 15, 15);

  scene.add(new THREE.AmbientLight(0x223366, 1.4));
  const sun = new THREE.DirectionalLight(0xffeebb, 0.9);
  sun.position.set(20, 30, 10);
  sun.castShadow = true;
  scene.add(sun);

  const planetGeo = new THREE.IcosahedronGeometry(PLANET_RADIUS, 4);
  const pos = planetGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const v = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
    v.multiplyScalar(1 + (Math.random() - 0.5) * 0.11);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  planetGeo.computeVertexNormals();
  const planet = new THREE.Mesh(planetGeo, new THREE.MeshPhongMaterial({ color: 0x2d5a3d, flatShading: true }));
  planet.receiveShadow = true;
  scene.add(planet);

  scene.add(new THREE.Mesh(
    new THREE.IcosahedronGeometry(PLANET_RADIUS * 0.97, 3),
    new THREE.MeshPhongMaterial({ color: 0x1a3a6b, flatShading: true, transparent: true, opacity: 0.8 })
  ));

  for (let i = 0; i < 28; i++) {
    const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.1, 0.5, 5),
      new THREE.MeshPhongMaterial({ color: 0x5c3317, flatShading: true }));
    trunk.position.y = 0.25;
    g.add(trunk);
    const top = new THREE.Mesh(new THREE.IcosahedronGeometry(0.32, 1),
      new THREE.MeshPhongMaterial({ color: 0x2d7a3d + Math.floor(Math.random() * 0x0f0f0f), flatShading: true }));
    top.position.y = 0.6;
    g.add(top);
    g.position.copy(dir.clone().multiplyScalar(PLANET_RADIUS + 0.1));
    g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    g.scale.setScalar(0.6 + Math.random() * 0.6);
    scene.add(g);
  }

  const bgVerts: number[] = [];
  for (let i = 0; i < 1000; i++) {
    const r = 80 + Math.random() * 20;
    const phi = Math.acos(2 * Math.random() - 1);
    const theta = Math.random() * Math.PI * 2;
    bgVerts.push(r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta));
  }
  const bgGeo = new THREE.BufferGeometry();
  bgGeo.setAttribute("position", new THREE.Float32BufferAttribute(bgVerts, 3));
  scene.add(new THREE.Points(bgGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.25 })));

  const playerGroup = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.17, 0.21, 0.52, 6),
    new THREE.MeshPhongMaterial({ color: 0xe8c87a, flatShading: true })
  );
  body.position.y = 0.26;
  const head = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.21, 1),
    new THREE.MeshPhongMaterial({ color: 0xf5deb3, flatShading: true })
  );
  head.position.y = 0.68;
  playerGroup.add(body, head);
  scene.add(playerGroup);

  mount.style.position = "relative";
  const scoreEl = document.createElement("div");
  scoreEl.style.cssText = "position:absolute;top:20px;left:50%;transform:translateX(-50%);color:#fffde7;font-family:sans-serif;font-size:18px;font-weight:600;text-shadow:0 0 10px #ffe082;letter-spacing:2px;pointer-events:none;";
  scoreEl.textContent = "Stars: 0";
  mount.appendChild(scoreEl);
  const hintEl = document.createElement("div");
  hintEl.style.cssText = "position:absolute;bottom:20px;left:50%;transform:translateX(-50%);color:rgba(255,255,255,0.45);font-family:sans-serif;font-size:13px;pointer-events:none;";
  hintEl.textContent = "WASD · Mouse to look";
  mount.appendChild(hintEl);

  let playerDir = new THREE.Vector3(0, 1, 0);
  let velocity = new THREE.Vector3();
  let facingAngle = 0;
  let cameraYaw = 0;
  const keys = new Set<string>();
  const stars: StarObj[] = [];
  const constellationPts: THREE.Vector3[] = [];
  let score = 0;
  let spawnTimer = 0;

  let mouseDown = false, lastMX = 0;
  const onMouseDown = (e: MouseEvent) => { mouseDown = true; lastMX = e.clientX; };
  const onMouseUp = () => { mouseDown = false; };
  const onMouseMove = (e: MouseEvent) => { if (mouseDown) { cameraYaw += (e.clientX - lastMX) * 0.004; lastMX = e.clientX; } };
  const onTouchStart = (e: TouchEvent) => { lastMX = e.touches[0].clientX; };
  const onTouchMove = (e: TouchEvent) => { cameraYaw += (e.touches[0].clientX - lastMX) * 0.005; lastMX = e.touches[0].clientX; };
  const onKeyDown = (e: KeyboardEvent) => keys.add(e.key.toLowerCase());
  const onKeyUp = (e: KeyboardEvent) => keys.delete(e.key.toLowerCase());

  mount.addEventListener("mousedown", onMouseDown);
  window.addEventListener("mouseup", onMouseUp);
  window.addEventListener("mousemove", onMouseMove);
  mount.addEventListener("touchstart", onTouchStart);
  mount.addEventListener("touchmove", onTouchMove);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);

  function spawnStar() {
    const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    const hue = 0.08 + Math.random() * 0.12;
    const col = new THREE.Color().setHSL(hue, 1, 0.72);
    const mesh = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.24, 1),
      new THREE.MeshPhongMaterial({ color: col, emissive: col.clone().multiplyScalar(0.4), flatShading: true })
    );
    mesh.position.copy(dir.clone().multiplyScalar(26));
    const light = new THREE.PointLight(col, 1.8, 7);
    mesh.add(light);
    scene.add(mesh);
    stars.push({ mesh, light, landed: false, landedAt: 0, collected: false, fallDir: dir.clone().negate() });
  }

  function addConstellationLine(a: THREE.Vector3, b: THREE.Vector3) {
    const geo = new THREE.BufferGeometry().setFromPoints([a.clone().multiplyScalar(1.06), b.clone().multiplyScalar(1.06)]);
    scene.add(new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffe082, transparent: true, opacity: 0.45 })));
  }

  const onResize = () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  };
  window.addEventListener("resize", onResize);

  let lastTime = performance.now();
  let animId: number;

  function animate(now: number) {
    animId = requestAnimationFrame(animate);
    const dt = Math.min(now - lastTime, 50);
    lastTime = now;
    const tf = dt / 16.667;

    const up = playerDir.clone();
    const { north, east } = getTangentBasis(up);
    const camFwd = north.clone().multiplyScalar(Math.cos(cameraYaw)).addScaledVector(east, Math.sin(cameraYaw));
    const camRight = north.clone().multiplyScalar(-Math.sin(cameraYaw)).addScaledVector(east, Math.cos(cameraYaw));

    const inputDir = new THREE.Vector3();
    if (keys.has("w") || keys.has("arrowup")) inputDir.addScaledVector(camFwd, 1);
    if (keys.has("s") || keys.has("arrowdown")) inputDir.addScaledVector(camFwd, -1);
    if (keys.has("a") || keys.has("arrowleft")) inputDir.addScaledVector(camRight, -1);
    if (keys.has("d") || keys.has("arrowright")) inputDir.addScaledVector(camRight, 1);
    const hasInput = inputDir.lengthSq() > 0.001;
    if (hasInput) inputDir.normalize();

    velocity.lerp(hasInput ? inputDir.clone().multiplyScalar(MAX_SPEED) : new THREE.Vector3(),
      hasInput ? ACCELERATION * tf : (1 - DAMPING) * tf * 3);
    const speed = velocity.length();
    playerDir.addScaledVector(velocity, tf);
    playerDir.normalize();
    const newUp = playerDir.clone();
    velocity.addScaledVector(newUp, -velocity.dot(newUp));

    if (speed > 0.0005) {
      const { north: n2, east: e2 } = getTangentBasis(playerDir);
      const vn = velocity.clone().normalize();
      const targetFacing = Math.atan2(vn.dot(e2), vn.dot(n2));
      const delta = ((targetFacing - facingAngle + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      facingAngle += delta * Math.min(0.18 * tf, 1);
    }

    const playerPos = playerDir.clone().multiplyScalar(PLANET_RADIUS + 0.05);
    playerGroup.position.copy(playerPos);
    const baseQ = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), playerDir);
    const faceQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), facingAngle);
    playerGroup.quaternion.copy(baseQ.multiply(faceQ));
    const bobAmt = speed > 0.0005 ? Math.sin(now * 0.014) * 0.07 : 0;
    body.position.y += (0.26 + bobAmt - body.position.y) * 0.25;
    head.position.y += (0.68 + bobAmt * 0.5 - head.position.y) * 0.25;

    const { north: cn, east: ce } = getTangentBasis(playerDir);
    const camBack = cn.clone().multiplyScalar(-Math.cos(cameraYaw)).addScaledVector(ce, -Math.sin(cameraYaw));
    const targetCamPos = playerPos.clone().addScaledVector(playerDir, CAMERA_HEIGHT).addScaledVector(camBack, CAMERA_DISTANCE);
    camera.position.lerp(targetCamPos, 1 - Math.exp(-CAMERA_FOLLOW * dt / 1000));
    camera.lookAt(playerPos.clone().addScaledVector(playerDir, 0.6));

    spawnTimer += dt;
    if (spawnTimer > STAR_SPAWN_INTERVAL && stars.filter(s => !s.collected).length < STAR_COUNT) {
      spawnStar();
      spawnTimer = 0;
    }

    for (const star of stars) {
      if (star.collected) continue;
      if (!star.landed) {
        star.mesh.position.addScaledVector(star.fallDir, 0.055 * tf);
        star.mesh.rotation.y += 0.025 * tf;
        if (star.mesh.position.length() <= PLANET_RADIUS + 0.3) {
          star.landed = true;
          star.landedAt = now;
          const sd = star.mesh.position.clone().normalize();
          star.mesh.position.copy(sd.multiplyScalar(PLANET_RADIUS + 0.28));
        }
      } else {
        const sd = star.mesh.position.clone().normalize();
        star.mesh.position.copy(sd.multiplyScalar(PLANET_RADIUS + 0.28 + Math.sin(now * 0.002 + star.landedAt) * 0.09));
        star.mesh.rotation.y += 0.012 * tf;
        const age = now - star.landedAt;
        if (age > STAR_FADE_TIME) {
          const fade = 1 - (age - STAR_FADE_TIME) / 3000;
          (star.mesh.material as THREE.MeshPhongMaterial).opacity = Math.max(0, fade);
          (star.mesh.material as THREE.MeshPhongMaterial).transparent = true;
          star.light.intensity = Math.max(0, fade * 1.8);
          if (fade <= 0) { scene.remove(star.mesh); star.collected = true; continue; }
        }
        if (playerPos.distanceTo(star.mesh.position) < COLLECT_RADIUS) {
          scene.remove(star.mesh);
          star.collected = true;
          score++;
          scoreEl.textContent = `Stars: ${score}`;
          const wp = star.mesh.position.clone();
          if (constellationPts.length > 0) addConstellationLine(constellationPts[constellationPts.length - 1], wp);
          constellationPts.push(wp);
          const flash = new THREE.PointLight(0xffe082, 5, 9);
          flash.position.copy(wp);
          scene.add(flash);
          setTimeout(() => scene.remove(flash), 350);
        }
      }
    }

    renderer.render(scene, camera);
  }

  for (let i = 0; i < 4; i++) spawnStar();
  animId = requestAnimationFrame(animate);

  return () => {
    cancelAnimationFrame(animId);
    window.removeEventListener("mouseup", onMouseUp);
    window.removeEventListener("mousemove", onMouseMove);
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("resize", onResize);
    renderer.dispose();
    if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
    if (mount.contains(scoreEl)) mount.removeChild(scoreEl);
    if (mount.contains(hintEl)) mount.removeChild(hintEl);
  };
}
