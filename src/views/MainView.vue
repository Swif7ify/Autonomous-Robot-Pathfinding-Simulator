<script setup>
import { onMounted, ref } from 'vue'
import * as THREE from 'three'

const mainCanvas = ref(null)
const miniMapCanvas = ref(null)
const miniMapFog = ref(null)

// --- Pattern toggle state ---
const patterns = ['lawnmower', 'spiral', 'random']
const currentPattern = ref('lawnmower')

function togglePattern() {
  const idx = patterns.indexOf(currentPattern.value)
  currentPattern.value = patterns[(idx + 1) % patterns.length]
}

// --- LiDAR settings ---
const lidarRadius = ref(10)
const lidarNumRays = ref(36)
const lidarFov = ref(Math.PI / 3) // 60 degrees in radians

onMounted(() => {
  const fogCtx = miniMapFog.value.getContext('2d')
  miniMapFog.value.width = 300
  miniMapFog.value.height = 300
  fogCtx.fillStyle = '#111'
  fogCtx.fillRect(0, 0, 300, 300)

  const FIELD_SIZE = 40

  function worldToMiniMap(x, z) {
    return [((x + FIELD_SIZE / 2) / FIELD_SIZE) * 300, ((z + FIELD_SIZE / 2) / FIELD_SIZE) * 300]
  }

  // Scene setup
  const mainScene = new THREE.Scene()
  mainScene.background = new THREE.Color(0x222222)

  // Field (plane)
  const fieldGeometry = new THREE.PlaneGeometry(FIELD_SIZE, FIELD_SIZE)
  const fieldMaterial = new THREE.MeshPhongMaterial({ color: 0x228b22 })
  const field = new THREE.Mesh(fieldGeometry, fieldMaterial)
  field.rotation.x = -Math.PI / 2
  mainScene.add(field)

  // Walls (simple boxes)
  const wallHeight = 2
  const wallThickness = 0.5
  const wallMaterial = new THREE.MeshPhongMaterial({ color: 0x444444 })

  const walls = [
    new THREE.Mesh(new THREE.BoxGeometry(FIELD_SIZE, wallHeight, wallThickness), wallMaterial),
    new THREE.Mesh(new THREE.BoxGeometry(FIELD_SIZE, wallHeight, wallThickness), wallMaterial),
    new THREE.Mesh(new THREE.BoxGeometry(wallThickness, wallHeight, FIELD_SIZE), wallMaterial),
    new THREE.Mesh(new THREE.BoxGeometry(wallThickness, wallHeight, FIELD_SIZE), wallMaterial),
  ]

  walls[0].position.set(0, wallHeight / 2, -FIELD_SIZE / 2) // North
  walls[1].position.set(0, wallHeight / 2, FIELD_SIZE / 2) // South
  walls[2].position.set(FIELD_SIZE / 2, wallHeight / 2, 0) // East
  walls[3].position.set(-FIELD_SIZE / 2, wallHeight / 2, 0) // West

  walls.forEach((wall) => mainScene.add(wall))

  // Lighting
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6)
  mainScene.add(ambientLight)
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.6)
  dirLight.position.set(10, 20, 10)
  mainScene.add(dirLight)

  // Robot (RC car)
  const robotGeometry = new THREE.BoxGeometry(1, 0.3, 1.5)
  const robotMaterial = new THREE.MeshPhongMaterial({ color: 0xff0000 })
  const robot = new THREE.Mesh(robotGeometry, robotMaterial)
  // Spawn robot at a random location within the field (avoid walls)
  const robotX = (Math.random() - 0.5) * (FIELD_SIZE - 2)
  const robotZ = (Math.random() - 0.5) * (FIELD_SIZE - 2)
  robot.position.set(robotX, 0.25, robotZ)
  mainScene.add(robot)

  // "Thermal" target (heat signature)
  const heatGeometry = new THREE.SphereGeometry(0.5, 32, 32)
  const heatMaterial = new THREE.MeshBasicMaterial({ color: 0xffa500, emissive: 0xff6600 })
  let heat = new THREE.Mesh(heatGeometry, heatMaterial)
  mainScene.add(heat)

  function placeHeatSignature() {
    const x = (Math.random() - 0.5) * 16
    const z = (Math.random() - 0.5) * 16
    heat.position.set(x, 0.5, z)
  }
  placeHeatSignature()

  // LiDAR points (simulate a rotating scan)
  const lidarGroup = new THREE.Group()
  mainScene.add(lidarGroup)

  // Main Camera (First-person)
  const mainRenderer = new THREE.WebGLRenderer({ canvas: mainCanvas.value })
  mainRenderer.setSize(800, 600)
  const mainCamera = new THREE.PerspectiveCamera(75, 800 / 600, 0.1, 1000)

  // Minimap (Top-down)
  const miniRenderer = new THREE.WebGLRenderer({ canvas: miniMapCanvas.value })
  miniRenderer.setSize(300, 300)
  const miniCamera = new THREE.OrthographicCamera(
    -FIELD_SIZE / 2,
    FIELD_SIZE / 2,
    FIELD_SIZE / 2,
    -FIELD_SIZE / 2,
    0.1,
    100,
  )
  miniCamera.position.set(0, 20, 0)
  miniCamera.lookAt(0, 0, 0)
  miniCamera.up.set(0, 0, -1)

  // Pathfinder logic
  let targetReached = false
  const speed = 0.05
  let heatDetected = false
  let seekingHeat = false

  // Grid for pathfinding
  const GRID_SIZE = 40
  const CELL_SIZE = FIELD_SIZE / GRID_SIZE
  let grid = Array.from({ length: GRID_SIZE }, () => Array(GRID_SIZE).fill(0))

  for (let i = 0; i < GRID_SIZE; i++) {
    grid[0][i] = 1
    grid[GRID_SIZE - 1][i] = 1
    grid[i][0] = 1
    grid[i][GRID_SIZE - 1] = 1
  }

  function heuristic(a, b) {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
  }
  function astar(start, goal, grid) {
    const open = [start]
    const cameFrom = {}
    const gScore = {}
    const fScore = {}
    const key = (p) => `${p.x},${p.y}`
    gScore[key(start)] = 0
    fScore[key(start)] = heuristic(start, goal)

    while (open.length) {
      open.sort((a, b) => fScore[key(a)] - fScore[key(b)])
      let current = open.shift()
      if (current.x === goal.x && current.y === goal.y) {
        let path = [current]
        while (cameFrom[key(current)]) {
          current = cameFrom[key(current)]
          path.push(current)
        }
        return path.reverse()
      }
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const neighbor = { x: current.x + dx, y: current.y + dy }
        if (
          neighbor.x < 0 ||
          neighbor.x >= GRID_SIZE ||
          neighbor.y < 0 ||
          neighbor.y >= GRID_SIZE ||
          grid[neighbor.y][neighbor.x] === 1
        )
          continue
        const tentative_gScore = gScore[key(current)] + 1
        if (tentative_gScore < (gScore[key(neighbor)] ?? Infinity)) {
          cameFrom[key(neighbor)] = current
          gScore[key(neighbor)] = tentative_gScore
          fScore[key(neighbor)] = tentative_gScore + heuristic(neighbor, goal)
          if (!open.some((n) => n.x === neighbor.x && n.y === neighbor.y)) {
            open.push(neighbor)
          }
        }
      }
    }
    return null
  }

  function worldToGrid(x, z) {
    return {
      x: Math.floor(((x + FIELD_SIZE / 2) / FIELD_SIZE) * GRID_SIZE),
      y: Math.floor(((z + FIELD_SIZE / 2) / FIELD_SIZE) * GRID_SIZE),
    }
  }
  function gridToWorld(x, y) {
    return {
      x: (x / GRID_SIZE) * FIELD_SIZE - FIELD_SIZE / 2 + CELL_SIZE / 2,
      z: (y / GRID_SIZE) * FIELD_SIZE - FIELD_SIZE / 2 + CELL_SIZE / 2,
    }
  }

  // --- Check if fog is cleared ---
  function isFogCleared() {
    const fogData = miniMapFog.value.getContext('2d').getImageData(0, 0, 300, 300).data
    for (let i = 3; i < fogData.length; i += 4) {
      if (fogData[i] > 0) return false
    }
    return true
  }

  // Lawnmower exploration state
  let exploring = true
  let mowDirection = 1 // 1 = forward, -1 = backward
  let mowRow = 0
  const mowStep = 0.08
  const mowSpacing = 2

  // --- Smooth movement variables for lawmmower ---
  let moveTarget = null
  const moveSpeed = 0.12

  function moveTo(x, z) {
    moveTarget = { x, z }
  }

  // Animation loop

  function isWall(x, z) {
    // Convert to grid
    const gx = Math.floor(((x + FIELD_SIZE / 2) / FIELD_SIZE) * GRID_SIZE)
    const gz = Math.floor(((z + FIELD_SIZE / 2) / FIELD_SIZE) * GRID_SIZE)
    // Out of bounds is wall
    if (gx < 0 || gx >= GRID_SIZE || gz < 0 || gz >= GRID_SIZE) return true
    return grid[gz][gx] === 1
  }

  let lidarAngle = 0
  let path = []
  let pathIndex = 0

  function animate() {
    requestAnimationFrame(animate)

    // --- Smooth movement handler for lawmmower ---
    if (moveTarget) {
      const dx = moveTarget.x - robot.position.x
      const dz = moveTarget.z - robot.position.z
      const dist = Math.hypot(dx, dz)
      if (dist > moveSpeed) {
        const angle = Math.atan2(dx, dz)
        robot.rotation.y = angle
        robot.position.x += Math.sin(angle) * moveSpeed
        robot.position.z += Math.cos(angle) * moveSpeed
        // Only move, skip rest of logic until done
        renderCameras()
        return
      } else {
        robot.position.x = moveTarget.x
        robot.position.z = moveTarget.z
        moveTarget = null
      }
    }

    // --- LiDAR simulation: forward-facing cone ---
    lidarGroup.clear()
    const fov = lidarFov.value
    const numRays = lidarNumRays.value
    const lidarRadiusValue = lidarRadius.value
    heatDetected = false // Reset before LiDAR scan

    const robotYaw = robot.rotation.y

    for (let i = 0; i < numRays; i++) {
      const angle = robotYaw - fov / 2 + (i / (numRays - 1)) * fov
      let hitWall = false
      let lastX = robot.position.x
      let lastZ = robot.position.z

      // Step along the ray in small increments
      for (let r = 0; r <= lidarRadiusValue; r += 0.1) {
        const x = robot.position.x + Math.sin(angle) * r
        const z = robot.position.z + Math.cos(angle) * r

        if (isWall(x, z)) {
          hitWall = true
          break
        }

        // Draw fog clearing at this point
        const [rx, rz] = worldToMiniMap(x, z)
        fogCtx.save()
        fogCtx.globalCompositeOperation = 'destination-out'
        fogCtx.beginPath()
        fogCtx.arc(rx, rz, 10, 0, 2 * Math.PI)
        fogCtx.fill()
        fogCtx.restore()

        lastX = x
        lastZ = z
      }

      // Draw the LiDAR point at the last visible position
      const pointGeometry = new THREE.SphereGeometry(0.05, 8, 8)
      const pointMaterial = new THREE.MeshBasicMaterial({ color: 0x00ffff })
      const point = new THREE.Mesh(pointGeometry, pointMaterial)
      point.position.set(lastX, 0.1, lastZ)
      lidarGroup.add(point)

      // --- Heat detection logic ---
      const distToHeat = Math.hypot(lastX - heat.position.x, lastZ - heat.position.z)
      if (distToHeat < 0.6) {
        heatDetected = true
      }
    }

    // --- Improved heat detection: check if heat is inside the cone ---
    const toHeat = new THREE.Vector3(
      heat.position.x - robot.position.x,
      0,
      heat.position.z - robot.position.z,
    )
    const distToHeat = toHeat.length()
    if (distToHeat < lidarRadiusValue) {
      // Robot's forward vector
      const forward = new THREE.Vector3(Math.sin(robotYaw), 0, Math.cos(robotYaw))
      toHeat.normalize()
      const dot = forward.dot(toHeat)
      // Clamp dot to avoid NaN from acos
      const clampedDot = Math.max(-1, Math.min(1, dot))
      const angleToHeat = Math.acos(clampedDot)
      if (angleToHeat < fov / 2) {
        heatDetected = true
      }
    }
    lidarAngle += 0.03

    // --- Pathfinding: Move robot toward heat signature if detected ---
    if (heatDetected) {
      seekingHeat = true // Start seeking if detected
    }

    if (seekingHeat) {
      const target = new THREE.Vector3(heat.position.x, robot.position.y, heat.position.z)
      const direction = target.clone().sub(robot.position)
      const distance = direction.length()

      if (distance > 0.1) {
        direction.normalize()
        robot.position.add(direction.multiplyScalar(speed))
        // Rotate robot to face target
        const angle = Math.atan2(target.x - robot.position.x, target.z - robot.position.z)
        robot.rotation.y = angle
        targetReached = false
      } else if (!targetReached) {
        placeHeatSignature()
        targetReached = true
        seekingHeat = false // Reset seeking for new target
        heatDetected = false
      }
    } else if (heatDetected && !seekingHeat) {
      seekingHeat = true
      // Compute path using A*
      const start = worldToGrid(robot.position.x, robot.position.z)
      const goal = worldToGrid(heat.position.x, heat.position.z)
      path = astar(start, goal, grid) || []
      pathIndex = 0
    } else if (seekingHeat && path.length > 0 && pathIndex < path.length) {
      const wp = gridToWorld(path[pathIndex].x, path[pathIndex].y)
      const target = new THREE.Vector3(wp.x, robot.position.y, wp.z)
      const direction = target.clone().sub(robot.position)
      const distance = direction.length()
      if (distance > 0.1) {
        direction.normalize()
        robot.position.add(direction.multiplyScalar(speed))
        // Rotate robot to face waypoint
        const angle = Math.atan2(target.x - robot.position.x, target.z - robot.position.z)
        robot.rotation.y = angle
        targetReached = false
      } else {
        pathIndex++
        if (pathIndex >= path.length) {
          placeHeatSignature()
          targetReached = true
          seekingHeat = false
          heatDetected = false
          path = []
        }
      }
    } else if (exploring) {
      // --- Pattern selection ---
      if (currentPattern.value === 'lawnmower') {
        // --- Lawnmower (zigzag) pattern for exploration ---
        const minX = -FIELD_SIZE / 2 + 1
        const maxX = FIELD_SIZE / 2 - 1
        const minZ = -FIELD_SIZE / 2 + 1
        const maxZ = FIELD_SIZE / 2 - 1

        // Calculate target X for this row
        const targetX = minX + mowRow * mowSpacing

        // Check if wall is directly ahead
        const nextZ = robot.position.z + mowDirection * mowStep
        const nextX = robot.position.x
        const wallAhead = isWall(nextX, nextZ)

        if (
          wallAhead ||
          (mowDirection === 1 && nextZ > maxZ) ||
          (mowDirection === -1 && nextZ < minZ)
        ) {
          mowRow++
          if (targetX > maxX) {
            exploring = false // Finished all rows
          } else {
            mowDirection *= -1
            moveTo(targetX, mowDirection === 1 ? minZ : maxZ)
          }
        } else {
          robot.position.z = nextZ
        }
        robot.rotation.y = mowDirection === 1 ? 0 : Math.PI
      } else if (currentPattern.value === 'spiral') {
        // --- Spiral pattern ---
        if (!robot.spiral) {
          // Initialize spiral state
          robot.spiral = {
            angle: 0,
            radius: 2,
            center: { x: 0, z: 0 },
            step: 0.08,
            grow: 0.02,
          }
        }
        const s = robot.spiral
        s.angle += 0.08
        s.radius += s.grow / (2 * Math.PI)
        const prevX = robot.position.x
        const prevZ = robot.position.z
        const nextX = s.center.x + Math.cos(s.angle) * s.radius
        const nextZ = s.center.z + Math.sin(s.angle) * s.radius
        if (!isWall(nextX, nextZ)) {
          robot.rotation.y = Math.atan2(nextX - prevX, nextZ - prevZ)
          robot.position.x = nextX
          robot.position.z = nextZ
        } else {
          exploring = false
        }
      } else if (currentPattern.value === 'random') {
        // --- Random walk pattern ---
        if (!robot.randomWalk || robot.randomWalk.steps <= 0) {
          // Pick a new random direction
          const angle = Math.random() * Math.PI * 2
          robot.randomWalk = {
            angle,
            steps: Math.floor(20 + Math.random() * 40),
          }
        }
        const rw = robot.randomWalk
        const nextX = robot.position.x + Math.sin(rw.angle) * mowStep
        const nextZ = robot.position.z + Math.cos(rw.angle) * mowStep
        if (!isWall(nextX, nextZ)) {
          robot.position.x = nextX
          robot.position.z = nextZ
          robot.rotation.y = rw.angle
          rw.steps--
        } else {
          // Pick a new direction if hit wall
          robot.randomWalk.steps = 0
        }
      }
    } else {
      // Idle: stop moving
    }

    // --- Stop exploring if fog is cleared ---
    if (exploring && isFogCleared()) {
      exploring = false
    }

    renderCameras()
  }

  function renderCameras() {
    // --- First-person camera: attach to robot ---
    const cameraOffset = new THREE.Vector3(0, 0.4, 0)
    const lookDistance = 2
    const forward = new THREE.Vector3(0, 0, 1).applyEuler(robot.rotation).normalize()
    const cameraPosition = robot.position.clone().add(cameraOffset)
    const lookAtPosition = cameraPosition.clone().add(forward.multiplyScalar(lookDistance))

    mainCamera.position.copy(cameraPosition)
    mainCamera.lookAt(lookAtPosition)

    mainRenderer.render(mainScene, mainCamera)
    miniRenderer.render(mainScene, miniCamera)
  }

  animate()
})
</script>

