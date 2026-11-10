/* Procedural 3D models built from Three.js primitives (no external assets).
   Every model uses rotation order YXZ so yaw is applied first, then pitch, then roll. */
(function () {
  "use strict";

  const mat = {
    body:   new THREE.MeshStandardMaterial({ color: 0xd0d6e0, roughness: 0.45, metalness: 0.1 }),
    dark:   new THREE.MeshStandardMaterial({ color: 0x2d2e31, roughness: 0.6,  metalness: 0.2 }),
    mid:    new THREE.MeshStandardMaterial({ color: 0x8a8f98, roughness: 0.5,  metalness: 0.2 }),
    glass:  new THREE.MeshStandardMaterial({ color: 0xf7f8f8, roughness: 0.2,  transparent: true, opacity: 0.14, side: THREE.DoubleSide }),
    pcb:    new THREE.MeshStandardMaterial({ color: 0x3e3e44, roughness: 0.7 }),
    pins:   new THREE.MeshStandardMaterial({ color: 0xb4b8bf, roughness: 0.3, metalness: 0.8 }),
  };

  function mesh(geo, material, x = 0, y = 0, z = 0) {
    const m = new THREE.Mesh(geo, material);
    m.position.set(x, y, z);
    return m;
  }

  function quadcopter() {
    const g = new THREE.Group();
    const armGeo = new THREE.CylinderGeometry(0.08, 0.08, 4.5, 16);
    [Math.PI / 4, -Math.PI / 4].forEach((r) => {
      const arm = mesh(armGeo, mat.dark);
      arm.rotation.set(0, r, Math.PI / 2);
      g.add(arm);
    });
    g.add(mesh(new THREE.BoxGeometry(1.2, 0.3, 1.2), mat.dark));
    g.add(mesh(new THREE.SphereGeometry(0.4, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), mat.body, 0, 0.15, 0));
    // A small marker on the nose so forward is readable.
    g.add(mesh(new THREE.BoxGeometry(0.2, 0.06, 0.3), mat.body, 0, 0.18, -0.75));
    const d = 1.6;
    [[-d, -d], [d, d], [-d, d], [d, -d]].forEach(([x, z]) => {
      g.add(mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.4, 16), mat.mid, x, 0.1, z));
      g.add(mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.02, 32), mat.glass, x, 0.35, z));
    });
    return g;
  }

  function satellite() {
    const g = new THREE.Group();
    g.add(mesh(new THREE.BoxGeometry(1.2, 1.2, 1.5), mat.body));
    const panel = new THREE.BoxGeometry(4, 0.05, 1.2);
    g.add(mesh(panel, mat.pcb, 2.6, 0, 0), mesh(panel, mat.pcb, -2.6, 0, 0));
    const strut = new THREE.CylinderGeometry(0.03, 0.03, 0.6, 8);
    [0.9, -0.9].forEach((x) => { const s = mesh(strut, mat.mid, x, 0, 0); s.rotation.z = Math.PI / 2; g.add(s); });
    const dish = mesh(new THREE.CylinderGeometry(0.6, 0.2, 0.2, 32), mat.dark, 0, 0, 0.85);
    dish.rotation.x = Math.PI / 2;
    const antenna = mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.6, 8), mat.mid, 0, 0, 1.2);
    antenna.rotation.x = Math.PI / 2;
    g.add(dish, antenna);
    return g;
  }

  function rocket() {
    const g = new THREE.Group();
    const body = mesh(new THREE.CylinderGeometry(0.4, 0.4, 4, 32), mat.body);
    body.rotation.x = Math.PI / 2;
    const nose = mesh(new THREE.ConeGeometry(0.4, 1.2, 32), mat.dark, 0, 0, -2.6);
    nose.rotation.x = -Math.PI / 2;
    const nozzle = mesh(new THREE.CylinderGeometry(0.3, 0.15, 0.5, 16), mat.dark, 0, 0, 2.25);
    nozzle.rotation.x = Math.PI / 2;
    g.add(body, nose, nozzle);
    for (let i = 0; i < 4; i++) {
      const pivot = new THREE.Group();
      pivot.add(mesh(new THREE.BoxGeometry(0.05, 1.2, 1), mat.mid, 0, 0.6, 1.5));
      pivot.rotation.z = (Math.PI / 2) * i;
      g.add(pivot);
    }
    return g;
  }

  // The actual hardware: breadboard, Blue Pill and MPU6050.
  function workbench() {
    const g = new THREE.Group();
    g.add(mesh(new THREE.BoxGeometry(4.5, 0.2, 3), mat.body));
    g.add(mesh(new THREE.BoxGeometry(2.8, 0.05, 1.2), mat.pcb, -0.5, 0.15, -0.5));     // Blue Pill
    g.add(mesh(new THREE.BoxGeometry(0.6, 0.05, 0.6), mat.dark, -0.5, 0.2, -0.5));     // STM32F103
    g.add(mesh(new THREE.BoxGeometry(0.2, 0.2, 0.8), mat.pins, 0.7, 0.2, -0.5));       // SWD header
    g.add(mesh(new THREE.BoxGeometry(1, 0.05, 0.8), mat.pcb, 0.5, 0.15, 0.8));         // MPU6050 breakout
    g.add(mesh(new THREE.BoxGeometry(0.3, 0.05, 0.3), mat.dark, 0.5, 0.2, 0.8));       // MPU6050 chip
    return g;
  }

  const builders = { drone: quadcopter, satellite, rocket, slab: workbench };

  function create(name) {
    const g = (builders[name] || quadcopter)();
    g.rotation.order = "YXZ";
    return g;
  }

  function dispose(group) {
    group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
  }

  window.Models = { create, dispose };
})();
