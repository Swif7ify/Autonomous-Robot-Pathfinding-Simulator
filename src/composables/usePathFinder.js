import { ref, onMounted, watch } from 'vue'
import * as THREE from 'three'

export function usePathFinder(mainCanvas, miniMapCanvas, miniMapFog) {
  // Patterns
  const patterns = ['lawnmower', 'spiral', 'random']
  const currentPattern = ref('lawnmower')
  const modes = ['auto', 'manual']
  const currentMode = ref('auto')

  function togglePattern() {
    const idx = patterns.indexOf(currentPattern.value)
    currentPattern.value = patterns[(idx + 1) % patterns.length]
    if (robot) robot.spiral = null 
  }
  function toggleMode() {
    const idx = modes.indexOf(currentMode.value)
    currentMode.value = modes[(idx + 1) % modes.length]
  }

  // Lidar settings
  const lidarRadius = ref(10)
  const lidarNumRays = ref(36)
  const lidarFov = ref(Math.PI / 3)

  // Texture toggle
  const texturesEnabled = ref(false)
  function toggleTextures() {
    texturesEnabled.value = !texturesEnabled.value
  }

  // Manual control state
  let manualControl = {
    forward: false,
    backward: false,
    left: false,
    right: false,
  }

  let robot = null

  // Texture loader
  let wallTexture, heatTexture, skyTexture, groundTexture
  let wallMeshes = []
  let heatMesh = null
  let mainScene = null
  let field = null 

  function applyMaterials() {
    // Walls
    wallMeshes.forEach((wall) => {
      wall.material.map = texturesEnabled.value ? wallTexture : null
      wall.material.needsUpdate = true
    })
    // Heat
    if (heatMesh) {
      heatMesh.material.map = texturesEnabled.value ? heatTexture : null
      heatMesh.material.needsUpdate = true
    }
    // Ground/Field
    if (field) {
      field.material.map = texturesEnabled.value ? groundTexture : null
      field.material.needsUpdate = true
    }
    // Sky
    if (mainScene) {
      if (texturesEnabled.value && skyTexture) {
        mainScene.background = skyTexture
      } else {
        mainScene.background = new THREE.Color(0x222222)
      }
    }
  }

  watch(texturesEnabled, () => {
    applyMaterials()
  })

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

    // Load textures
    const textureLoader = new THREE.TextureLoader()
    wallTexture = textureLoader.load('/assets/wall.jpg', applyMaterials)
    heatTexture = textureLoader.load('/assets/heat.jpg', applyMaterials)
    skyTexture = textureLoader.load('/assets/sky.jpg', applyMaterials)
    groundTexture = textureLoader.load('/assets/ground.jpg', applyMaterials)

    // Scene setup
    mainScene = new THREE.Scene()
    mainScene.background = new THREE.Color(0x222222)

    // Field
    const fieldGeometry = new THREE.PlaneGeometry(FIELD_SIZE, FIELD_SIZE)
    const fieldMaterial = new THREE.MeshPhongMaterial({ color: 0x228b22 })
    field = new THREE.Mesh(fieldGeometry, fieldMaterial)
    field.rotation.x = -Math.PI / 2
    mainScene.add(field)

    // Walls
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
    walls.forEach((wall) => {
      mainScene.add(wall)
      wallMeshes.push(wall)
    })

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6)
    mainScene.add(ambientLight)
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.6)
    dirLight.position.set(10, 20, 10)
    mainScene.add(dirLight)

    // Robot 
    const robotGeometry = new THREE.BoxGeometry(1, 0.3, 1.5)
    const robotMaterial = new THREE.MeshPhongMaterial({ color: 0xff0000 })
    robot = new THREE.Mesh(robotGeometry, robotMaterial)
    const robotX = (Math.random() - 0.5) * (FIELD_SIZE - 2)
    const robotZ = (Math.random() - 0.5) * (FIELD_SIZE - 2)
    robot.position.set(robotX, 0.25, robotZ)
    mainScene.add(robot)

    // "Thermal" target
    const heatGeometry = new THREE.SphereGeometry(0.5, 32, 32)
    const heatMaterial = new THREE.MeshPhongMaterial({ color: 0xffa500, emissive: 0xff6600 })
    let heat = new THREE.Mesh(heatGeometry, heatMaterial)
    heatMesh = heat
    mainScene.add(heat)

    function placeHeatSignature() {
      const x = (Math.random() - 0.5) * 16
      const z = (Math.random() - 0.5) * 16
      heat.position.set(x, 0.5, z)
    }
    placeHeatSignature()

    // Lidar points
    const lidarGroup = new THREE.Group()
    mainScene.add(lidarGroup)

    // Main Camera
    const mainRenderer = new THREE.WebGLRenderer({ canvas: mainCanvas.value })
    mainRenderer.setSize(window.innerWidth, window.innerHeight)
    const mainCamera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000,
    )
    window.addEventListener('resize', () => {
      mainRenderer.setSize(window.innerWidth, window.innerHeight)
      mainCamera.aspect = window.innerWidth / window.innerHeight
      mainCamera.updateProjectionMatrix()
    })

    // Minimap 
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

    // Check if fog is cleared
    function isFogCleared() {
      const fogData = miniMapFog.value.getContext('2d').getImageData(0, 0, 300, 300).data
      for (let i = 3; i < fogData.length; i += 4) {
        if (fogData[i] > 0) return false
      }
      return true
    }

    // Lawnmower exploration state
    let exploring = true
    let mowDirection = 1 
    let mowRow = 0
    const mowStep = 0.08
    const mowSpacing = 2

    // Smooth movement variables for lawmmower
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

    // Keyboard controls for manual mode
    window.addEventListener('keydown', (e) => {
      if (currentMode.value !== 'manual') return
      if (e.key === 'w' || e.key === 'ArrowUp') manualControl.forward = true
      if (e.key === 's' || e.key === 'ArrowDown') manualControl.backward = true
      if (e.key === 'a' || e.key === 'ArrowLeft') manualControl.left = true
      if (e.key === 'd' || e.key === 'ArrowRight') manualControl.right = true
    })
    window.addEventListener('keyup', (e) => {
      if (currentMode.value !== 'manual') return
      if (e.key === 'w' || e.key === 'ArrowUp') manualControl.forward = false
      if (e.key === 's' || e.key === 'ArrowDown') manualControl.backward = false
      if (e.key === 'a' || e.key === 'ArrowLeft') manualControl.left = false
      if (e.key === 'd' || e.key === 'ArrowRight') manualControl.right = false
    })

    function animate() {
      requestAnimationFrame(animate)

      // Manual mode movement
      if (currentMode.value === 'manual') {
        let move = false
        let angle = robot.rotation.y
        let moveStepManual = 0.12
        if (manualControl.left) angle -= 0.08
        if (manualControl.right) angle += 0.08
        robot.rotation.y = angle
        let dx = 0,
          dz = 0
        if (manualControl.forward) {
          dx += Math.sin(angle) * moveStepManual
          dz += Math.cos(angle) * moveStepManual
          move = true
        }
        if (manualControl.backward) {
          dx -= Math.sin(angle) * moveStepManual
          dz -= Math.cos(angle) * moveStepManual
          move = true
        }
        if (move) {
          const nextX = robot.position.x + dx
          const nextZ = robot.position.z + dz
          if (!isWall(nextX, nextZ)) {
            robot.position.x = nextX
            robot.position.z = nextZ
          }
        }
        // Manual mode: collect/interact with heat object 
        const distToHeat = Math.hypot(
          robot.position.x - heat.position.x,
          robot.position.z - heat.position.z,
        )
        if (distToHeat < 1.0) {
          placeHeatSignature()
          if (robot) robot.spiral = null
        }
      } else {
        // Smooth movement handler for lawmmower
        if (moveTarget) {
          const dx = moveTarget.x - robot.position.x
          const dz = moveTarget.z - robot.position.z
          const dist = Math.hypot(dx, dz)
          const isHorizontal = Math.abs(dx) > Math.abs(dz)
          if (isHorizontal) {
            robot.rotation.y = dx > 0 ? Math.PI / 2 : -Math.PI / 2
          } else {
            robot.rotation.y = dz > 0 ? 0 : Math.PI
          }
          if (dist > moveSpeed) {
            robot.position.x += (dx / dist) * moveSpeed
            robot.position.z += (dz / dist) * moveSpeed
            renderCameras()
            return
          } else {
            robot.position.x = moveTarget.x
            robot.position.z = moveTarget.z
            moveTarget = null
          }
        }
      }

      // Lidar simulation: forward-facing cone (ALWAYS RUN) 
      lidarGroup.clear()
      const fov = lidarFov.value
      const numRays = lidarNumRays.value
      const lidarRadiusValue = lidarRadius.value
      heatDetected = false

      const robotYaw = robot.rotation.y

      for (let i = 0; i < numRays; i++) {
        const angle = robotYaw - fov / 2 + (i / (numRays - 1)) * fov
        let hitWall = false
        let lastX = robot.position.x
        let lastZ = robot.position.z

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

        // Draw Lidar point at the last visible position
        const pointGeometry = new THREE.SphereGeometry(0.05, 8, 8)
        const pointMaterial = new THREE.MeshBasicMaterial({ color: 0x00ffff })
        const point = new THREE.Mesh(pointGeometry, pointMaterial)
        point.position.set(lastX, 0.1, lastZ)
        lidarGroup.add(point)

        // Heat detection logic
        const distToHeat = Math.hypot(lastX - heat.position.x, lastZ - heat.position.z)
        if (distToHeat < 0.6) {
          heatDetected = true
        }
      }

      // check if heat is inside the cone 
      const toHeat = new THREE.Vector3(
        heat.position.x - robot.position.x,
        0,
        heat.position.z - robot.position.z,
      )
      const distToHeat = toHeat.length()
      if (distToHeat < lidarRadiusValue) {
        const forward = new THREE.Vector3(Math.sin(robotYaw), 0, Math.cos(robotYaw))
        toHeat.normalize()
        const dot = forward.dot(toHeat)
        const clampedDot = Math.max(-1, Math.min(1, dot))
        const angleToHeat = Math.acos(clampedDot)
        if (angleToHeat < fov / 2) {
          heatDetected = true
        }
      }
      lidarAngle += 0.03

      // Only run pathfinding/exploration in auto mode
      if (currentMode.value !== 'manual') {
        // Move robot toward heat signature if detected ---
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
            if (robot) robot.spiral = null
          }
        } else if (heatDetected && !seekingHeat) {
          seekingHeat = true
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
              if (robot) robot.spiral = null
            }
          }
        } else if (exploring) {
          // Pattern selection
          if (currentPattern.value === 'lawnmower') {
            // Lawnmower (zigzag) 
            const minX = -FIELD_SIZE / 2 + 1
            const maxX = FIELD_SIZE / 2 - 1
            const minZ = -FIELD_SIZE / 2 + 1
            const maxZ = FIELD_SIZE / 2 - 1

            // Calculate target X for this row
            const targetX = minX + mowRow * mowSpacing

            if (mowRow === 0 && Math.abs(robot.position.x - minX) > 0.01) {
              robot.rotation.y = -Math.PI / 2
              moveTo(minX, robot.position.z)
              return
            }

            // Check if wall is directly ahead using Lidar
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
                exploring = false
              } else {
                mowDirection *= -1
                robot.rotation.y = targetX > robot.position.x ? Math.PI / 2 : -Math.PI / 2
                moveTo(targetX, mowDirection === 1 ? minZ : maxZ)
              }
            } else {
              robot.position.z = nextZ
              robot.rotation.y = mowDirection === 1 ? 0 : Math.PI
            }
          } else if (currentPattern.value === 'spiral') {
            // Spiral pattern 
            if (
              !robot.spiral ||
              !robot.spiral.center ||
              robot.spiralPatternReset !== currentPattern.value
            ) {
              robot.spiral = {
                angle: 0,
                radius: 2,
                center: { x: robot.position.x, z: robot.position.z },
                step: 0.08,
                grow: 0.02,
              }
              robot.spiralPatternReset = currentPattern.value
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
            // Random walk pattern 
            if (!robot.randomWalk || robot.randomWalk.steps <= 0) {
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
              robot.randomWalk.steps = 0
            }
          }
        }
      }

      renderCameras()
    }

    function renderCameras() {
      //First-person camera: attach to robot 
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

    applyMaterials()
    animate()
  })

  return {
    patterns,
    currentPattern,
    modes,
    currentMode,
    togglePattern,
    toggleMode,
    lidarRadius,
    lidarNumRays,
    lidarFov,
    manualControl,
    texturesEnabled,
    toggleTextures,
  }
}
