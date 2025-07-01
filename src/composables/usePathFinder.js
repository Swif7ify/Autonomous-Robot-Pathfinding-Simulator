import { ref, onMounted, watch } from "vue";
import * as THREE from "three";

export function usePathFinder(mainCanvas, miniMapCanvas, miniMapFog) {
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
	const lidarRadius = ref(15);
	const lidarNumRays = ref(140);
	const lidarFov = ref(Math.PI / 1.5);
	const texturesEnabled = ref(false);
	const heatDetected = ref(false);
	const numHeatObjects = ref(4);
	const robotSpeed = ref(0.15);

	// Advanced features
	const cameraMode = ref("first-person");
	const advancedHeatSearch = ref(false);
	const numObstacles = ref(4);
	const detectedHeatTypes = ref([]);
	const missionStatus = ref("SEARCHING");
	const targetsFound = ref(0);
	const areaSearched = ref(0);

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
			priority: 3,
		},
		{
			name: "Vehicle Heat",
			color: 0xff8800,
			emissive: 0xff4400,
			temp: 85,
			size: 0.9,
			priority: 4,
		},
		{
			name: "Electronic Device",
			color: 0xffff00,
			emissive: 0xffaa00,
			temp: 45,
			size: 0.5,
			priority: 5,
		},
	];

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

	// heat response system**
	let priorityTarget = null;
	let targetLockOn = false;
	let heatDetectionRange = 20;
	let lastHeatScanTime = 0;

	// LiDAR coverage**
	let rotationSearchMode = false;
	let rotationTarget = 0;
	let noPathTimer = 0;
	let lastRotationTime = 0;

	// Optimized geometries
	let lidarPointGeometry = new THREE.SphereGeometry(0.06, 8, 8);
	let heatPointGeometry = new THREE.SphereGeometry(0.12, 8, 8);
	let lidarPointMaterial = new THREE.MeshBasicMaterial({ color: 0x00ffff });
	let wallPointMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 });
	let obstaclePointMaterial = new THREE.MeshBasicMaterial({
		color: 0xffff00,
	});
	let heatPointMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 });
	let priorityHeatMaterial = new THREE.MeshBasicMaterial({ color: 0xff00ff });

	// Performance optimization
	let heatDetectionCooldown = 0;
	let lastHeatDetectionTime = 0;

	// responsive movement**
	let targetPosition = { x: 0, z: 0 };
	let targetRotation = 0;
	let smoothingFactor = 0.25;

	// Multi-layer navigation system**
	let lidarData = {
		clearDirections: [],
		blockedDirections: [],
		heatDirections: [],
		emergencyExits: [],
		bestPaths: [],
		humanDetections: [],
	};

	// Mission planning
	let missionData = {
		searchPattern: null,
		waypoints: [],
		currentWaypoint: 0,
		priority: "search",
		rescueTargets: [],
		completedAreas: new Set(),
	};

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

		// manual override
		if (currentMode.value === "manual") {
			seekingHeat = false;
			exploring = false;
			avoidanceMode = false;
			emergencyManeuver = false;
			targetLockOn = false;
			priorityTarget = null;
			rotationSearchMode = false;
			missionStatus.value = "MANUAL CONTROL";
		} else {
			exploring = true;
			missionStatus.value = "SEARCHING";
			generateMissionPlan();
		}
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

	function generateMissionPlan() {
		const fs = fieldSize.value;
		missionData.waypoints = [];
		searchGrid = [];

		if (currentPattern.value === "search-grid") {
			const gridSize = 5;
			for (let x = -fs / 2 + 3; x < fs / 2 - 3; x += gridSize) {
				for (let z = -fs / 2 + 3; z < fs / 2 - 3; z += gridSize) {
					if (!isBlocked(x, z)) {
						searchGrid.push({ x, z, searched: false });
					}
				}
			}
		} else if (currentPattern.value === "perimeter-sweep") {
			const margin = 4;
			for (let i = 0; i < 360; i += 20) {
				const angle = (i * Math.PI) / 180;
				const radius = fs / 2 - margin;
				const x = Math.cos(angle) * radius;
				const z = Math.sin(angle) * radius;
				if (!isBlocked(x, z)) {
					missionData.waypoints.push({ x, z });
				}
			}
		}

		currentGridIndex = 0;
		missionData.currentWaypoint = 0;
		areaSearched.value = 0;
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

		const robotX = (Math.random() - 0.5) * (fs - 6);
		const robotZ = (Math.random() - 0.5) * (fs - 6);
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

	function scanForImmedateThreats() {
		const currentTime = Date.now();
		if (currentTime - lastHeatScanTime < 30) return;

		lastHeatScanTime = currentTime;
		let humanDetected = false;
		let priorityHeatDetected = false;
		let closestPriorityTarget = null;
		let closestDistance = Infinity;

		for (const heat of heatMeshes) {
			const dist = Math.hypot(
				robot.position.x - heat.position.x,
				robot.position.z - heat.position.z
			);

			// consider heat objects within reasonable detection range
			if (dist > heatDetectionRange) continue;

			// Check if this heat object is visible to LiDAR (optional for closer objects)
			let heatVisibleToLidar = false;

			// If heat is very close, always consider it visible
			if (dist < 5) {
				heatVisibleToLidar = true;
			} else {
				// For distant objects, require LiDAR visibility
				for (const direction of lidarData.heatDirections) {
					const heatAngle = Math.atan2(
						heat.position.x - robot.position.x,
						heat.position.z - robot.position.z
					);

					if (Math.abs(direction.angle - heatAngle) < Math.PI / 4) {
						// More lenient angle
						heatVisibleToLidar = true;
						break;
					}
				}
			}

			// Only skip if heat is far AND not visible to LiDAR
			if (!heatVisibleToLidar && dist > 5) {
				continue;
			}

			// PRIORITY SYSTEM (fixed)
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

		// INSTANT RESPONSE TO PRIORITY DETECTION
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
					missionStatus.value = `🚨 HUMAN DETECTED! DISTANCE: ${closestDistance.toFixed(1)}m`;
				} else if (targetType === "Injured Animal") {
					missionStatus.value = `🐾 ANIMAL DETECTED! DISTANCE: ${closestDistance.toFixed(1)}m`;
				}
			}
		}
	}

	// FIXED: Enhanced LiDAR scan with proper heat detection
	function performLidarScan() {
		lidarGroup.clear();

		const fov = lidarFov.value;
		const numRays = lidarNumRays.value;
		const radius = lidarRadius.value;
		const robotYaw = robot.rotation.y;
		let heatFound = false;
		const detectedHeats = new Set();
		const currentTime = Date.now();

		if (currentTime - lastHeatDetectionTime < 60) {
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

				// Efficient fog clearing
				if (r % 0.3 < stepSize) {
					const [rx, rz] = worldToMiniMap(x, z);
					fogCtx.save();
					fogCtx.globalCompositeOperation = "destination-out";
					fogCtx.beginPath();
					fogCtx.arc(rx, rz, 10, 0, 2 * Math.PI);
					fogCtx.fill();
					fogCtx.restore();
				}

				// Enhanced heat detection
				if (!hitObstacle || advancedHeatSearch.value) {
					for (const heat of heatMeshes) {
						const heatDist = Math.hypot(
							x - heat.position.x,
							z - heat.position.z
						);
						if (heatDist < 2.5) {
							// Increased detection radius
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
							} else if (lidarGroup.children.length < 80) {
								const heatPoint = new THREE.Mesh(
									heatPointGeometry,
									heatPointMaterial
								);
								heatPoint.position.set(
									heat.position.x,
									0.3,
									heat.position.z
								);
								lidarGroup.add(heatPoint);
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

		// ALWAYS check for nearby heat (within close range)
		for (const heat of heatMeshes) {
			const dist = Math.hypot(
				robot.position.x - heat.position.x,
				robot.position.z - heat.position.z
			);

			// If heat is very close, always detect it
			if (dist < 8) {
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
				rotationTarget = robot.rotation.y + Math.PI / 4; // Rotate 45 degrees
				noPathTimer = 0;
				missionStatus.value = "NO CLEAR PATH - ROTATING TO SCAN";
			}
		} else if (lidarData.clearDirections.length > 0) {
			noPathTimer = 0;
			if (rotationSearchMode) {
				rotationSearchMode = false;
				missionStatus.value = "CLEAR PATH FOUND - RESUMING MOVEMENT";
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

	// movement Functions
	function smoothMovement() {
		// Check if stuck
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

		// Enhanced smooth interpolation
		robot.position.x +=
			(targetPosition.x - robot.position.x) * smoothingFactor;
		robot.position.z +=
			(targetPosition.z - robot.position.z) * smoothingFactor;

		let rotDiff = targetRotation - robot.rotation.y;
		if (rotDiff > Math.PI) rotDiff -= 2 * Math.PI;
		if (rotDiff < -Math.PI) rotDiff += 2 * Math.PI;
		robot.rotation.y += rotDiff * smoothingFactor;
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

	// Improved pathfinding with better direction selection
	function findBestDirection() {
		// PRIORITY 1: Human detection directions
		if (lidarData.humanDetections.length > 0) {
			return lidarData.humanDetections[0].angle;
		}

		// PRIORITY 2: Heat directions (if in search mode)
		if (
			lidarData.heatDirections.length > 0 &&
			(currentMode.value === "search-rescue" || seekingHeat)
		) {
			return lidarData.heatDirections[0].angle;
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

		// If truly no clear paths, just rotate slightly
		return robot.rotation.y + Math.PI / 6; // Rotate 30 degrees
	}

	function findAvoidanceDirection() {
		return findBestDirection();
	}

	// Improved rotation search with faster response
	function updateRotationSearch() {
		const currentTime = Date.now();

		// Rotate towards target rotation
		let rotDiff = rotationTarget - robot.rotation.y;
		if (rotDiff > Math.PI) rotDiff -= 2 * Math.PI;
		if (rotDiff < -Math.PI) rotDiff += 2 * Math.PI;

		targetRotation = robot.rotation.y + rotDiff * 0.15; // Faster rotation

		// Check if rotation complete or clear path found
		if (Math.abs(rotDiff) < 0.1 || lidarData.clearDirections.length > 2) {
			if (currentTime - lastRotationTime > 1000) {
				// Reduced wait time
				lastRotationTime = currentTime;

				if (lidarData.clearDirections.length > 0) {
					rotationSearchMode = false;
					exploring = true;
					missionStatus.value =
						"CLEAR PATH FOUND - RESUMING MOVEMENT";
				} else {
					rotationTarget += Math.PI / 3; // Rotate another 60 degrees
					missionStatus.value = "CONTINUING ROTATION SCAN...";
				}
			}
		}
	}

	// Enhanced search patterns
	function updateSearchGrid() {
		if (currentGridIndex >= searchGrid.length) {
			missionStatus.value = "GRID SEARCH COMPLETE";
			exploring = false;
			return;
		}

		const target = searchGrid[currentGridIndex];
		const distance = Math.hypot(
			robot.position.x - target.x,
			robot.position.z - target.z
		);

		if (distance < 2) {
			target.searched = true;
			currentGridIndex++;
			areaSearched.value = Math.round(
				(currentGridIndex / searchGrid.length) * 100
			);
			missionStatus.value = `SEARCHING... ${areaSearched.value}% COMPLETE`;
		}

		if (currentGridIndex < searchGrid.length) {
			const nextTarget = searchGrid[currentGridIndex];
			const angle = Math.atan2(
				nextTarget.x - robot.position.x,
				nextTarget.z - robot.position.z
			);

			const targetDirection = lidarData.clearDirections.find(
				(dir) => Math.abs(dir.angle - angle) < Math.PI / 3
			);

			if (targetDirection) {
				const nextX =
					robot.position.x +
					Math.sin(targetDirection.angle) * robotSpeed.value;
				const nextZ =
					robot.position.z +
					Math.cos(targetDirection.angle) * robotSpeed.value;
				updateTargetPosition(nextX, nextZ, targetDirection.angle);
			} else {
				const bestDir = findBestDirection();
				const nextX =
					robot.position.x + Math.sin(bestDir) * robotSpeed.value;
				const nextZ =
					robot.position.z + Math.cos(bestDir) * robotSpeed.value;
				updateTargetPosition(nextX, nextZ, bestDir);
			}
		}
	}

	function updateSpiralSearch() {
		if (!spiralState) {
			spiralState = {
				angle: 0,
				radius: 2,
				center: { x: robot.position.x, z: robot.position.z },
				radiusGrowth: 0.05,
			};
		}

		spiralState.angle += 0.08;
		spiralState.radius += spiralState.radiusGrowth;

		const nextX =
			spiralState.center.x +
			Math.cos(spiralState.angle) * spiralState.radius;
		const nextZ =
			spiralState.center.z +
			Math.sin(spiralState.angle) * spiralState.radius;

		const targetAngle = Math.atan2(
			nextX - robot.position.x,
			nextZ - robot.position.z
		);
		const directionClear = lidarData.clearDirections.some(
			(dir) =>
				Math.abs(dir.angle - targetAngle) < Math.PI / 2.5 &&
				dir.distance > 2.5
		);

		if (directionClear && !isBlocked(nextX, nextZ)) {
			updateTargetPosition(nextX, nextZ, targetAngle);
		} else {
			const escapeDirection = findBestDirection();
			const moveDistance = robotSpeed.value * 3;
			const newX =
				robot.position.x + Math.sin(escapeDirection) * moveDistance;
			const newZ =
				robot.position.z + Math.cos(escapeDirection) * moveDistance;

			if (!isBlocked(newX, newZ)) {
				updateTargetPosition(newX, newZ, escapeDirection);
			}

			spiralState = {
				angle: 0,
				radius: 1.5,
				center: { x: robot.position.x, z: robot.position.z },
				radiusGrowth: 0.05,
			};
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

		if (distance < 2.5) {
			missionData.currentWaypoint++;
			const progress = Math.round(
				(missionData.currentWaypoint / missionData.waypoints.length) *
					100
			);
			missionStatus.value = `PERIMETER SWEEP... ${progress}% COMPLETE`;
		}

		if (missionData.currentWaypoint < missionData.waypoints.length) {
			const target = missionData.waypoints[missionData.currentWaypoint];
			const angle = Math.atan2(
				target.x - robot.position.x,
				target.z - robot.position.z
			);

			const bestDirection = findBestDirection();
			const nextX =
				robot.position.x + Math.sin(bestDirection) * robotSpeed.value;
			const nextZ =
				robot.position.z + Math.cos(bestDirection) * robotSpeed.value;
			updateTargetPosition(nextX, nextZ, bestDirection);
		}
	}

	function updateRandomPatrol() {
		if (!randomWalkState || randomWalkState.steps <= 0) {
			const bestDirection = findBestDirection();
			randomWalkState = {
				angle: bestDirection,
				steps: Math.floor(50 + Math.random() * 70),
			};
		}

		const nextX =
			robot.position.x +
			Math.sin(randomWalkState.angle) * robotSpeed.value;
		const nextZ =
			robot.position.z +
			Math.cos(randomWalkState.angle) * robotSpeed.value;

		const directionClear = lidarData.clearDirections.some(
			(dir) =>
				Math.abs(dir.angle - randomWalkState.angle) < Math.PI / 3 &&
				dir.distance > 2
		);

		if (directionClear && !isBlocked(nextX, nextZ)) {
			updateTargetPosition(nextX, nextZ, randomWalkState.angle);
			randomWalkState.steps--;
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

					const targetType = heat.userData.heatType;
					break;
				}
			}
		} else if (
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
						priorityTarget.userData.heatType === "Human Survivor"
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
					missionStatus.value = `🚨 APPROACHING HUMAN - ${distance.toFixed(1)}m`;
				} else if (targetType === "Injured Animal") {
					missionStatus.value = `🐾 APPROACHING ANIMAL - ${distance.toFixed(1)}m`;
				} else {
					missionStatus.value = `🎯 APPROACHING ${targetType} - ${distance.toFixed(1)}m`;
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
				} else {
					missionStatus.value = `✅ ${targetType} COLLECTED! RESUMING SEARCH`;
				}
			}
		} else if (rotationSearchMode && currentMode.value !== "manual") {
			updateRotationSearch();
		} else if (exploring) {
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

					const targetType = heat.userData.heatType;
				}
			}

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
