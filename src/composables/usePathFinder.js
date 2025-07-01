import { ref, onMounted, watch } from "vue";
import * as THREE from "three";

export function usePathFinder(mainCanvas, miniMapCanvas, miniMapFog) {
	// State and config
	const fieldSize = ref(40);
	const patterns = [
		"search-grid",
		"spiral-search",
		"perimeter-sweep",
		"random-patrol",
	];
	const currentPattern = ref("search-grid");
	const modes = ["auto", "manual", "search-rescue"];
	const currentMode = ref("auto");
	const lidarRadius = ref(7);
	const lidarNumRays = ref(50);
	const lidarFov = ref(Math.PI / 3);
	const texturesEnabled = ref(false);
	const heatDetected = ref(false);
	const numHeatObjects = ref(4);
	const robotSpeed = ref(0.15);
	const cameraMode = ref("first-person");
	const advancedHeatSearch = ref(false);
	const numObstacles = ref(4);
	const detectedHeatTypes = ref([]);
	const missionStatus = ref("SEARCHING");
	const targetsFound = ref(0);
	const areaSearched = ref(0);

	// Heat object types
	const heatTypes = [
		{
			name: "Human Survivor",
			color: 0xff1111,
			emissive: 0xff0000,
			temp: 37,
			size: 0.8,
			priority: 1,
		},
		{
			name: "Injured Animal",
			color: 0xff6666,
			emissive: 0xff3333,
			temp: 39,
			size: 0.6,
			priority: 2,
		},
		{
			name: "Fire Source",
			color: 0xff0000,
			emissive: 0xff6600,
			temp: 200,
			size: 1.0,
			priority: null,
		},
		{
			name: "Vehicle Heat",
			color: 0xff8800,
			emissive: 0xff4400,
			temp: 85,
			size: 0.9,
			priority: null,
		},
		{
			name: "Electronic Device",
			color: 0xffff00,
			emissive: 0xffaa00,
			temp: 45,
			size: 0.5,
			priority: null,
		},
	];

	// Control and scene objects
	let manualControl = {
		forward: false,
		backward: false,
		left: false,
		right: false,
	};
	let robot = null;
	let wallTexture, heatTexture, skyTexture, groundTexture;
	let wallMeshes = [];
	let heatMeshes = [];
	let obstacleMeshes = [];
	let mainScene = null;
	let field = null;
	let fogCtx = null;
	let mainRenderer, mainCamera, miniRenderer, miniCamera, lidarGroup;
	let animationId = null;

	// Navigation and search state
	let exploring = true;
	let mowDirection = 1;
	let mowRow = 0;
	let spiralState = null;
	let randomWalkState = null;
	let seekingHeat = false;
	let avoidanceMode = false;
	let avoidanceDirection = null;
	let avoidanceTimer = 0;
	let currentTarget = null;
	let searchGrid = [];
	let currentGridIndex = 0;
	let lastPosition = { x: 0, z: 0 };
	let stuckTimer = 0;
	let emergencyManeuver = false;
	let modeSpecificSpeed = 1;
	let heatScanIntensity = 1;
	let explorationPriority = "thorough";
	let priorityTarget = null;
	let targetLockOn = false;
	let heatDetectionRange = 20;
	let lastHeatScanTime = 0;
	let rotationSearchMode = false;
	let rotationTarget = 0;
	let noPathTimer = 0;
	let lastRotationTime = 0;
	let gridSearchState = {
		currentRow: 0,
		currentCol: 0,
		direction: "right",
		gridSize: 4,
		rowCompleted: false,
	};
	let perimeterState = {
		phase: "outer",
		currentSide: 0,
		progress: 0,
		radius: 18,
	};

	// Geometry/materials for rendering
	let lidarPointGeometry = new THREE.SphereGeometry(0.06, 8, 8);
	let heatPointGeometry = new THREE.SphereGeometry(0.12, 8, 8);
	let lidarPointMaterial = new THREE.MeshBasicMaterial({ color: 0x00ffff });
	let wallPointMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 });
	let obstaclePointMaterial = new THREE.MeshBasicMaterial({
		color: 0xffff00,
	});
	let heatPointMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 });
	let priorityHeatMaterial = new THREE.MeshBasicMaterial({ color: 0xff00ff });

	// Timers and cooldowns
	let heatDetectionCooldown = 0;
	let lastHeatDetectionTime = 0;

	// Movement targets
	let targetPosition = { x: 0, z: 0 };
	let targetRotation = 0;
	let smoothingFactor = 0.25;

	// LiDAR scan data
	let lidarData = {
		clearDirections: [],
		blockedDirections: [],
		heatDirections: [],
		emergencyExits: [],
		bestPaths: [],
		humanDetections: [],
	};

	// Mission plan
	let missionData = {
		searchPattern: null,
		waypoints: [],
		currentWaypoint: 0,
		priority: "search",
		rescueTargets: [],
		completedAreas: new Set(),
	};

	// Fog clearing
	let fogClearingRadius = 15;
	let lastFogClearTime = 0;

	// Toggle Functions
	function togglePattern() {
		const idx = patterns.indexOf(currentPattern.value);
		currentPattern.value = patterns[(idx + 1) % patterns.length];
		resetPatternStates();
		generateMissionPlan();
	}

	function toggleMode() {
		const idx = modes.indexOf(currentMode.value);
		currentMode.value = modes[(idx + 1) % modes.length];

		// Set mode-specific behaviors
		if (currentMode.value === "manual") {
			seekingHeat = false;
			exploring = false;
			avoidanceMode = false;
			emergencyManeuver = false;
			targetLockOn = false;
			priorityTarget = null;
			rotationSearchMode = false;
			missionStatus.value = "MANUAL CONTROL";
		} else if (currentMode.value === "auto") {
			// AUTO MODE
			exploring = true;
			modeSpecificSpeed = 1;
			heatScanIntensity = 1;
			explorationPriority = "thorough";
			fogClearingRadius = 15;
			robotSpeed.value = 0.15;
			missionStatus.value = "AUTO MODE - SYSTEMATIC EXPLORATION";
		} else if (currentMode.value === "search-rescue") {
			// SEARCH-RESCUE MODE
			exploring = true;
			modeSpecificSpeed = 2;
			heatScanIntensity = 3;
			explorationPriority = "fast";
			heatDetectionRange = 30; // Much increased range
			fogClearingRadius = 25; // Larger fog clearing
			robotSpeed.value = 0.25; // Faster base speed
			missionStatus.value =
				"SEARCH-RESCUE MODE - PRIORITY HEAT DETECTION";
		}

		generateMissionPlan();
	}

	function toggleTextures() {
		texturesEnabled.value = !texturesEnabled.value;
	}

	function toggleCameraMode() {
		cameraMode.value =
			cameraMode.value === "first-person"
				? "third-person"
				: "first-person";
	}

	function toggleAdvancedHeatSearch() {
		advancedHeatSearch.value = !advancedHeatSearch.value;
	}

	// Pattern-specific mission generation
	function generateMissionPlan() {
		const fs = fieldSize.value;
		missionData.waypoints = [];
		searchGrid = [];

		// Reset pattern states
		gridSearchState = {
			currentRow: 0,
			currentCol: 0,
			direction: "right",
			gridSize: currentMode.value === "search-rescue" ? 3 : 5, // Smaller grid for rescue mode
			rowCompleted: false,
		};

		perimeterState = {
			phase: "outer",
			currentSide: 0,
			progress: 0,
			radius: Math.floor(fs / 2) - 3,
		};

		if (currentPattern.value === "search-grid") {
			// TRUE GRID: Methodical row-by-row coverage
			const gridSize = gridSearchState.gridSize;
			const startX = -fs / 2 + gridSize;
			const startZ = -fs / 2 + gridSize;
			const endX = fs / 2 - gridSize;
			const endZ = fs / 2 - gridSize;

			// Generate grid points in row-by-row order
			for (
				let row = 0;
				row <= Math.floor((endZ - startZ) / gridSize);
				row++
			) {
				const rowPoints = [];
				for (
					let col = 0;
					col <= Math.floor((endX - startX) / gridSize);
					col++
				) {
					const x = startX + col * gridSize;
					const z = startZ + row * gridSize;
					if (!isBlocked(x, z)) {
						rowPoints.push({
							x,
							z,
							searched: false,
							row,
							col,
							isRowEnd:
								col === Math.floor((endX - startX) / gridSize),
						});
					}
				}
				// Alternate direction for efficient coverage
				if (row % 2 === 1) rowPoints.reverse();
				searchGrid.push(...rowPoints);
			}
			missionStatus.value = `GRID SEARCH - ${searchGrid.length} WAYPOINTS PLANNED`;
		} else if (currentPattern.value === "perimeter-sweep") {
			// TRUE PERIMETER: Start from edges, work inward systematically
			generatePerimeterWaypoints(fs);
			missionStatus.value = `PERIMETER SWEEP - ${missionData.waypoints.length} WAYPOINTS`;
		} else if (currentPattern.value === "spiral-search") {
			// Start from center and spiral outward
			spiralState = {
				angle: 0,
				radius: 2,
				center: { x: 0, z: 0 },
				radiusGrowth:
					currentMode.value === "search-rescue" ? 0.12 : 0.08,
				maxRadius: fs / 2 - 5,
			};
			missionStatus.value = "SPIRAL SEARCH - CENTER-OUT EXPANSION";
		} else if (currentPattern.value === "random-patrol") {
			generateRandomPatrolPoints(fs);
			missionStatus.value = `RANDOM PATROL - ${missionData.waypoints.length} WAYPOINTS`;
		}

		currentGridIndex = 0;
		missionData.currentWaypoint = 0;
		areaSearched.value = 0;
	}

	// ENHANCED: True perimeter sweep - structured layer approach
	function generatePerimeterWaypoints(fs) {
		missionData.waypoints = [];
		const layers = currentMode.value === "search-rescue" ? 2 : 3;
		const stepSize = currentMode.value === "search-rescue" ? 2 : 3;

		for (let layer = 0; layer < layers; layer++) {
			const radius = fs / 2 - 4 - layer * 8;
			if (radius < 8) break;

			const layerPoints = [];

			// Top edge (left to right)
			for (let x = -radius; x <= radius; x += stepSize) {
				layerPoints.push({ x, z: radius, layer });
			}
			// Right edge (top to bottom, skip corner)
			for (let z = radius - stepSize; z >= -radius; z -= stepSize) {
				layerPoints.push({ x: radius, z, layer });
			}
			// Bottom edge (right to left, skip corner)
			for (let x = radius - stepSize; x >= -radius; x -= stepSize) {
				layerPoints.push({ x, z: -radius, layer });
			}
			// Left edge (bottom to top, skip corner)
			for (let z = -radius + stepSize; z < radius; z += stepSize) {
				layerPoints.push({ x: -radius, z, layer });
			}

			missionData.waypoints.push(...layerPoints);
		}

		// Always end at center for complete coverage
		missionData.waypoints.push({ x: 0, z: 0, layer: "center" });
	}

	// NEW: Generate random patrol points
	function generateRandomPatrolPoints(fs) {
		missionData.waypoints = [];
		const numPoints = 20;

		for (let i = 0; i < numPoints; i++) {
			let validPoint = false;
			let attempts = 0;

			while (!validPoint && attempts < 20) {
				const x = (Math.random() - 0.5) * (fs - 10);
				const z = (Math.random() - 0.5) * (fs - 10);

				if (!isBlocked(x, z)) {
					missionData.waypoints.push({ x, z });
					validPoint = true;
				}
				attempts++;
			}
		}
	}

	// Reset Functions
	function resetPatternStates() {
		exploring = true;
		mowDirection = 1;
		mowRow = 0;
		spiralState = null;
		randomWalkState = null;
		seekingHeat = false;
		avoidanceMode = false;
		avoidanceDirection = null;
		avoidanceTimer = 0;
		currentTarget = null;
		priorityTarget = null;
		targetLockOn = false;
		detectedHeatTypes.value = [];
		heatDetectionCooldown = 0;
		stuckTimer = 0;
		emergencyManeuver = false;
		targetsFound.value = 0;
		areaSearched.value = 0;
		missionStatus.value = "INITIALIZING";
		rotationSearchMode = false;
		noPathTimer = 0;

		// Reset mode settings
		if (currentMode.value === "search-rescue") {
			heatDetectionRange = 30;
		} else {
			heatDetectionRange = 20;
		}

		lidarData.clearDirections = [];
		lidarData.blockedDirections = [];
		lidarData.heatDirections = [];
		lidarData.emergencyExits = [];
		lidarData.bestPaths = [];
		lidarData.humanDetections = [];

		missionData.rescueTargets = [];
		missionData.completedAreas.clear();

		if (robot) {
			targetPosition.x = robot.position.x;
			targetPosition.z = robot.position.z;
			targetRotation = robot.rotation.y;
			lastPosition.x = robot.position.x;
			lastPosition.z = robot.position.z;
		}
	}

	function resetSimulation() {
		resetPatternStates();

		if (mainScene) {
			[...wallMeshes, ...heatMeshes, ...obstacleMeshes].forEach(
				(mesh) => {
					mainScene.remove(mesh);
					mesh.geometry.dispose();
					mesh.material.dispose();
				}
			);

			if (field) {
				mainScene.remove(field);
				field.geometry.dispose();
				field.material.dispose();
			}

			if (robot) {
				mainScene.remove(robot);
				robot.geometry.dispose();
				robot.material.dispose();
			}

			if (lidarGroup) {
				lidarGroup.clear();
				mainScene.remove(lidarGroup);
			}
		}

		wallMeshes.length = 0;
		heatMeshes.length = 0;
		obstacleMeshes.length = 0;

		if (fogCtx) {
			fogCtx.clearRect(0, 0, 300, 300);
			fogCtx.fillStyle = "#111";
			fogCtx.fillRect(0, 0, 300, 300);
		}

		setupScene();
		applyMaterials();
		generateMissionPlan();
	}

	function increaseFieldSize() {
		fieldSize.value += 10;
		resetSimulation();
	}

	function decreaseFieldSize() {
		if (fieldSize.value > 20) {
			fieldSize.value -= 10;
			resetSimulation();
		}
	}

	function spawnMoreHeat() {
		heatMeshes.forEach((h) => {
			mainScene.remove(h);
			h.geometry.dispose();
			h.material.dispose();
		});
		heatMeshes.length = 0;

		for (let i = 0; i < numHeatObjects.value; i++) {
			spawnHeatSignature();
		}
	}

	function spawnMoreObstacles() {
		obstacleMeshes.forEach((o) => {
			mainScene.remove(o);
			o.geometry.dispose();
			o.material.dispose();
		});
		obstacleMeshes.length = 0;

		for (let i = 0; i < numObstacles.value; i++) {
			spawnObstacle();
		}
	}

	// Scene Setup
	function setupScene() {
		mainScene = new THREE.Scene();
		mainScene.background = new THREE.Color(0x0a0a1a);

		// field with search grid visualization
		const fieldGeometry = new THREE.PlaneGeometry(
			fieldSize.value,
			fieldSize.value
		);
		const fieldMaterial = new THREE.MeshPhongMaterial({
			color: 0x1a2332,
			transparent: true,
			opacity: 0.9,
		});
		field = new THREE.Mesh(fieldGeometry, fieldMaterial);
		field.rotation.x = -Math.PI / 2;
		mainScene.add(field);

		const wallHeight = 3;
		const wallThickness = 0.6;
		const wallMaterial = new THREE.MeshPhongMaterial({
			color: 0x2c3e50,
			emissive: 0x0f1419,
		});
		const fs = fieldSize.value;
		const walls = [
			new THREE.Mesh(
				new THREE.BoxGeometry(fs, wallHeight, wallThickness),
				wallMaterial
			),
			new THREE.Mesh(
				new THREE.BoxGeometry(fs, wallHeight, wallThickness),
				wallMaterial
			),
			new THREE.Mesh(
				new THREE.BoxGeometry(wallThickness, wallHeight, fs),
				wallMaterial
			),
			new THREE.Mesh(
				new THREE.BoxGeometry(wallThickness, wallHeight, fs),
				wallMaterial
			),
		];
		walls[0].position.set(0, wallHeight / 2, -fs / 2);
		walls[1].position.set(0, wallHeight / 2, fs / 2);
		walls[2].position.set(fs / 2, wallHeight / 2, 0);
		walls[3].position.set(-fs / 2, wallHeight / 2, 0);
		walls.forEach((w) => {
			mainScene.add(w);
			wallMeshes.push(w);
		});

		// lighting for better heat detection
		mainScene.add(new THREE.AmbientLight(0x404040, 0.3));
		const spotLight = new THREE.SpotLight(0xffffff, 1.2);
		spotLight.position.set(0, 35, 0);
		spotLight.castShadow = true;
		spotLight.shadow.mapSize.width = 2048;
		spotLight.shadow.mapSize.height = 2048;
		mainScene.add(spotLight);

		const robotGeometry = new THREE.BoxGeometry(1.4, 0.5, 2.2);
		const robotMaterial = new THREE.MeshPhongMaterial({
			color: 0xff3333,
			emissive: 0x330000,
			shininess: 100,
		});
		robot = new THREE.Mesh(robotGeometry, robotMaterial);

		const sensorArray = new THREE.Mesh(
			new THREE.CylinderGeometry(0.08, 0.08, 1.2),
			new THREE.MeshBasicMaterial({ color: 0x444444 })
		);
		sensorArray.position.set(0, 0.8, 0);
		robot.add(sensorArray);

		// Heat detection beacon
		const beacon = new THREE.Mesh(
			new THREE.SphereGeometry(0.1),
			new THREE.MeshBasicMaterial({ color: 0x00ff00, emissive: 0x004400 })
		);
		beacon.position.set(0, 0.9, 0.5);
		robot.add(beacon);

		// ENHANCED: Start robot at field center or corner based on pattern
		let robotX, robotZ;
		if (currentPattern.value === "search-grid") {
			// Start at top-left corner for grid search
			robotX = -fs / 2 + 5;
			robotZ = -fs / 2 + 5;
		} else if (currentPattern.value === "spiral-search") {
			// Start at center for spiral
			robotX = 0;
			robotZ = 0;
		} else {
			// Random start for other patterns
			robotX = (Math.random() - 0.5) * (fs - 10);
			robotZ = (Math.random() - 0.5) * (fs - 10);
		}

		robot.position.set(robotX, 0.35, robotZ);
		robot.rotation.y = -Math.PI / 2;
		mainScene.add(robot);

		// Initialize movement targets
		targetPosition.x = robot.position.x;
		targetPosition.z = robot.position.z;
		targetRotation = robot.rotation.y;
		lastPosition.x = robot.position.x;
		lastPosition.z = robot.position.z;

		// Spawn environment
		for (let i = 0; i < numObstacles.value; i++) {
			spawnObstacle();
		}

		for (let i = 0; i < numHeatObjects.value; i++) {
			spawnHeatSignature();
		}

		// LiDAR group
		lidarGroup = new THREE.Group();
		mainScene.add(lidarGroup);

		// Update camera bounds
		if (miniCamera) {
			miniCamera.left = -fs / 2;
			miniCamera.right = fs / 2;
			miniCamera.top = fs / 2;
			miniCamera.bottom = -fs / 2;
			miniCamera.updateProjectionMatrix();
		}
	}

	function spawnObstacle() {
		const obstacleTypes = [
			() =>
				new THREE.BoxGeometry(
					2.5 + Math.random() * 3,
					1.5 + Math.random() * 2,
					2.5 + Math.random() * 3
				),
			() =>
				new THREE.CylinderGeometry(
					1 + Math.random(),
					1 + Math.random(),
					2 + Math.random(),
					8
				),
			() =>
				new THREE.ConeGeometry(
					1.5 + Math.random(),
					3 + Math.random(),
					8
				),
		];

		const geometry =
			obstacleTypes[Math.floor(Math.random() * obstacleTypes.length)]();
		const material = new THREE.MeshPhongMaterial({
			color: 0x566573,
			emissive: 0x0f1419,
		});
		const obstacle = new THREE.Mesh(geometry, material);

		const fs = fieldSize.value;
		let x,
			z,
			validPosition = false,
			attempts = 0;

		while (!validPosition && attempts < 30) {
			x = (Math.random() - 0.5) * (fs - 12);
			z = (Math.random() - 0.5) * (fs - 12);

			const distToRobot = Math.hypot(
				x - robot.position.x,
				z - robot.position.z
			);
			const distToWall = Math.min(
				Math.abs(x + fs / 2),
				Math.abs(x - fs / 2),
				Math.abs(z + fs / 2),
				Math.abs(z - fs / 2)
			);

			if (distToRobot > 5 && distToWall > 5) {
				validPosition = true;
			}
			attempts++;
		}

		obstacle.position.set(x, geometry.parameters?.height / 2 || 1.5, z);
		obstacle.userData = { type: "obstacle" };
		obstacleMeshes.push(obstacle);
		mainScene.add(obstacle);
	}

	function spawnHeatSignature() {
		const heatType =
			heatTypes[Math.floor(Math.random() * heatTypes.length)];
		const heatGeometry = new THREE.SphereGeometry(heatType.size, 24, 24);
		const heatMaterial = new THREE.MeshPhongMaterial({
			color: heatType.color,
			emissive: heatType.emissive,
			transparent: true,
			opacity: 0.85,
		});
		const heat = new THREE.Mesh(heatGeometry, heatMaterial);

		const fs = fieldSize.value;
		let x,
			z,
			validPosition = false,
			attempts = 0;

		while (!validPosition && attempts < 30) {
			x = (Math.random() - 0.5) * (fs - 10);
			z = (Math.random() - 0.5) * (fs - 10);

			const distToRobot = Math.hypot(
				x - robot.position.x,
				z - robot.position.z
			);
			let tooCloseToObstacle = false;

			for (const obstacle of obstacleMeshes) {
				if (
					Math.hypot(
						x - obstacle.position.x,
						z - obstacle.position.z
					) < 5
				) {
					tooCloseToObstacle = true;
					break;
				}
			}

			if (distToRobot > 4 && !tooCloseToObstacle) {
				validPosition = true;
			}
			attempts++;
		}

		heat.position.set(x, 0.7, z);
		heat.userData = {
			type: "heat",
			heatType: heatType.name,
			temperature: heatType.temp,
			priority: heatType.priority,
		};
		heatMeshes.push(heat);
		mainScene.add(heat);
	}

	// Materials
	function applyMaterials() {
		wallMeshes.forEach((w) => {
			w.material.map = texturesEnabled.value ? wallTexture : null;
			w.material.needsUpdate = true;
		});
		heatMeshes.forEach((h) => {
			h.material.map = texturesEnabled.value ? heatTexture : null;
			h.material.needsUpdate = true;
		});
		if (field) {
			field.material.map = texturesEnabled.value ? groundTexture : null;
			field.material.needsUpdate = true;
		}
		if (mainScene) {
			mainScene.background =
				texturesEnabled.value && skyTexture
					? skyTexture
					: new THREE.Color(0x0a0a1a);
		}
	}
	watch(texturesEnabled, applyMaterials);

	function isWall(x, z) {
		const fs = fieldSize.value;
		return (
			x <= -fs / 2 + 1 ||
			x >= fs / 2 - 1 ||
			z <= -fs / 2 + 1 ||
			z >= fs / 2 - 1
		);
	}

	function isObstacle(x, z) {
		for (const obstacle of obstacleMeshes) {
			const dist = Math.hypot(
				x - obstacle.position.x,
				z - obstacle.position.z
			);
			if (dist < 2.5) return true;
		}
		return false;
	}

	function isBlocked(x, z) {
		return isWall(x, z) || isObstacle(x, z);
	}

	function worldToMiniMap(x, z) {
		const fs = fieldSize.value;
		return [((x + fs / 2) / fs) * 300, ((z + fs / 2) / fs) * 300];
	}

	// ENHANCED: Mode-specific heat detection
	function scanForImmedateThreats() {
		const currentTime = Date.now();
		const scanFrequency = currentMode.value === "search-rescue" ? 20 : 30;

		if (currentTime - lastHeatScanTime < scanFrequency) return;

		lastHeatScanTime = currentTime;
		let humanDetected = false;
		let priorityHeatDetected = false;
		let closestPriorityTarget = null;
		let closestDistance = Infinity;

		// Search-rescue mode is more aggressive
		const effectiveRange =
			currentMode.value === "search-rescue"
				? heatDetectionRange * 1.5
				: heatDetectionRange;

		for (const heat of heatMeshes) {
			const dist = Math.hypot(
				robot.position.x - heat.position.x,
				robot.position.z - heat.position.z
			);

			if (dist > effectiveRange) continue;

			let heatVisibleToLidar = false;

			if (dist < 6) {
				heatVisibleToLidar = true;
			} else {
				for (const direction of lidarData.heatDirections) {
					const heatAngle = Math.atan2(
						heat.position.x - robot.position.x,
						heat.position.z - robot.position.z
					);

					const angleThreshold =
						currentMode.value === "search-rescue"
							? Math.PI / 3
							: Math.PI / 4;

					if (
						Math.abs(direction.angle - heatAngle) < angleThreshold
					) {
						heatVisibleToLidar = true;
						break;
					}
				}
			}

			if (!heatVisibleToLidar && dist > 6) continue;

			// Only target Human Survivor and Injured Animal
			if (heat.userData.heatType === "Human Survivor") {
				if (!humanDetected || dist < closestDistance) {
					humanDetected = true;
					closestPriorityTarget = heat;
					closestDistance = dist;
					priorityHeatDetected = true;
				}
			} else if (
				heat.userData.heatType === "Injured Animal" &&
				!humanDetected
			) {
				if (!priorityHeatDetected || dist < closestDistance) {
					closestPriorityTarget = heat;
					closestDistance = dist;
					priorityHeatDetected = true;
				}
			}
		}

		// Mode-specific response
		if (
			priorityHeatDetected &&
			!targetLockOn &&
			currentMode.value !== "manual"
		) {
			const shouldLockOn =
				!priorityTarget ||
				closestPriorityTarget.userData.priority <
					priorityTarget.userData.priority ||
				(closestPriorityTarget.userData.priority ===
					priorityTarget.userData.priority &&
					closestDistance < 15);

			if (shouldLockOn) {
				priorityTarget = closestPriorityTarget;
				targetLockOn = true;
				seekingHeat = true;
				exploring = false;
				rotationSearchMode = false;

				const targetType = priorityTarget.userData.heatType;
				if (targetType === "Human Survivor") {
					missionStatus.value = `🚨 ${currentMode.value.toUpperCase()}: HUMAN DETECTED! ${closestDistance.toFixed(1)}m`;
				} else if (targetType === "Injured Animal") {
					missionStatus.value = `🐾 ${currentMode.value.toUpperCase()}: ANIMAL DETECTED! ${closestDistance.toFixed(1)}m`;
				}
			}
		}
	}

	// ENHANCED: Improved LiDAR with mode-specific fog clearing
	function performLidarScan() {
		lidarGroup.clear();

		const fov = lidarFov.value;
		const numRays = lidarNumRays.value;
		const radius = lidarRadius.value;
		const robotYaw = robot.rotation.y;
		let heatFound = false;
		const detectedHeats = new Set();
		const currentTime = Date.now();

		if (currentTime - lastHeatDetectionTime < 40) {
			return heatDetected.value;
		}
		lastHeatDetectionTime = currentTime;

		// Reset LiDAR data first
		lidarData.clearDirections = [];
		lidarData.blockedDirections = [];
		lidarData.heatDirections = [];
		lidarData.emergencyExits = [];
		lidarData.bestPaths = [];
		lidarData.humanDetections = [];

		const stepSize = 0.15;

		// Mode-specific fog clearing frequency
		const fogClearFrequency =
			currentMode.value === "search-rescue" ? 30 : 50;

		if (currentTime - lastFogClearTime > fogClearFrequency) {
			const [rx, rz] = worldToMiniMap(robot.position.x, robot.position.z);
			fogCtx.save();
			fogCtx.globalCompositeOperation = "destination-out";
			fogCtx.beginPath();
			fogCtx.arc(rx, rz, fogClearingRadius, 0, 2 * Math.PI);
			fogCtx.fill();
			fogCtx.restore();
			lastFogClearTime = currentTime;
		}

		for (let i = 0; i < numRays; i++) {
			const angle = robotYaw - fov / 2 + (i / (numRays - 1)) * fov;
			let lastX = robot.position.x;
			let lastZ = robot.position.z;
			let hitObstacle = false;
			let hitWall = false;
			let rayHasHeat = false;
			let rayHasHuman = false;
			let maxClearDistance = 0;
			let detectedHeatObject = null;

			for (let r = stepSize; r <= radius; r += stepSize) {
				const x = robot.position.x + Math.sin(angle) * r;
				const z = robot.position.z + Math.cos(angle) * r;

				if (isWall(x, z)) {
					hitWall = true;
					break;
				}

				if (isObstacle(x, z)) {
					hitObstacle = true;
					if (!advancedHeatSearch.value) {
						break;
					}
				}

				if (!hitObstacle && !hitWall) {
					maxClearDistance = r;
				}

				// Continuous fog clearing along rays
				if (r % 0.15 < stepSize) {
					const [rx, rz] = worldToMiniMap(x, z);
					fogCtx.save();
					fogCtx.globalCompositeOperation = "destination-out";
					fogCtx.beginPath();
					const clearSize =
						currentMode.value === "search-rescue" ? 12 : 8;
					fogCtx.arc(rx, rz, clearSize, 0, 2 * Math.PI);
					fogCtx.fill();
					fogCtx.restore();
				}

				// Only detect heat if ray can actually reach it
				if (!hitObstacle && !hitWall) {
					for (const heat of heatMeshes) {
						const heatDist = Math.hypot(
							x - heat.position.x,
							z - heat.position.z
						);
						const detectionRadius = 1.2;

						if (heatDist < detectionRadius) {
							heatFound = true;
							rayHasHeat = true;
							detectedHeatObject = heat;
							detectedHeats.add(heat.userData.heatType);

							if (heat.userData.heatType === "Human Survivor") {
								rayHasHuman = true;

								if (lidarGroup.children.length < 80) {
									const humanPoint = new THREE.Mesh(
										heatPointGeometry,
										priorityHeatMaterial
									);
									humanPoint.position.set(
										heat.position.x,
										0.4,
										heat.position.z
									);
									lidarGroup.add(humanPoint);
								}
							} else if (
								heat.userData.heatType === "Injured Animal" &&
								lidarGroup.children.length < 80
							) {
								const animalPoint = new THREE.Mesh(
									heatPointGeometry,
									new THREE.MeshBasicMaterial({
										color: 0xff6666,
									})
								);
								animalPoint.position.set(
									heat.position.x,
									0.3,
									heat.position.z
								);
								lidarGroup.add(animalPoint);
							}
						}
					}
				}

				lastX = x;
				lastZ = z;
			}

			// Enhanced direction classification
			let pointMaterial = lidarPointMaterial;
			let directionType = "clear";

			if (hitWall) {
				pointMaterial = wallPointMaterial;
				directionType = "wall";
			} else if (hitObstacle) {
				pointMaterial = obstaclePointMaterial;
				directionType = "obstacle";
			}

			const directionData = {
				angle: angle,
				distance: Math.hypot(
					lastX - robot.position.x,
					lastZ - robot.position.z
				),
				clearDistance: maxClearDistance,
				hasHeat: rayHasHeat,
				hasHuman: rayHasHuman,
				heatObject: detectedHeatObject,
				type: directionType,
				quality: maxClearDistance / radius,
			};

			// Classify directions
			if (directionType === "clear") {
				lidarData.clearDirections.push(directionData);
				if (maxClearDistance > radius * 0.6) {
					lidarData.bestPaths.push(directionData);
				}
				if (maxClearDistance > radius * 0.8) {
					lidarData.emergencyExits.push(directionData);
				}
			} else {
				lidarData.blockedDirections.push(directionData);
			}

			if (rayHasHeat) {
				lidarData.heatDirections.push(directionData);
			}

			if (rayHasHuman) {
				lidarData.humanDetections.push(directionData);
			}

			// Add LiDAR point
			const point = new THREE.Mesh(lidarPointGeometry, pointMaterial);
			point.position.set(lastX, 0.12, lastZ);
			lidarGroup.add(point);
		}

		// ONLY check for very close heat (within 3 units)
		for (const heat of heatMeshes) {
			const dist = Math.hypot(
				robot.position.x - heat.position.x,
				robot.position.z - heat.position.z
			);

			if (dist < 3) {
				heatFound = true;
				detectedHeats.add(heat.userData.heatType);
			}
		}

		// CHECK FOR NO CLEAR PATHS - TRIGGER ROTATION
		if (
			lidarData.clearDirections.length === 0 &&
			!rotationSearchMode &&
			currentMode.value !== "manual"
		) {
			noPathTimer++;
			if (noPathTimer > 15) {
				rotationSearchMode = true;
				rotationTarget = robot.rotation.y + Math.PI / 4;
				noPathTimer = 0;
				missionStatus.value = "NO CLEAR PATH - ROTATING TO SCAN";
			}
		} else if (lidarData.clearDirections.length > 0) {
			noPathTimer = 0;
			if (rotationSearchMode) {
				rotationSearchMode = false;
				missionStatus.value = "RESUMING EXPLORATION";
			}
		}

		// Sort by quality
		lidarData.clearDirections.sort((a, b) => b.quality - a.quality);
		lidarData.bestPaths.sort((a, b) => b.quality - a.quality);
		lidarData.heatDirections.sort((a, b) => b.distance - a.distance);
		lidarData.humanDetections.sort((a, b) => b.distance - a.distance);

		detectedHeatTypes.value = Array.from(detectedHeats);
		heatDetected.value = heatFound;

		return heatFound;
	}

	// NEW: Spiral Search Implementation
	function updateSpiralSearch() {
		if (!spiralState) return;

		const { center, maxRadius } = spiralState;
		let { angle, radius, radiusGrowth } = spiralState;

		// If spiral is complete, stop exploring
		if (radius > maxRadius) {
			missionStatus.value = "SPIRAL SEARCH COMPLETE";
			exploring = false;
			return;
		}

		// Calculate next spiral target point
		const targetX = center.x + Math.cos(angle) * radius;
		const targetZ = center.z + Math.sin(angle) * radius;
		const distance = Math.hypot(
			robot.position.x - targetX,
			robot.position.z - targetZ
		);

		// If close to current spiral point, increment spiral parameters
		if (distance < 1.5) {
			spiralState.angle += Math.PI / 8; // Increase angle for next step

			// Gradually increase radius for outward spiral
			spiralState.radius += radiusGrowth;

			// Adjust growth rate based on mode
			if (currentMode.value === "search-rescue") {
				spiralState.radiusGrowth = Math.min(
					0.15,
					spiralState.radiusGrowth + 0.001
				);
			} else {
				spiralState.radiusGrowth = Math.min(
					0.1,
					spiralState.radiusGrowth + 0.0005
				);
			}
		}

		// AI-enhanced movement toward spiral point
		const moveAngle = Math.atan2(
			targetZ - robot.position.z,
			targetX - robot.position.x
		);
		const speed =
			robotSpeed.value *
			(currentMode.value === "search-rescue" ? 1.8 : 1.3);

		// Check if direct path is clear
		const directX = robot.position.x + Math.cos(moveAngle) * speed;
		const directZ = robot.position.z + Math.sin(moveAngle) * speed;

		if (!isBlocked(directX, directZ)) {
			updateTargetPosition(directX, directZ, moveAngle);
		} else {
			const aiDirection = findSmartDirection(targetX, targetZ);
			const aiX = robot.position.x + Math.cos(aiDirection) * speed * 0.9;
			const aiZ = robot.position.z + Math.sin(aiDirection) * speed * 0.9;
			updateTargetPosition(aiX, aiZ, aiDirection);
		}

		// Progress reporting
		const percent = Math.min(100, Math.round((radius / maxRadius) * 100));
		missionStatus.value = `SPIRAL SEARCH - ${percent}% (R:${radius.toFixed(1)})`;
	}

	function findSmartDirection(targetX, targetZ) {
		// Calculate desired direction toward target
		const desiredAngle = Math.atan2(
			targetZ - robot.position.z,
			targetX - robot.position.x
		);

		// Create AI decision matrix for path selection
		const pathOptions = [];

		// Evaluate all clear directions with AI scoring
		for (const direction of lidarData.clearDirections) {
			let score = direction.quality * 100; // Base score from clearance quality

			// Bonus for moving toward target
			const angleToTarget = Math.abs(direction.angle - desiredAngle);
			const normalizedAngle = Math.min(
				angleToTarget,
				2 * Math.PI - angleToTarget
			);
			score += (Math.PI - normalizedAngle) * 50; // Higher score for angles closer to target

			// Bonus for longer clear paths
			score += direction.clearDistance * 10;

			// Mode-specific AI preferences
			if (currentMode.value === "search-rescue") {
				// Search-rescue mode prefers faster, more direct routes
				score += direction.quality > 0.7 ? 30 : 0;
				if (direction.hasHeat) score += 100; // Much higher priority for heat
				if (direction.hasHuman) score += 200; // Maximum priority for humans
			} else {
				// Auto mode prefers thorough, safe exploration
				score += direction.quality > 0.8 ? 20 : 0;
				if (direction.hasHeat) score += 25; // Lower heat priority
				if (direction.hasHuman) score += 150; // Still high human priority
			}

			// Penalty for directions too close to obstacles
			if (direction.quality < 0.3) score -= 50;

			// Bonus for directions that lead to unexplored areas (basic AI memory)
			const exploreBonus = calculateExplorationBonus(direction.angle);
			score += exploreBonus;

			pathOptions.push({
				angle: direction.angle,
				score: score,
				reason: `Q:${direction.quality.toFixed(2)} T:${normalizedAngle.toFixed(2)} E:${exploreBonus}`,
			});
		}

		pathOptions.sort((a, b) => b.score - a.score);

		if (pathOptions.length > 0) {
			const bestPath = pathOptions[0];
			return bestPath.angle;
		}

		return findBestDirection();
	}

	let exploredDirections = new Map(); 
	let lastExplorationUpdate = 0;

	function calculateExplorationBonus(angle) {
		const currentTime = Date.now();

		if (currentTime - lastExplorationUpdate > 2000) {
			for (const [key, data] of exploredDirections.entries()) {
				if (currentTime - data.lastVisited > 10000) {
					exploredDirections.delete(key);
				}
			}
			lastExplorationUpdate = currentTime;
		}

		// Discretize angle into sectors for memory
		const sector = Math.floor((angle + Math.PI) / (Math.PI / 8)); // 16 sectors
		const sectorKey = `${Math.floor(robot.position.x / 5)}_${Math.floor(robot.position.z / 5)}_${sector}`;

		const explorationData = exploredDirections.get(sectorKey);

		if (!explorationData) {
			// Unexplored direction - high bonus
			exploredDirections.set(sectorKey, {
				lastVisited: currentTime,
				visitCount: 1,
			});
			return 50;
		} else {
			// Recently explored - lower bonus
			const timeSinceVisit = currentTime - explorationData.lastVisited;
			const bonus = Math.max(
				0,
				30 - explorationData.visitCount * 10 + timeSinceVisit / 1000
			);

			// Update exploration data
			explorationData.lastVisited = currentTime;
			explorationData.visitCount++;

			return bonus;
		}
	}

	function updateRotationSearch() {
		if (!rotationSearchMode) return;

		const rotationSpeed = 0.08;
		const targetDiff = targetRotation - robot.rotation.y;

		if (Math.abs(targetDiff) < 0.1) {
			performLidarScan(); 

			if (lidarData.clearDirections.length > 0) {
				rotationSearchMode = false;
				exploring = true;
				missionStatus.value = "CLEAR PATH FOUND - RESUMING EXPLORATION";
			} else {
				targetRotation += Math.PI / 3; 

				if (Math.abs(targetRotation - robot.rotation.y) > 2 * Math.PI) {
					emergencyManeuver = true;
					rotationSearchMode = false;
					missionStatus.value = "INITIATING EMERGENCY MANEUVER";
				}
			}
		}

		updateTargetPosition(
			robot.position.x,
			robot.position.z,
			targetRotation
		);
	}

	function findBestDirection() {
		if (lidarData.humanDetections.length > 0) {
			return lidarData.humanDetections[0].angle;
		}

		if (lidarData.heatDirections.length > 0) {
			if (currentMode.value === "search-rescue") {
				return lidarData.heatDirections[0].angle;
			} else if (currentMode.value === "auto" && Math.random() < 0.2) {
				return lidarData.heatDirections[0].angle;
			}
		}

		if (emergencyManeuver && lidarData.emergencyExits.length > 0) {
			return lidarData.emergencyExits[0].angle;
		}

		if (lidarData.bestPaths.length > 0) {
			return lidarData.bestPaths[0].angle;
		}

		if (lidarData.clearDirections.length > 0) {
			return lidarData.clearDirections[0].angle;
		}

		return robot.rotation.y + Math.PI / 6;
	}

	function smoothMovement() {
		const distMoved = Math.hypot(
			robot.position.x - lastPosition.x,
			robot.position.z - lastPosition.z
		);

		if (distMoved < 0.02 && currentMode.value !== "manual") {
			stuckTimer++;
			if (stuckTimer > 40) {
				emergencyManeuver = true;
				stuckTimer = 0;
			}
		} else {
			stuckTimer = 0;
			emergencyManeuver = false;
		}

		lastPosition.x = robot.position.x;
		lastPosition.z = robot.position.z;

		const modeSmoothingFactor =
			currentMode.value === "search-rescue" ? 0.3 : 0.25;

		robot.position.x +=
			(targetPosition.x - robot.position.x) * modeSmoothingFactor;
		robot.position.z +=
			(targetPosition.z - robot.position.z) * modeSmoothingFactor;

		let rotDiff = targetRotation - robot.rotation.y;
		if (rotDiff > Math.PI) rotDiff -= 2 * Math.PI;
		if (rotDiff < -Math.PI) rotDiff += 2 * Math.PI;
		robot.rotation.y += rotDiff * modeSmoothingFactor;
	}

	function updateTargetPosition(x, z, rotation) {
		if (!isBlocked(x, z)) {
			targetPosition.x = x;
			targetPosition.z = z;
		}
		if (rotation !== undefined) {
			targetRotation = rotation;
		}
	}

	function findBestDirection() {
		if (lidarData.humanDetections.length > 0) {
			return lidarData.humanDetections[0].angle;
		}

		if (lidarData.heatDirections.length > 0) {
			if (currentMode.value === "search-rescue") {
				return lidarData.heatDirections[0].angle;
			} else if (currentMode.value === "auto" && Math.random() < 0.2) {
				return lidarData.heatDirections[0].angle;
			}
		}

		// Emergency maneuver
		if (emergencyManeuver && lidarData.emergencyExits.length > 0) {
			return lidarData.emergencyExits[0].angle;
		}

		// Best quality paths
		if (lidarData.bestPaths.length > 0) {
			return lidarData.bestPaths[0].angle;
		}

		// Any clear direction
		if (lidarData.clearDirections.length > 0) {
			return lidarData.clearDirections[0].angle;
		}

		return robot.rotation.y + Math.PI / 6;
	}

	function performLidarScan() {
		lidarGroup.clear();

		const fov = lidarFov.value;
		const numRays = lidarNumRays.value;
		const radius = lidarRadius.value;
		const robotYaw = robot.rotation.y;
		let heatFound = false;
		const detectedHeats = new Set();
		const currentTime = Date.now();

		if (currentTime - lastHeatDetectionTime < 40) {
			return heatDetected.value;
		}
		lastHeatDetectionTime = currentTime;

		lidarData.clearDirections = [];
		lidarData.blockedDirections = [];
		lidarData.heatDirections = [];
		lidarData.emergencyExits = [];
		lidarData.bestPaths = [];
		lidarData.humanDetections = [];

		const stepSize = 0.15;

		const fogClearFrequency =
			currentMode.value === "search-rescue" ? 30 : 50;

		if (currentTime - lastFogClearTime > fogClearFrequency) {
			const [rx, rz] = worldToMiniMap(robot.position.x, robot.position.z);
			fogCtx.save();
			fogCtx.globalCompositeOperation = "destination-out";
			fogCtx.beginPath();
			fogCtx.arc(rx, rz, fogClearingRadius, 0, 2 * Math.PI);
			fogCtx.fill();
			fogCtx.restore();
			lastFogClearTime = currentTime;
		}

		for (let i = 0; i < numRays; i++) {
			const angle = robotYaw - fov / 2 + (i / (numRays - 1)) * fov;
			let lastX = robot.position.x;
			let lastZ = robot.position.z;
			let hitObstacle = false;
			let hitWall = false;
			let rayHasHeat = false;
			let rayHasHuman = false;
			let maxClearDistance = 0;
			let detectedHeatObject = null;

			for (let r = stepSize; r <= radius; r += stepSize) {
				const x = robot.position.x + Math.sin(angle) * r;
				const z = robot.position.z + Math.cos(angle) * r;

				if (isWall(x, z)) {
					hitWall = true;
					break;
				}

				if (isObstacle(x, z)) {
					hitObstacle = true;
					if (!advancedHeatSearch.value) {
						break;
					}
				}

				if (!hitObstacle && !hitWall) {
					maxClearDistance = r;
				}

				if (r % 0.15 < stepSize) {
					const [rx, rz] = worldToMiniMap(x, z);
					fogCtx.save();
					fogCtx.globalCompositeOperation = "destination-out";
					fogCtx.beginPath();
					const clearSize =
						currentMode.value === "search-rescue" ? 12 : 8;
					fogCtx.arc(rx, rz, clearSize, 0, 2 * Math.PI);
					fogCtx.fill();
					fogCtx.restore();
				}

				if (!hitObstacle && !hitWall) {
					for (const heat of heatMeshes) {
						const heatDist = Math.hypot(
							x - heat.position.x,
							z - heat.position.z
						);
						const detectionRadius = 1.2; 

						if (heatDist < detectionRadius) {
							heatFound = true;
							rayHasHeat = true;
							detectedHeatObject = heat;
							detectedHeats.add(heat.userData.heatType);

							if (heat.userData.heatType === "Human Survivor") {
								rayHasHuman = true;

								if (lidarGroup.children.length < 80) {
									const humanPoint = new THREE.Mesh(
										heatPointGeometry,
										priorityHeatMaterial
									);
									humanPoint.position.set(
										heat.position.x,
										0.4,
										heat.position.z
									);
									lidarGroup.add(humanPoint);
								}
							} else if (
								heat.userData.heatType === "Injured Animal" &&
								lidarGroup.children.length < 80
							) {
								const animalPoint = new THREE.Mesh(
									heatPointGeometry,
									new THREE.MeshBasicMaterial({
										color: 0xff6666,
									})
								);
								animalPoint.position.set(
									heat.position.x,
									0.3,
									heat.position.z
								);
								lidarGroup.add(animalPoint);
							}
						}
					}
				}

				lastX = x;
				lastZ = z;
			}

			// Enhanced direction classification
			let pointMaterial = lidarPointMaterial;
			let directionType = "clear";

			if (hitWall) {
				pointMaterial = wallPointMaterial;
				directionType = "wall";
			} else if (hitObstacle) {
				pointMaterial = obstaclePointMaterial;
				directionType = "obstacle";
			}

			const directionData = {
				angle: angle,
				distance: Math.hypot(
					lastX - robot.position.x,
					lastZ - robot.position.z
				),
				clearDistance: maxClearDistance,
				hasHeat: rayHasHeat,
				hasHuman: rayHasHuman,
				heatObject: detectedHeatObject,
				type: directionType,
				quality: maxClearDistance / radius,
			};

			// Classify directions
			if (directionType === "clear") {
				lidarData.clearDirections.push(directionData);
				if (maxClearDistance > radius * 0.6) {
					lidarData.bestPaths.push(directionData);
				}
				if (maxClearDistance > radius * 0.8) {
					lidarData.emergencyExits.push(directionData);
				}
			} else {
				lidarData.blockedDirections.push(directionData);
			}

			if (rayHasHeat) {
				lidarData.heatDirections.push(directionData);
			}

			if (rayHasHuman) {
				lidarData.humanDetections.push(directionData);
			}

			// Add LiDAR point
			const point = new THREE.Mesh(lidarPointGeometry, pointMaterial);
			point.position.set(lastX, 0.12, lastZ);
			lidarGroup.add(point);
		}

		if (
			lidarData.clearDirections.length === 0 &&
			!rotationSearchMode &&
			currentMode.value !== "manual"
		) {
			noPathTimer++;
			if (noPathTimer > 15) {
				rotationSearchMode = true;
				rotationTarget = robot.rotation.y + Math.PI / 4;
				noPathTimer = 0;
				missionStatus.value = "NO CLEAR PATH - ROTATING TO SCAN";
			}
		} else if (lidarData.clearDirections.length > 0) {
			noPathTimer = 0;
			if (rotationSearchMode) {
				rotationSearchMode = false;
				missionStatus.value = "RESUMING EXPLORATION";
			}
		}

		// Sort by quality
		lidarData.clearDirections.sort((a, b) => b.quality - a.quality);
		lidarData.bestPaths.sort((a, b) => b.quality - a.quality);
		lidarData.heatDirections.sort((a, b) => b.distance - a.distance);
		lidarData.humanDetections.sort((a, b) => b.distance - a.distance);

		detectedHeatTypes.value = Array.from(detectedHeats);
		heatDetected.value = heatFound;

		return heatFound;
	}

	function updateSearchGrid() {
		if (currentGridIndex >= searchGrid.length) {
			missionStatus.value = "GRID SEARCH COMPLETE - 100%";
			exploring = false;
			return;
		}

		const target = searchGrid[currentGridIndex];
		const distance = Math.hypot(
			robot.position.x - target.x,
			robot.position.z - target.z
		);

		if (distance < 1.5) {
			target.searched = true;
			currentGridIndex++;
			areaSearched.value = Math.round(
				(currentGridIndex / searchGrid.length) * 100
			);

			const currentTarget = searchGrid[currentGridIndex - 1];
			if (currentTarget) {
				missionStatus.value = `GRID R${currentTarget.row + 1}C${currentTarget.col + 1} - ${areaSearched.value}%`;
			}
		}

		if (currentGridIndex < searchGrid.length) {
			const nextTarget = searchGrid[currentGridIndex];
			const angle = Math.atan2(
				nextTarget.x - robot.position.x,
				nextTarget.z - robot.position.z
			);

			// DIRECT movement toward grid point - ignore pathfinding unless absolutely blocked
			const speed =
				robotSpeed.value *
				(currentMode.value === "search-rescue" ? 2 : 1.5);
			const nextX = robot.position.x + Math.sin(angle) * speed;
			const nextZ = robot.position.z + Math.cos(angle) * speed;

			if (!isBlocked(nextX, nextZ)) {
				updateTargetPosition(nextX, nextZ, angle);
			} else {
				// Only use pathfinding if direct path blocked
				const bestDir = findBestDirection();
				const fallbackX =
					robot.position.x + Math.sin(bestDir) * speed * 0.8;
				const fallbackZ =
					robot.position.z + Math.cos(bestDir) * speed * 0.8;
				updateTargetPosition(fallbackX, fallbackZ, bestDir);
			}
		}
	}

	function updatePerimeterSweep() {
		if (missionData.currentWaypoint >= missionData.waypoints.length) {
			missionStatus.value = "PERIMETER SWEEP COMPLETE";
			exploring = false;
			return;
		}

		const waypoint = missionData.waypoints[missionData.currentWaypoint];
		const distance = Math.hypot(
			robot.position.x - waypoint.x,
			robot.position.z - waypoint.z
		);

		if (distance < 1.2) {
			missionData.currentWaypoint++;
			const progress = Math.round(
				(missionData.currentWaypoint / missionData.waypoints.length) *
					100
			);

			const layer =
				waypoint.layer === "center"
					? "CENTER"
					: `L${waypoint.layer + 1}`;
			missionStatus.value = `PERIMETER ${layer} - ${progress}%`;
		}

		if (missionData.currentWaypoint < missionData.waypoints.length) {
			const target = missionData.waypoints[missionData.currentWaypoint];
			const angle = Math.atan2(
				target.x - robot.position.x,
				target.z - robot.position.z
			);

			// DIRECT movement toward perimeter point
			const speed =
				robotSpeed.value *
				(currentMode.value === "search-rescue" ? 2 : 1.6);
			const nextX = robot.position.x + Math.sin(angle) * speed;
			const nextZ = robot.position.z + Math.cos(angle) * speed;

			if (!isBlocked(nextX, nextZ)) {
				updateTargetPosition(nextX, nextZ, angle);
			} else {
				// Only use pathfinding if direct path blocked
				const bestDirection = findBestDirection();
				const fallbackX =
					robot.position.x + Math.sin(bestDirection) * speed * 0.9;
				const fallbackZ =
					robot.position.z + Math.cos(bestDirection) * speed * 0.9;
				updateTargetPosition(fallbackX, fallbackZ, bestDirection);
			}
		}
	}

	function updateRandomPatrol() {
		if (!randomWalkState || randomWalkState.steps <= 0) {
			// Pick random waypoint or direction
			if (missionData.waypoints.length > 0 && Math.random() < 0.6) {
				const randomWaypoint =
					missionData.waypoints[
						Math.floor(Math.random() * missionData.waypoints.length)
					];
				const angle = Math.atan2(
					randomWaypoint.x - robot.position.x,
					randomWaypoint.z - robot.position.z
				);
				randomWalkState = {
					angle: angle,
					steps: Math.floor(40 + Math.random() * 60),
				};
			} else {
				const bestDirection = findBestDirection();
				randomWalkState = {
					angle: bestDirection,
					steps: Math.floor(30 + Math.random() * 50),
				};
			}
		}

		const speed =
			robotSpeed.value *
			(currentMode.value === "search-rescue" ? 1.5 : 1);
		const nextX =
			robot.position.x + Math.sin(randomWalkState.angle) * speed;
		const nextZ =
			robot.position.z + Math.cos(randomWalkState.angle) * speed;

		const directionClear = lidarData.clearDirections.some(
			(dir) =>
				Math.abs(dir.angle - randomWalkState.angle) < Math.PI / 3 &&
				dir.distance > 2
		);

		if (directionClear && !isBlocked(nextX, nextZ)) {
			updateTargetPosition(nextX, nextZ, randomWalkState.angle);
			randomWalkState.steps--;

			const progress = Math.round(
				((100 - randomWalkState.steps) / 100) * 100
			);
			missionStatus.value = `RANDOM PATROL - Segment ${progress}%`;
		} else {
			randomWalkState.angle = findBestDirection();
			randomWalkState.steps = Math.floor(20 + Math.random() * 30);
		}
	}

	function animate() {
		animationId = requestAnimationFrame(animate);

		smoothMovement();
		performLidarScan();
		scanForImmedateThreats();

		const COLLECTION_DISTANCE = 2.5;

		if (currentMode.value === "manual") {
			let angle = robot.rotation.y;
			if (manualControl.left) angle -= 0.12;
			if (manualControl.right) angle += 0.12;
			targetRotation = angle;

			let dx = 0,
				dz = 0;
			const speed = robotSpeed.value * 2;
			if (manualControl.forward) {
				dx += Math.sin(angle) * speed;
				dz += Math.cos(angle) * speed;
			}
			if (manualControl.backward) {
				dx -= Math.sin(angle) * speed;
				dz -= Math.cos(angle) * speed;
			}

			if (manualControl.forward || manualControl.backward) {
				updateTargetPosition(
					robot.position.x + dx,
					robot.position.z + dz
				);
			}

			// Manual collection
			for (let i = heatMeshes.length - 1; i >= 0; i--) {
				const heat = heatMeshes[i];
				const dist = Math.hypot(
					robot.position.x - heat.position.x,
					robot.position.z - heat.position.z
				);
				if (dist < COLLECTION_DISTANCE) {
					mainScene.remove(heat);
					heat.geometry.dispose();
					heat.material.dispose();
					heatMeshes.splice(i, 1);
					targetsFound.value++;
					spawnHeatSignature();
					break;
				}
			}
		}
		// Target lock-on mode
		else if (
			targetLockOn &&
			priorityTarget &&
			heatMeshes.includes(priorityTarget)
		) {
			const direction = new THREE.Vector3(
				priorityTarget.position.x - robot.position.x,
				0,
				priorityTarget.position.z - robot.position.z
			);
			const distance = direction.length();

			if (distance > COLLECTION_DISTANCE) {
				direction.normalize();
				const targetAngle = Math.atan2(direction.x, direction.z);

				let bestApproach = lidarData.clearDirections.find(
					(dir) => Math.abs(dir.angle - targetAngle) < Math.PI / 2
				);

				if (
					!bestApproach &&
					!isBlocked(
						robot.position.x + direction.x * robotSpeed.value * 2,
						robot.position.z + direction.z * robotSpeed.value * 2
					)
				) {
					bestApproach = {
						angle: targetAngle,
						distance: robotSpeed.value * 2,
					};
				}
				if (!bestApproach && lidarData.clearDirections.length > 0) {
					bestApproach = lidarData.clearDirections[0];
				}

				if (bestApproach) {
					const speedMultiplier =
						currentMode.value === "search-rescue"
							? 2.8
							: priorityTarget.userData.heatType ===
								  "Human Survivor"
								? 2.5
								: 2;
					const nextX =
						robot.position.x +
						Math.sin(bestApproach.angle) *
							robotSpeed.value *
							speedMultiplier;
					const nextZ =
						robot.position.z +
						Math.cos(bestApproach.angle) *
							robotSpeed.value *
							speedMultiplier;
					updateTargetPosition(nextX, nextZ, bestApproach.angle);
				}

				const targetType = priorityTarget.userData.heatType;
				if (targetType === "Human Survivor") {
					missionStatus.value = `🚨 ${currentMode.value.toUpperCase()}: APPROACHING HUMAN - ${distance.toFixed(1)}m`;
				} else if (targetType === "Injured Animal") {
					missionStatus.value = `🐾 ${currentMode.value.toUpperCase()}: APPROACHING ANIMAL - ${distance.toFixed(1)}m`;
				}
			} else {
				// Target collected
				const heatIndex = heatMeshes.indexOf(priorityTarget);
				mainScene.remove(priorityTarget);
				priorityTarget.geometry.dispose();
				priorityTarget.material.dispose();
				heatMeshes.splice(heatIndex, 1);
				targetsFound.value++;
				spawnHeatSignature();

				const targetType = priorityTarget.userData.heatType;
				targetLockOn = false;
				priorityTarget = null;
				exploring = true;

				if (targetType === "Human Survivor") {
					missionStatus.value = "🚑 HUMAN RESCUED! RESUMING SEARCH";
				} else if (targetType === "Injured Animal") {
					missionStatus.value = "🐾 ANIMAL RESCUED! RESUMING SEARCH";
				}
			}
		}
		// Rotation search mode
		else if (rotationSearchMode && currentMode.value !== "manual") {
			updateRotationSearch();
		}
		// Regular exploration patterns
		else if (exploring) {
			// Continuous collection during exploration
			for (let i = heatMeshes.length - 1; i >= 0; i--) {
				const heat = heatMeshes[i];
				const dist = Math.hypot(
					robot.position.x - heat.position.x,
					robot.position.z - heat.position.z
				);
				if (dist < COLLECTION_DISTANCE) {
					mainScene.remove(heat);
					heat.geometry.dispose();
					heat.material.dispose();
					heatMeshes.splice(i, 1);
					targetsFound.value++;
					spawnHeatSignature();
				}
			}

			// Execute search patterns
			if (currentPattern.value === "search-grid") {
				updateSearchGrid();
			} else if (currentPattern.value === "spiral-search") {
				updateSpiralSearch();
			} else if (currentPattern.value === "perimeter-sweep") {
				updatePerimeterSweep();
			} else if (currentPattern.value === "random-patrol") {
				updateRandomPatrol();
			}
		}

		renderCameras();
	}

	function renderCameras() {
		if (!mainRenderer || !mainCamera || !miniRenderer || !miniCamera)
			return;

		if (cameraMode.value === "first-person") {
			const cameraOffset = new THREE.Vector3(0, 1.2, 0.1);
			const rotatedOffset = cameraOffset
				.clone()
				.applyEuler(robot.rotation);
			mainCamera.position.copy(robot.position).add(rotatedOffset);

			const lookTarget = robot.position.clone();
			lookTarget.y += 0.5;
			const forward = new THREE.Vector3(0, 0, 1).applyEuler(
				robot.rotation
			);
			lookTarget.add(forward.multiplyScalar(5));
			mainCamera.lookAt(lookTarget);
		} else {
			const cameraOffset = new THREE.Vector3(0, 6, -10);
			const rotatedOffset = cameraOffset
				.clone()
				.applyEuler(robot.rotation);
			mainCamera.position.copy(robot.position).add(rotatedOffset);

			const lookTarget = robot.position.clone();
			lookTarget.y += 0.8;
			mainCamera.lookAt(lookTarget);
		}

		mainRenderer.render(mainScene, mainCamera);
		miniRenderer.render(mainScene, miniCamera);
	}

	onMounted(() => {
		fogCtx = miniMapFog.value.getContext("2d");
		miniMapFog.value.width = 300;
		miniMapFog.value.height = 300;
		fogCtx.fillStyle = "#111";
		fogCtx.fillRect(0, 0, 300, 300);

		const textureLoader = new THREE.TextureLoader();
		wallTexture = textureLoader.load("/assets/wall.jpg", applyMaterials);
		heatTexture = textureLoader.load("/assets/heat.jpg", applyMaterials);
		skyTexture = textureLoader.load("/assets/sky.jpg", applyMaterials);
		groundTexture = textureLoader.load(
			"/assets/ground.jpg",
			applyMaterials
		);

		setupScene();

		mainRenderer = new THREE.WebGLRenderer({
			canvas: mainCanvas.value,
			antialias: true,
		});
		mainRenderer.setSize(window.innerWidth, window.innerHeight);
		mainRenderer.shadowMap.enabled = true;

		mainCamera = new THREE.PerspectiveCamera(
			75,
			window.innerWidth / window.innerHeight,
			0.1,
			1000
		);

		miniRenderer = new THREE.WebGLRenderer({ canvas: miniMapCanvas.value });
		miniRenderer.setSize(300, 300);

		miniCamera = new THREE.OrthographicCamera(
			-fieldSize.value / 2,
			fieldSize.value / 2,
			fieldSize.value / 2,
			-fieldSize.value / 2,
			0.1,
			100
		);
		miniCamera.position.set(0, 25, 0);
		miniCamera.lookAt(0, 0, 0);
		miniCamera.up.set(0, 0, -1);

		window.addEventListener("resize", () => {
			mainRenderer.setSize(window.innerWidth, window.innerHeight);
			mainCamera.aspect = window.innerWidth / window.innerHeight;
			mainCamera.updateProjectionMatrix();
		});

		// Keyboard controls
		window.addEventListener("keydown", (e) => {
			if (currentMode.value !== "manual") return;
			if (e.key === "w" || e.key === "ArrowUp")
				manualControl.forward = true;
			if (e.key === "s" || e.key === "ArrowDown")
				manualControl.backward = true;
			if (e.key === "a" || e.key === "ArrowLeft")
				manualControl.left = true;
			if (e.key === "d" || e.key === "ArrowRight")
				manualControl.right = true;
		});

		window.addEventListener("keyup", (e) => {
			if (currentMode.value !== "manual") return;
			if (e.key === "w" || e.key === "ArrowUp")
				manualControl.forward = false;
			if (e.key === "s" || e.key === "ArrowDown")
				manualControl.backward = false;
			if (e.key === "a" || e.key === "ArrowLeft")
				manualControl.left = false;
			if (e.key === "d" || e.key === "ArrowRight")
				manualControl.right = false;
		});

		applyMaterials();
		generateMissionPlan();
		animate();
	});

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
		missionStatus,
		targetsFound,
		areaSearched,
	};
}
