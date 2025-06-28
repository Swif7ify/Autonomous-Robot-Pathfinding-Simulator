<template>
  <div class="main-view">
    <div class="main-camera">
      <canvas ref="mainCanvas"></canvas>
    </div>
    <div class="minimap">
      <canvas ref="miniMapCanvas"></canvas>
      <canvas ref="miniMapFog" class="minimap-fog"></canvas>
    </div>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import * as THREE from 'three'

const mainCanvas = ref(null)
const miniMapCanvas = ref(null)
const miniMapFog = ref(null)

// Setup minimap fog canvas after DOM is ready
onMounted(() => {
  const fogCtx = miniMapFog.value.getContext('2d')
  miniMapFog.value.width = 300
  miniMapFog.value.height = 300
  fogCtx.fillStyle = '#111'
  fogCtx.fillRect(0, 0, 300, 300)

  const FIELD_SIZE = 40

  function worldToMiniMap(x, z) {
    // Converts world coordinates to minimap pixel coordinates
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
    // North wall
    new THREE.Mesh(new THREE.BoxGeometry(FIELD_SIZE, wallHeight, wallThickness), wallMaterial),
    // South wall
    new THREE.Mesh(new THREE.BoxGeometry(FIELD_SIZE, wallHeight, wallThickness), wallMaterial),
    // East wall
    new THREE.Mesh(new THREE.BoxGeometry(wallThickness, wallHeight, FIELD_SIZE), wallMaterial),
    // West wall
    new THREE.Mesh(new THREE.BoxGeometry(wallThickness, wallHeight, FIELD_SIZE), wallMaterial),
  ]

  // Position walls
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
  const robotGeometry = new THREE.BoxGeometry(1, 0.5, 2)
  const robotMaterial = new THREE.MeshPhongMaterial({ color: 0xff0000 })
  const robot = new THREE.Mesh(robotGeometry, robotMaterial)
  robot.position.set(0, 0.25, 0)
  mainScene.add(robot)

  // "Thermal" target (heat signature)
  const heatGeometry = new THREE.SphereGeometry(0.5, 32, 32)
  const heatMaterial = new THREE.MeshBasicMaterial({ color: 0xffa500, emissive: 0xff6600 })
  let heat = new THREE.Mesh(heatGeometry, heatMaterial)
  mainScene.add(heat)

  // Function to place heat signature at random location
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
  const miniCamera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 100)
  miniCamera.position.set(0, 20, 0)
  miniCamera.lookAt(0, 0, 0)
  miniCamera.up.set(0, 0, -1)

  // Pathfinder logic
  let targetReached = false
  const speed = 0.05
  let heatDetected = false
  let seekingHeat = false // Add this at the top with your other flags

  // --- Add these at the top of onMounted ---
  const GRID_SIZE = 40 // Number of cells per side
  const CELL_SIZE = FIELD_SIZE / GRID_SIZE
  let grid = Array.from({ length: GRID_SIZE }, () => Array(GRID_SIZE).fill(0)) // 0 = free, 1 = wall

  // Mark walls in grid
  for (let i = 0; i < GRID_SIZE; i++) {
    grid[0][i] = 1 // North
    grid[GRID_SIZE - 1][i] = 1 // South
    grid[i][0] = 1 // West
    grid[i][GRID_SIZE - 1] = 1 // East
  }

  // --- A* Pathfinding ---
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
      const current = open.shift()
      if (current.x === goal.x && current.y === goal.y) {
        // Reconstruct path
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
    return null // No path
  }

  // --- Helper: World <-> Grid ---
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

  // Animation loop

  let lidarAngle = 0
  let path = []
  let pathIndex = 0
  let scanAngle = 0
  let exploring = true
  let exploreMoveTimer = 0

  function animate() {
    requestAnimationFrame(animate)

    // --- LiDAR simulation: forward-facing cone ---
    lidarGroup.clear()
    const lidarRadius = 3
    heatDetected = false // Reset before LiDAR scan

    const fov = Math.PI / 3 // 60 degrees in radians
    const numRays = 36
    const robotYaw = robot.rotation.y

    for (let i = 0; i < numRays; i++) {
      // Angle for this ray, centered on robot's forward direction
      const angle = robotYaw - fov / 2 + (i / (numRays - 1)) * fov
      const x = robot.position.x + Math.sin(angle) * lidarRadius
      const z = robot.position.z + Math.cos(angle) * lidarRadius

      const pointGeometry = new THREE.SphereGeometry(0.05, 8, 8)
      const pointMaterial = new THREE.MeshBasicMaterial({ color: 0x00ffff })
      const point = new THREE.Mesh(pointGeometry, pointMaterial)
      point.position.set(x, 0.1, z)
      lidarGroup.add(point)

      const [mx, mz] = worldToMiniMap(x, z)
      fogCtx.save()
      fogCtx.globalCompositeOperation = 'destination-out'
      fogCtx.beginPath()
      fogCtx.arc(mx, mz, 10, 0, 2 * Math.PI)
      fogCtx.fill()
      fogCtx.restore()

      // --- Heat detection logic ---
      const distToHeat = Math.hypot(x - heat.position.x, z - heat.position.z)
      if (distToHeat < 0.6) {
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
    } else {
      // If not detected, rotate in place to scan
      robot.rotation.y += 0.03
    }

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

    // Draw the field of view cone and robot dot on the fog overlay (2D canvas)
    const overlayCtx = miniMapFog.value.getContext('2d')
    overlayCtx.clearRect(0, 0, 300, 300)

    // Robot position in minimap coordinates
    const [rx, rz] = worldToMiniMap(robot.position.x, robot.position.z)

    // Draw FOV cone
    overlayCtx.save()
    overlayCtx.translate(rx, rz)
    overlayCtx.rotate(-robot.rotation.y)
    overlayCtx.beginPath()
    overlayCtx.moveTo(0, 0)
    const lidarRadiusPx = (3 / FIELD_SIZE) * 300
    overlayCtx.arc(0, 0, lidarRadiusPx, -fov / 2, fov / 2)
    overlayCtx.closePath()
    overlayCtx.fillStyle = 'rgba(0, 255, 255, 0.15)'
    overlayCtx.fill()
    overlayCtx.restore()

    // Draw the robot as a dot
    overlayCtx.beginPath()
    overlayCtx.arc(rx, rz, 5, 0, 2 * Math.PI)
    overlayCtx.fillStyle = '#ff0000'
    overlayCtx.fill()
  }
  animate()
})
</script>

<style scoped>
.main-view {
  display: flex;
  gap: 20px;
}
.main-camera canvas {
  border: 2px solid #333;
}
.minimap {
  position: relative;
}
.minimap canvas {
  border: 2px solid #666;
}
.minimap-fog {
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: none;
}
</style>
