import { ref, onMounted, watch } from 'vue'
import * as THREE from 'three'

export function usePathFinder(mainCanvas, miniMapCanvas, miniMapFog) {
  // --- Reactive State ---
  const fieldSize = ref(40)
  const patterns = ['lawnmower', 'spiral', 'random']
  const currentPattern = ref('lawnmower')
  const modes = ['auto', 'manual']
  const currentMode = ref('auto')
  const lidarRadius = ref(10)
  const lidarNumRays = ref(36)
  const lidarFov = ref(Math.PI / 3)
  const texturesEnabled = ref(false)
  const heatDetected = ref(false)
  const numHeatObjects = ref(3)
  const robotSpeed = ref(0.08)

  // NEW: Camera and advanced features
  const cameraMode = ref('first-person') // 'first-person' or 'third-person'
  const advancedHeatSearch = ref(false)
  const numObstacles = ref(3)
  const detectedHeatTypes = ref([])

  // Heat signature types
  const heatTypes = [
    { name: 'Human Body', color: 0xff4444, emissive: 0xff0000, temp: 37, size: 0.6 },
    { name: 'Vehicle Engine', color: 0xff8800, emissive: 0xff4400, temp: 85, size: 0.8 },
    { name: 'Electrical Equipment', color: 0xffff00, emissive: 0xffaa00, temp: 45, size: 0.4 },
    { name: 'Fire Source', color: 0xff0000, emissive: 0xff6600, temp: 200, size: 1.0 },
    { name: 'Animal', color: 0xff6666, emissive: 0xff3333, temp: 39, size: 0.5 },
  ]

  // --- Internal State ---
  let manualControl = { forward: false, backward: false, left: false, right: false }
  let robot = null
  let wallTexture, heatTexture, skyTexture, groundTexture
  let wallMeshes = []
  let heatMeshes = []
  let obstacleMeshes = []
  let mainScene = null
  let field = null
  let fogCtx = null
  let mainRenderer, mainCamera, miniRenderer, miniCamera, lidarGroup
  let animationId = null

  // Exploration state
  let exploring = true
  let mowDirection = 1
  let mowRow = 0
  let moveTarget = null
  let spiralState = null
  let randomWalkState = null
  let targetReached = false
  let seekingHeat = false
  let path = []
  let pathIndex = 0
  let avoidanceMode = false
  let avoidanceDirection = null

  // Optimized geometries
  let lidarPointGeometry = new THREE.SphereGeometry(0.05, 8, 8)
  let lidarPointMaterial = new THREE.MeshBasicMaterial({ color: 0x00ffff })

  // --- Toggle Functions ---
  function togglePattern() {
    const idx = patterns.indexOf(currentPattern.value)
    currentPattern.value = patterns[(idx + 1) % patterns.length]
    resetPatternStates()
  }
  function toggleMode() {
    const idx = modes.indexOf(currentMode.value)
    currentMode.value = modes[(idx + 1) % modes.length]
  }
  function toggleTextures() {
    texturesEnabled.value = !texturesEnabled.value
  }
  function toggleCameraMode() {
    cameraMode.value = cameraMode.value === 'first-person' ? 'third-person' : 'first-person'
  }
  function toggleAdvancedHeatSearch() {
    advancedHeatSearch.value = !advancedHeatSearch.value
  }

  // --- Reset Functions ---
  function resetPatternStates() {
    exploring = true
    mowDirection = 1
    mowRow = 0
    moveTarget = null
    spiralState = null
    randomWalkState = null
    seekingHeat = false
    targetReached = false
    path = []
    pathIndex = 0
    avoidanceMode = false
    avoidanceDirection = null
    detectedHeatTypes.value = []
  }

  function resetSimulation() {
    resetPatternStates()

    // Clear existing scene
    if (mainScene) {
      wallMeshes.forEach((w) => {
        mainScene.remove(w)
        w.geometry.dispose()
        w.material.dispose()
      })
      heatMeshes.forEach((h) => {
        mainScene.remove(h)
        h.geometry.dispose()
        h.material.dispose()
      })
      obstacleMeshes.forEach((o) => {
        mainScene.remove(o)
        o.geometry.dispose()
        o.material.dispose()
      })
      if (field) {
        mainScene.remove(field)
        field.geometry.dispose()
        field.material.dispose()
      }
      if (robot) {
        mainScene.remove(robot)
        robot.geometry.dispose()
        robot.material.dispose()
      }
      if (lidarGroup) mainScene.remove(lidarGroup)
    }
    wallMeshes = []
    heatMeshes = []
    obstacleMeshes = []

    // Reset fog
    if (fogCtx) {
      fogCtx.clearRect(0, 0, 300, 300)
      fogCtx.fillStyle = '#111'
      fogCtx.fillRect(0, 0, 300, 300)
    }

    setupScene()
    applyMaterials()
  }

  function increaseFieldSize() {
    fieldSize.value += 10
    resetSimulation()
  }

  function decreaseFieldSize() {
    if (fieldSize.value > 20) {
      fieldSize.value -= 10
      resetSimulation()
    }
  }

  function spawnMoreHeat() {
    heatMeshes.forEach((h) => {
      mainScene.remove(h)
      h.geometry.dispose()
      h.material.dispose()
    })
    heatMeshes = []

    for (let i = 0; i < numHeatObjects.value; i++) {
      spawnHeatSignature()
    }
  }

  function spawnMoreObstacles() {
    obstacleMeshes.forEach((o) => {
      mainScene.remove(o)
      o.geometry.dispose()
      o.material.dispose()
    })
    obstacleMeshes = []

    for (let i = 0; i < numObstacles.value; i++) {
      spawnObstacle()
    }
  }

  // --- Scene Setup ---
  function setupScene() {
    mainScene = new THREE.Scene()
    mainScene.background = new THREE.Color(0x222222)

    // Field
    const fieldGeometry = new THREE.PlaneGeometry(fieldSize.value, fieldSize.value)
    const fieldMaterial = new THREE.MeshPhongMaterial({ color: 0xffffff })
    field = new THREE.Mesh(fieldGeometry, fieldMaterial)
    field.rotation.x = -Math.PI / 2
    mainScene.add(field)

    // Walls
    const wallHeight = 2
    const wallThickness = 0.5
    const wallMaterial = new THREE.MeshPhongMaterial({ color: 0x444444 })
    const fs = fieldSize.value
    const walls = [
      new THREE.Mesh(new THREE.BoxGeometry(fs, wallHeight, wallThickness), wallMaterial),
      new THREE.Mesh(new THREE.BoxGeometry(fs, wallHeight, wallThickness), wallMaterial),
      new THREE.Mesh(new THREE.BoxGeometry(wallThickness, wallHeight, fs), wallMaterial),
      new THREE.Mesh(new THREE.BoxGeometry(wallThickness, wallHeight, fs), wallMaterial),
    ]
    walls[0].position.set(0, wallHeight / 2, -fs / 2)
    walls[1].position.set(0, wallHeight / 2, fs / 2)
    walls[2].position.set(fs / 2, wallHeight / 2, 0)
    walls[3].position.set(-fs / 2, wallHeight / 2, 0)
    walls.forEach((w) => {
      mainScene.add(w)
      wallMeshes.push(w)
    })

    // Lighting
    mainScene.add(new THREE.AmbientLight(0xffffff, 0.6))
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.6)
    dirLight.position.set(10, 20, 10)
    mainScene.add(dirLight)

    // Robot
    const robotGeometry = new THREE.BoxGeometry(1, 0.3, 1.5)
    const robotMaterial = new THREE.MeshPhongMaterial({ color: 0xff0000 })
    robot = new THREE.Mesh(robotGeometry, robotMaterial)
    const robotX = (Math.random() - 0.5) * (fs - 4)
    const robotZ = (Math.random() - 0.5) * (fs - 4)
    robot.position.set(robotX, 0.25, robotZ)
    robot.rotation.y = -Math.PI / 2
    mainScene.add(robot)

    // Obstacles
    for (let i = 0; i < numObstacles.value; i++) {
      spawnObstacle()
    }

    // Heat objects
    for (let i = 0; i < numHeatObjects.value; i++) {
      spawnHeatSignature()
    }

    // LiDAR group
    lidarGroup = new THREE.Group()
    mainScene.add(lidarGroup)

    // Update camera bounds
    if (miniCamera) {
      miniCamera.left = -fs / 2
      miniCamera.right = fs / 2
      miniCamera.top = fs / 2
      miniCamera.bottom = -fs / 2
      miniCamera.updateProjectionMatrix()
    }
  }

  // --- Obstacle Creation ---
  function spawnObstacle() {
    const obstacleTypes = [
      // Box obstacles
      () => new THREE.BoxGeometry(2 + Math.random() * 2, 1 + Math.random(), 2 + Math.random() * 2),
      // Cylinder obstacles
      () =>
        new THREE.CylinderGeometry(0.5 + Math.random(), 0.5 + Math.random(), 1 + Math.random(), 8),
      // Cone obstacles
      () => new THREE.ConeGeometry(1 + Math.random(), 2 + Math.random(), 8),
    ]

    const geometry = obstacleTypes[Math.floor(Math.random() * obstacleTypes.length)]()
    const material = new THREE.MeshPhongMaterial({ color: 0x666666 })
    const obstacle = new THREE.Mesh(geometry, material)

    const fs = fieldSize.value
    let x, z
    let validPosition = false
    let attempts = 0

    // Find valid position (not too close to robot or walls)
    while (!validPosition && attempts < 50) {
      x = (Math.random() - 0.5) * (fs - 8)
      z = (Math.random() - 0.5) * (fs - 8)

      const distToRobot = Math.hypot(x - robot.position.x, z - robot.position.z)
      const distToWall = Math.min(
        Math.abs(x + fs / 2),
        Math.abs(x - fs / 2),
        Math.abs(z + fs / 2),
        Math.abs(z - fs / 2),
      )

      if (distToRobot > 3 && distToWall > 3) {
        validPosition = true
      }
      attempts++
    }

    obstacle.position.set(x, geometry.parameters?.height / 2 || 1, z)
    obstacle.userData = { type: 'obstacle' }
    obstacleMeshes.push(obstacle)
    mainScene.add(obstacle)
  }

  // --- Heat Signature with Types ---
  function spawnHeatSignature() {
    const heatType = heatTypes[Math.floor(Math.random() * heatTypes.length)]
    const heatGeometry = new THREE.SphereGeometry(heatType.size, 32, 32)
    const heatMaterial = new THREE.MeshPhongMaterial({
      color: heatType.color,
      emissive: heatType.emissive,
    })
    const heat = new THREE.Mesh(heatGeometry, heatMaterial)

    const fs = fieldSize.value
    let x, z
    let validPosition = false
    let attempts = 0

    // Find valid position
    while (!validPosition && attempts < 50) {
      x = (Math.random() - 0.5) * (fs - 6)
      z = (Math.random() - 0.5) * (fs - 6)

      const distToRobot = Math.hypot(x - robot.position.x, z - robot.position.z)
      let tooCloseToObstacle = false

      for (const obstacle of obstacleMeshes) {
        if (Math.hypot(x - obstacle.position.x, z - obstacle.position.z) < 3) {
          tooCloseToObstacle = true
          break
        }
      }

      if (distToRobot > 2 && !tooCloseToObstacle) {
        validPosition = true
      }
      attempts++
    }

    heat.position.set(x, 0.5, z)
    heat.userData = {
      type: 'heat',
      heatType: heatType.name,
      temperature: heatType.temp,
    }
    heatMeshes.push(heat)
    mainScene.add(heat)
  }

  // --- Materials ---
  function applyMaterials() {
    wallMeshes.forEach((w) => {
      w.material.map = texturesEnabled.value ? wallTexture : null
      w.material.needsUpdate = true
    })
    heatMeshes.forEach((h) => {
      h.material.map = texturesEnabled.value ? heatTexture : null
      h.material.needsUpdate = true
    })
    if (field) {
      field.material.map = texturesEnabled.value ? groundTexture : null
      field.material.needsUpdate = true
    }
    if (mainScene) {
      mainScene.background =
        texturesEnabled.value && skyTexture ? skyTexture : new THREE.Color(0x222222)
    }
  }
  watch(texturesEnabled, applyMaterials)

  // --- Utility Functions ---
  function isWall(x, z) {
    const fs = fieldSize.value
    return x <= -fs / 2 + 0.5 || x >= fs / 2 - 0.5 || z <= -fs / 2 + 0.5 || z >= fs / 2 - 0.5
  }

  function isObstacle(x, z) {
    for (const obstacle of obstacleMeshes) {
      const dist = Math.hypot(x - obstacle.position.x, z - obstacle.position.z)
      if (dist < 1.5) return true
    }
    return false
  }

  function isBlocked(x, z) {
    return isWall(x, z) || isObstacle(x, z)
  }

  function worldToMiniMap(x, z) {
    const fs = fieldSize.value
    return [((x + fs / 2) / fs) * 300, ((z + fs / 2) / fs) * 300]
  }

  // --- Enhanced LiDAR Simulation ---
  function performLidarScan() {
    lidarGroup.clear()
    const fov = lidarFov.value
    const numRays = lidarNumRays.value
    const radius = lidarRadius.value
    const robotYaw = robot.rotation.y
    let heatFound = false
    let wallsDetected = 0
    let obstaclesDetected = 0
    const detectedHeats = new Set()

    for (let i = 0; i < numRays; i++) {
      const angle = robotYaw - fov / 2 + (i / (numRays - 1)) * fov
      let lastX = robot.position.x
      let lastZ = robot.position.z
      let hitObstacle = false
      let hitWall = false

      // Raycast
      for (let r = 0.1; r <= radius; r += 0.1) {
        const x = robot.position.x + Math.sin(angle) * r
        const z = robot.position.z + Math.cos(angle) * r

        if (isWall(x, z)) {
          hitWall = true
          wallsDetected++
          break
        }

        if (isObstacle(x, z)) {
          hitObstacle = true
          obstaclesDetected++

          // Advanced heat search can see through obstacles
          if (!advancedHeatSearch.value) {
            break
          }
        }

        // Clear fog
        const [rx, rz] = worldToMiniMap(x, z)
        fogCtx.save()
        fogCtx.globalCompositeOperation = 'destination-out'
        fogCtx.beginPath()
        fogCtx.arc(rx, rz, 8, 0, 2 * Math.PI)
        fogCtx.fill()
        fogCtx.restore()

        // Check for heat
        for (const heat of heatMeshes) {
          const heatDist = Math.hypot(x - heat.position.x, z - heat.position.z)
          if (heatDist < 1.2) {
            heatFound = true
            detectedHeats.add(heat.userData.heatType)

            // Enhanced heat detection - can see through obstacles if advanced mode
            if (advancedHeatSearch.value || !hitObstacle) {
              // Add heat signature visualization
              const heatPoint = new THREE.Mesh(
                new THREE.SphereGeometry(0.1, 8, 8),
                new THREE.MeshBasicMaterial({ color: 0xff0000 }),
              )
              heatPoint.position.set(heat.position.x, 0.2, heat.position.z)
              lidarGroup.add(heatPoint)
            }
          }
        }

        lastX = x
        lastZ = z
      }

      // Draw LiDAR point with different colors based on what was hit
      let pointColor = 0x00ffff // Default cyan
      if (hitWall)
        pointColor = 0xff0000 // Red for walls
      else if (hitObstacle) pointColor = 0xffff00 // Yellow for obstacles

      const pointMaterial = new THREE.MeshBasicMaterial({ color: pointColor })
      const point = new THREE.Mesh(lidarPointGeometry, pointMaterial)
      point.position.set(lastX, 0.1, lastZ)
      lidarGroup.add(point)
    }

    // Update detected heat types
    detectedHeatTypes.value = Array.from(detectedHeats)
    heatDetected.value = heatFound

    // Store detection info for AI decision making
    robot.lidarInfo = {
      wallsDetected,
      obstaclesDetected,
      heatDetected: heatFound,
      detectedHeatTypes: Array.from(detectedHeats),
    }

    return heatFound
  }

  // --- Enhanced Movement Patterns with Obstacle Avoidance ---
  function findAvoidanceDirection() {
    const testAngles = [
      robot.rotation.y + Math.PI / 4, // 45° right
      robot.rotation.y - Math.PI / 4, // 45° left
      robot.rotation.y + Math.PI / 2, // 90° right
      robot.rotation.y - Math.PI / 2, // 90° left
      robot.rotation.y + Math.PI, // 180° behind
    ]

    for (const angle of testAngles) {
      const testX = robot.position.x + Math.sin(angle) * 2
      const testZ = robot.position.z + Math.cos(angle) * 2

      if (!isBlocked(testX, testZ)) {
        return angle
      }
    }

    return robot.rotation.y + Math.PI // Default to turning around
  }

  function updateLawnmower() {
    const fs = fieldSize.value
    const minX = -fs / 2 + 1
    const maxX = fs / 2 - 1
    const minZ = -fs / 2 + 1
    const maxZ = fs / 2 - 1
    const spacing = 2

    // Check for obstacles ahead
    const frontX = robot.position.x + Math.sin(robot.rotation.y) * 1.5
    const frontZ = robot.position.z + Math.cos(robot.rotation.y) * 1.5

    if (isObstacle(frontX, frontZ) && !avoidanceMode) {
      avoidanceMode = true
      avoidanceDirection = findAvoidanceDirection()
      return
    }

    if (avoidanceMode) {
      robot.rotation.y = avoidanceDirection
      const avoidX = robot.position.x + Math.sin(avoidanceDirection) * robotSpeed.value
      const avoidZ = robot.position.z + Math.cos(avoidanceDirection) * robotSpeed.value

      if (!isBlocked(avoidX, avoidZ)) {
        robot.position.x = avoidX
        robot.position.z = avoidZ

        // Check if we can return to normal pattern
        const normalX = robot.position.x + Math.sin(0) * 2 // Forward direction
        const normalZ = robot.position.z + Math.cos(0) * 2
        if (!isObstacle(normalX, normalZ)) {
          avoidanceMode = false
          robot.rotation.y = 0
        }
      }
      return
    }

    // Normal lawnmower logic
    if (mowRow === 0 && Math.abs(robot.position.x - minX) > 0.1) {
      robot.rotation.y = -Math.PI / 2
      robot.position.x = Math.max(minX, robot.position.x - robotSpeed.value)
      return
    }

    if (mowRow === 0 && Math.abs(robot.position.x - minX) <= 0.1) {
      robot.rotation.y = 0
    }

    const targetX = minX + mowRow * spacing
    const nextZ = robot.position.z + mowDirection * robotSpeed.value

    if (isBlocked(robot.position.x, nextZ) || nextZ > maxZ || nextZ < minZ) {
      mowRow++
      if (targetX > maxX) {
        exploring = false
        return
      }
      mowDirection *= -1
      robot.rotation.y = targetX > robot.position.x ? Math.PI / 2 : -Math.PI / 2
      robot.position.x = targetX
      robot.position.z = mowDirection === 1 ? minZ : maxZ
    } else {
      robot.position.z = nextZ
      robot.rotation.y = mowDirection === 1 ? 0 : Math.PI
    }
  }

  function updateSpiral() {
    if (!spiralState) {
      spiralState = {
        angle: 0,
        radius: 1,
        center: { x: robot.position.x, z: robot.position.z },
        radiusGrowth: 0.03,
      }
    }

    spiralState.angle += 0.1
    spiralState.radius += spiralState.radiusGrowth

    const nextX = spiralState.center.x + Math.cos(spiralState.angle) * spiralState.radius
    const nextZ = spiralState.center.z + Math.sin(spiralState.angle) * spiralState.radius

    if (!isBlocked(nextX, nextZ)) {
      const dx = nextX - robot.position.x
      const dz = nextZ - robot.position.z
      robot.rotation.y = Math.atan2(dx, dz)

      robot.position.x = nextX
      robot.position.z = nextZ
    } else {
      // Enhanced obstacle handling - move away smartly
      const fs = fieldSize.value
      let awayX = 0,
        awayZ = 0

      if (robot.position.x >= fs / 2 - 2) awayX = -1
      if (robot.position.x <= -fs / 2 + 2) awayX = 1
      if (robot.position.z >= fs / 2 - 2) awayZ = -1
      if (robot.position.z <= -fs / 2 + 2) awayZ = 1

      // Check for nearby obstacles and move away from them
      for (const obstacle of obstacleMeshes) {
        const dx = robot.position.x - obstacle.position.x
        const dz = robot.position.z - obstacle.position.z
        const dist = Math.hypot(dx, dz)

        if (dist < 4) {
          awayX += dx / dist
          awayZ += dz / dist
        }
      }

      const moveDistance = robotSpeed.value * 3
      const newX = robot.position.x + awayX * moveDistance
      const newZ = robot.position.z + awayZ * moveDistance

      if (!isBlocked(newX, newZ)) {
        robot.position.x = newX
        robot.position.z = newZ
      }

      // Reset spiral with new center
      spiralState = {
        angle: 0,
        radius: 0.5,
        center: { x: robot.position.x, z: robot.position.z },
        radiusGrowth: 0.03,
      }

      if (awayX !== 0 || awayZ !== 0) {
        robot.rotation.y = Math.atan2(awayX, awayZ)
      }
    }
  }

  function updateRandom() {
    if (!randomWalkState || randomWalkState.steps <= 0) {
      randomWalkState = {
        angle: Math.random() * Math.PI * 2,
        steps: Math.floor(30 + Math.random() * 50),
      }
    }

    const nextX = robot.position.x + Math.sin(randomWalkState.angle) * robotSpeed.value
    const nextZ = robot.position.z + Math.cos(randomWalkState.angle) * robotSpeed.value

    if (!isBlocked(nextX, nextZ)) {
      robot.position.x = nextX
      robot.position.z = nextZ
      robot.rotation.y = randomWalkState.angle
      randomWalkState.steps--
    } else {
      // Find new direction when blocked
      randomWalkState.angle = findAvoidanceDirection()
      randomWalkState.steps = Math.floor(10 + Math.random() * 20)
    }
  }

  // --- Main Animation Loop ---
  function animate() {
    animationId = requestAnimationFrame(animate)

    if (currentMode.value === 'manual') {
      let angle = robot.rotation.y
      if (manualControl.left) angle -= 0.08
      if (manualControl.right) angle += 0.08
      robot.rotation.y = angle

      let dx = 0,
        dz = 0
      if (manualControl.forward) {
        dx += Math.sin(angle) * robotSpeed.value
        dz += Math.cos(angle) * robotSpeed.value
      }
      if (manualControl.backward) {
        dx -= Math.sin(angle) * robotSpeed.value
        dz -= Math.cos(angle) * robotSpeed.value
      }

      if (
        (manualControl.forward || manualControl.backward) &&
        !isBlocked(robot.position.x + dx, robot.position.z + dz)
      ) {
        robot.position.x += dx
        robot.position.z += dz
      }

      // Check for heat collection
      for (let i = 0; i < heatMeshes.length; i++) {
        const heat = heatMeshes[i]
        const dist = Math.hypot(
          robot.position.x - heat.position.x,
          robot.position.z - heat.position.z,
        )
        if (dist < 1.5) {
          mainScene.remove(heat)
          heat.geometry.dispose()
          heat.material.dispose()
          heatMeshes.splice(i, 1)
          spawnHeatSignature()
          break
        }
      }
    } else if (exploring) {
      if (currentPattern.value === 'lawnmower') {
        updateLawnmower()
      } else if (currentPattern.value === 'spiral') {
        updateSpiral()
      } else if (currentPattern.value === 'random') {
        updateRandom()
      }
    }

    performLidarScan()

    // Enhanced heat seeking with obstacle avoidance
    if (currentMode.value === 'auto' && heatDetected.value && !seekingHeat) {
      seekingHeat = true
      exploring = false
    }

    if (seekingHeat && heatMeshes.length > 0) {
      const closestHeat = heatMeshes.reduce((closest, heat) => {
        const dist = Math.hypot(
          robot.position.x - heat.position.x,
          robot.position.z - heat.position.z,
        )
        const closestDist = Math.hypot(
          robot.position.x - closest.position.x,
          robot.position.z - closest.position.z,
        )
        return dist < closestDist ? heat : closest
      })

      const direction = new THREE.Vector3(
        closestHeat.position.x - robot.position.x,
        0,
        closestHeat.position.z - robot.position.z,
      )
      const distance = direction.length()

      if (distance > 0.8) {
        direction.normalize()
        const nextX = robot.position.x + direction.x * robotSpeed.value * 1.5
        const nextZ = robot.position.z + direction.z * robotSpeed.value * 1.5

        if (!isBlocked(nextX, nextZ)) {
          robot.position.x = nextX
          robot.position.z = nextZ
          robot.rotation.y = Math.atan2(direction.x, direction.z)
        } else {
          // Navigate around obstacle
          const avoidAngle = findAvoidanceDirection()
          robot.rotation.y = avoidAngle
          const avoidX = robot.position.x + Math.sin(avoidAngle) * robotSpeed.value
          const avoidZ = robot.position.z + Math.cos(avoidAngle) * robotSpeed.value
          if (!isBlocked(avoidX, avoidZ)) {
            robot.position.x = avoidX
            robot.position.z = avoidZ
          }
        }
      } else {
        const heatIndex = heatMeshes.indexOf(closestHeat)
        mainScene.remove(closestHeat)
        closestHeat.geometry.dispose()
        closestHeat.material.dispose()
        heatMeshes.splice(heatIndex, 1)
        spawnHeatSignature()

        seekingHeat = false
        exploring = true
      }
    }

    renderCameras()
  }

  // --- Enhanced Rendering with Camera Modes ---
  function renderCameras() {
    if (!mainRenderer || !mainCamera || !miniRenderer || !miniCamera) return

    if (cameraMode.value === 'first-person') {
      // First-person camera
      const cameraOffset = new THREE.Vector3(0, 0.8, -0.2)
      const rotatedOffset = cameraOffset.clone().applyEuler(robot.rotation)
      mainCamera.position.copy(robot.position).add(rotatedOffset)

      const lookTarget = robot.position.clone()
      lookTarget.y += 0.3
      const forward = new THREE.Vector3(0, 0, 1).applyEuler(robot.rotation)
      lookTarget.add(forward.multiplyScalar(3))
      mainCamera.lookAt(lookTarget)
    } else {
      // Third-person camera
      const cameraOffset = new THREE.Vector3(0, 4, -6)
      const rotatedOffset = cameraOffset.clone().applyEuler(robot.rotation)
      mainCamera.position.copy(robot.position).add(rotatedOffset)

      const lookTarget = robot.position.clone()
      lookTarget.y += 0.5
      mainCamera.lookAt(lookTarget)
    }

    mainRenderer.render(mainScene, mainCamera)
    miniRenderer.render(mainScene, miniCamera)
  }

  // --- Vue Lifecycle ---
  onMounted(() => {
    // Setup fog
    fogCtx = miniMapFog.value.getContext('2d')
    miniMapFog.value.width = 300
    miniMapFog.value.height = 300
    fogCtx.fillStyle = '#111'
    fogCtx.fillRect(0, 0, 300, 300)

    // Load textures
    const textureLoader = new THREE.TextureLoader()
    wallTexture = textureLoader.load('/assets/wall.jpg', applyMaterials)
    heatTexture = textureLoader.load('/assets/heat.jpg', applyMaterials)
    skyTexture = textureLoader.load('/assets/sky.jpg', applyMaterials)
    groundTexture = textureLoader.load('/assets/ground.jpg', applyMaterials)

    // Setup scene
    setupScene()

    // Setup renderers
    mainRenderer = new THREE.WebGLRenderer({ canvas: mainCanvas.value, antialias: true })
    mainRenderer.setSize(window.innerWidth, window.innerHeight)
    mainRenderer.shadowMap.enabled = true
    mainRenderer.shadowMap.type = THREE.PCFSoftShadowMap

    mainCamera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000)

    miniRenderer = new THREE.WebGLRenderer({ canvas: miniMapCanvas.value })
    miniRenderer.setSize(300, 300)

    miniCamera = new THREE.OrthographicCamera(
      -fieldSize.value / 2,
      fieldSize.value / 2,
      fieldSize.value / 2,
      -fieldSize.value / 2,
      0.1,
      100,
    )
    miniCamera.position.set(0, 20, 0)
    miniCamera.lookAt(0, 0, 0)
    miniCamera.up.set(0, 0, -1)

    // Window resize handler
    window.addEventListener('resize', () => {
      mainRenderer.setSize(window.innerWidth, window.innerHeight)
      mainCamera.aspect = window.innerWidth / window.innerHeight
      mainCamera.updateProjectionMatrix()
    })

    // Keyboard controls
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
    texturesEnabled,
    toggleTextures,
    fieldSize,
    increaseFieldSize,
    decreaseFieldSize,
    resetSimulation,
    numHeatObjects,
    spawnMoreHeat,
    heatDetected,
    robotSpeed,
    manualControl,
    cameraMode,
    toggleCameraMode,
    advancedHeatSearch,
    toggleAdvancedHeatSearch,
    numObstacles,
    spawnMoreObstacles,
    detectedHeatTypes,
    heatTypes,
  }
}
