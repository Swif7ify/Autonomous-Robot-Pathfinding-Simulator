import { ref, onMounted, watch } from 'vue'
import * as THREE from 'three'

export function usePathFinder(mainCanvas, miniMapCanvas, miniMapFog) {
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
  const numHeatObjects = ref(0)
  const robotSpeed = ref(0.08)

  let manualControl = { forward: false, backward: false, left: false, right: false }
  let robot = null
  let wallTexture, heatTexture, skyTexture, groundTexture
  let wallMeshes = []
  let heatMeshes = []
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

  let lidarPointGeometry = new THREE.SphereGeometry(0.05, 8, 8)
  let lidarPointMaterial = new THREE.MeshBasicMaterial({ color: 0x00ffff })

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
  }

  function resetSimulation() {
    resetPatternStates()

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
    // Remove existing heat objects
    heatMeshes.forEach((h) => {
      mainScene.remove(h)
      h.geometry.dispose()
      h.material.dispose()
    })
    heatMeshes = []

    // Spawn new ones
    for (let i = 0; i < numHeatObjects.value; i++) {
      spawnHeatSignature()
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

  // --- Heat Signature ---
  function spawnHeatSignature() {
    const heatGeometry = new THREE.SphereGeometry(0.5, 32, 32)
    const heatMaterial = new THREE.MeshPhongMaterial({ color: 0xffa500, emissive: 0xff6600 })
    const heat = new THREE.Mesh(heatGeometry, heatMaterial)
    const fs = fieldSize.value
    const x = (Math.random() - 0.5) * (fs - 6)
    const z = (Math.random() - 0.5) * (fs - 6)
    heat.position.set(x, 0.5, z)
    heatMeshes.push(heat)
    mainScene.add(heat)
  }

  function placeHeatSignature() {
    // Move existing heat to new position
    if (heatMeshes.length > 0) {
      const heat = heatMeshes[0]
      const fs = fieldSize.value
      const x = (Math.random() - 0.5) * (fs - 6)
      const z = (Math.random() - 0.5) * (fs - 6)
      heat.position.set(x, 0.5, z)
    }
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

  function worldToMiniMap(x, z) {
    const fs = fieldSize.value
    return [((x + fs / 2) / fs) * 300, ((z + fs / 2) / fs) * 300]
  }

  // --- LiDAR Simulation ---
  function performLidarScan() {
    lidarGroup.clear()
    const fov = lidarFov.value
    const numRays = lidarNumRays.value
    const radius = lidarRadius.value
    const robotYaw = robot.rotation.y
    let heatFound = false

    for (let i = 0; i < numRays; i++) {
      const angle = robotYaw - fov / 2 + (i / (numRays - 1)) * fov
      let lastX = robot.position.x
      let lastZ = robot.position.z

      // Raycast
      for (let r = 0.1; r <= radius; r += 0.1) {
        const x = robot.position.x + Math.sin(angle) * r
        const z = robot.position.z + Math.cos(angle) * r

        if (isWall(x, z)) break

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
          if (Math.hypot(x - heat.position.x, z - heat.position.z) < 1.2) {
            heatFound = true
          }
        }

        lastX = x
        lastZ = z
      }

      // Draw LiDAR point
      const point = new THREE.Mesh(lidarPointGeometry, lidarPointMaterial)
      point.position.set(lastX, 0.1, lastZ)
      lidarGroup.add(point)
    }

    heatDetected.value = heatFound
    return heatFound
  }

  // --- Movement Patterns ---
  function updateLawnmower() {
    const fs = fieldSize.value
    const minX = -fs / 2 + 1
    const maxX = fs / 2 - 1
    const minZ = -fs / 2 + 1
    const maxZ = fs / 2 - 1
    const spacing = 2

    if (mowRow === 0 && Math.abs(robot.position.x - minX) > 0.1) {
      robot.rotation.y = -Math.PI / 2 // Face left
      robot.position.x = Math.max(minX, robot.position.x - robotSpeed.value)
      return
    }

    if (mowRow === 0 && Math.abs(robot.position.x - minX) <= 0.1) {
      robot.rotation.y = 0 // Face down
    }

    const targetX = minX + mowRow * spacing
    const nextZ = robot.position.z + mowDirection * robotSpeed.value

    if (isWall(robot.position.x, nextZ) || nextZ > maxZ || nextZ < minZ) {
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

    if (!isWall(nextX, nextZ)) {
      const dx = nextX - robot.position.x
      const dz = nextZ - robot.position.z
      robot.rotation.y = Math.atan2(dx, dz)

      robot.position.x = nextX
      robot.position.z = nextZ
    } else {
      const fs = fieldSize.value

      let awayX = 0,
        awayZ = 0

      if (robot.position.x >= fs / 2 - 1) awayX = -1 // Too far right, move left
      if (robot.position.x <= -fs / 2 + 1) awayX = 1 // Too far left, move right
      if (robot.position.z >= fs / 2 - 1) awayZ = -1 // Too far forward, move back
      if (robot.position.z <= -fs / 2 + 1) awayZ = 1 // Too far back, move forward

      robot.position.x += awayX * robotSpeed.value * 2
      robot.position.z += awayZ * robotSpeed.value * 2

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

    if (!isWall(nextX, nextZ)) {
      robot.position.x = nextX
      robot.position.z = nextZ
      robot.rotation.y = randomWalkState.angle
      randomWalkState.steps--
    } else {
      randomWalkState.steps = 0 // Pick new direction
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
        !isWall(robot.position.x + dx, robot.position.z + dz)
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
      // Auto mode patterns
      if (currentPattern.value === 'lawnmower') {
        updateLawnmower()
      } else if (currentPattern.value === 'spiral') {
        updateSpiral()
      } else if (currentPattern.value === 'random') {
        updateRandom()
      }
    }

    performLidarScan()

    // Heat seeking behavior in auto mode
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
        robot.position.add(direction.multiplyScalar(robotSpeed.value * 1.5))
        robot.rotation.y = Math.atan2(direction.x, direction.z)
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

  // --- Rendering ---
  function renderCameras() {
    if (!mainRenderer || !mainCamera || !miniRenderer || !miniCamera) return

    // First-person camera
    const cameraOffset = new THREE.Vector3(0, 0.8, -2)
    const rotatedOffset = cameraOffset.clone().applyEuler(robot.rotation)
    mainCamera.position.copy(robot.position).add(rotatedOffset)

    const lookTarget = robot.position.clone()
    lookTarget.y += 0.3
    const forward = new THREE.Vector3(0, 0, 1).applyEuler(robot.rotation)
    lookTarget.add(forward.multiplyScalar(2))
    mainCamera.lookAt(lookTarget)

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
  }
}