<template>
  <div class="main-view">
    <div class="pattern-toggle">
      <button @click="togglePattern">Pattern: {{ currentPattern }}</button>
    </div>
    <div class="settings-panel">
      <label>
        LiDAR Radius:
        <input type="range" min="2" max="20" step="0.1" v-model.number="lidarRadius" />
        {{ lidarRadius }}
      </label>
      <label>
        LiDAR Rays:
        <input type="range" min="8" max="72" step="1" v-model.number="lidarNumRays" />
        {{ lidarNumRays }}
      </label>
      <label>
        LiDAR FOV:
        <input type="range" min="0.2" max="3.14" step="0.01" v-model.number="lidarFov" />
        {{ ((lidarFov * 180) / Math.PI).toFixed(0) }}°
      </label>
    </div>
    <div class="main-camera">
      <canvas ref="mainCanvas"></canvas>
    </div>
    <div class="minimap">
      <canvas ref="miniMapCanvas"></canvas>
      <canvas ref="miniMapFog" class="minimap-fog"></canvas>
    </div>
  </div>
</template>

<style scoped>
.main-view {
  display: flex;
  gap: 20px;
  position: relative;
  width: 100dvw;
  height: 100dvh;
}

.pattern-toggle {
  position: absolute;
  left: 20px;
  top: 20px;
  z-index: 10;
}
.pattern-toggle button {
  font-size: 1rem;
  padding: 0.5em 1em;
  border-radius: 6px;
  border: none;
  background: #333;
  color: #fff;
  cursor: pointer;
}

.settings-panel {
  position: absolute;
  left: 20px;
  top: 70px;
  z-index: 10;
  background: #222;
  color: #fff;
  padding: 1em;
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  gap: 0.5em;
}
.settings-panel label {
  display: flex;
  align-items: center;
  gap: 0.5em;
  font-size: 0.95em;
}
.settings-panel input[type='range'] {
  flex: 1;
}

.minimap {
  position: relative;
}
.minimap canvas {
  position: absolute;
}
.minimap-fog {
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: none;
}
</style>
