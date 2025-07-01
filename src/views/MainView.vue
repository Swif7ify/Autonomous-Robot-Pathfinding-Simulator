<script setup>
import { ref } from "vue";
import { usePathFinder } from "../composables/usePathFinder";

const mainCanvas = ref(null);
const miniMapCanvas = ref(null);
const miniMapFog = ref(null);

const {
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
} = usePathFinder(mainCanvas, miniMapCanvas, miniMapFog);
</script>

<template>
	<div class="main-view">
		<!-- Pattern toggle buttons -->
		<div class="pattern-toggle">
			<button @click="togglePattern">
				Pattern: {{ currentPattern }}
			</button>
			<button @click="toggleMode">Mode: {{ currentMode }}</button>
			<button @click="toggleCameraMode">Camera: {{ cameraMode }}</button>
		</div>

		<div class="settings-panel">
			<!-- Camera Settings -->
			<div class="settings-group">
				<h3>Camera Settings</h3>
				<label>
					<input type="checkbox" v-model="advancedHeatSearch" />
					Advanced Heat Search (X-Ray Vision)
				</label>
			</div>

			<!-- LiDAR Settings -->
			<div class="settings-group">
				<h3>LiDAR Settings</h3>
				<label>
					Radius:
					<input
						type="range"
						min="2"
						max="25"
						step="0.5"
						v-model.number="lidarRadius"
					/>
					{{ lidarRadius }}m
				</label>
				<label>
					Rays:
					<input
						type="range"
						min="8"
						max="180"
						step="4"
						v-model.number="lidarNumRays"
					/>
					{{ lidarNumRays }}
				</label>
				<label>
					FOV:
					<input
						type="range"
						min="0.2"
						max="3.14"
						step="0.01"
						v-model.number="lidarFov"
					/>
					{{ ((lidarFov * 180) / Math.PI).toFixed(0) }}°
				</label>
			</div>

			<!-- Environment Settings -->
			<div class="settings-group">
				<h3>Environment</h3>
				<label>
					Field Size:
					<span class="field-controls">
						<button
							@click="decreaseFieldSize"
							:disabled="fieldSize <= 20"
						>
							-
						</button>
						<span>{{ fieldSize }}m</span>
						<button @click="increaseFieldSize">+</button>
					</span>
				</label>
				<label>
					Obstacles:
					<input
						type="range"
						min="0"
						max="10"
						step="1"
						v-model.number="numObstacles"
					/>
					{{ numObstacles }}
				</label>
				<button @click="spawnMoreObstacles" class="spawn-btn">
					Respawn Obstacles
				</button>
				<label>
					<input type="checkbox" v-model="texturesEnabled" />
					Textures
				</label>
			</div>

			<!-- Heat Detection -->
			<div class="settings-group">
				<h3>Heat Detection</h3>
				<label>
					Heat Objects:
					<input
						type="range"
						min="0"
						max="15"
						step="1"
						v-model.number="numHeatObjects"
					/>
					{{ numHeatObjects }}
				</label>
				<button @click="spawnMoreHeat" class="spawn-btn">
					Respawn Heat Objects
				</button>

				<div class="heat-status" :class="{ detected: heatDetected }">
					Heat Detected: {{ heatDetected ? "YES" : "NO" }}
				</div>

				<div
					v-if="detectedHeatTypes.length > 0"
					class="detected-heat-types"
				>
					<h4>Detected Heat Signatures:</h4>
					<div
						v-for="heatType in detectedHeatTypes"
						:key="heatType"
						class="heat-type"
					>
						{{ heatType }}
					</div>
				</div>
			</div>

			<!-- Robot Settings -->
			<div class="settings-group">
				<h3>Robot Settings</h3>
				<label>
					Speed:
					<input
						type="range"
						min="0.02"
						max="1"
						step="0.01"
						v-model.number="robotSpeed"
					/>
					{{ robotSpeed.toFixed(2) }}
				</label>
			</div>

			<!-- Controls -->
			<div class="settings-group">
				<h3>Controls</h3>
				<button @click="resetSimulation" class="reset-btn">
					Reset Simulation
				</button>
				<div class="manual-controls" v-if="currentMode === 'manual'">
					<p>Manual Controls:</p>
					<div class="key-hints">
						<span>W/↑ - Forward</span>
						<span>S/↓ - Backward</span>
						<span>A/← - Turn Left</span>
						<span>D/→ - Turn Right</span>
					</div>
				</div>
			</div>
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
	position: relative;
	width: 100vw;
	height: 100vh;
	overflow: hidden;
}

.pattern-toggle {
	position: absolute;
	left: 20px;
	top: 20px;
	z-index: 10;
	display: flex;
	gap: 0.5em;
}

.pattern-toggle button {
	font-size: 1rem;
	padding: 0.5em 1em;
	border-radius: 6px;
	border: none;
	background: #333;
	color: #fff;
	cursor: pointer;
	transition: background-color 0.2s;
}

.pattern-toggle button:hover {
	background: #555;
}

.settings-panel {
	position: absolute;
	left: 20px;
	top: 80px;
	z-index: 10;
	background: #222;
	color: #fff;
	padding: 1em;
	border-radius: 8px;
	max-height: calc(100vh - 120px);
	overflow-y: auto;
	width: 280px;
}

.settings-group {
	margin-bottom: 1.5em;
	padding-bottom: 1em;
	border-bottom: 1px solid #444;
}

.settings-group:last-child {
	border-bottom: none;
	margin-bottom: 0;
}

.settings-group h3 {
	margin: 0 0 0.8em 0;
	font-size: 1.1em;
	color: #4caf50;
}

.settings-group label {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 0.5em;
	font-size: 0.9em;
	margin-bottom: 0.5em;
}

.settings-group input[type="range"] {
	flex: 1;
	margin: 0 0.5em;
}

.settings-group input[type="checkbox"] {
	margin-right: 0.5em;
}

.field-controls {
	display: flex;
	align-items: center;
	gap: 0.5em;
}

.field-controls button {
	width: 30px;
	height: 25px;
	border: none;
	background: #444;
	color: #fff;
	border-radius: 4px;
	cursor: pointer;
	font-size: 1em;
}

.field-controls button:hover:not(:disabled) {
	background: #555;
}

.field-controls button:disabled {
	background: #333;
	cursor: not-allowed;
	opacity: 0.5;
}

.spawn-btn,
.reset-btn {
	width: 100%;
	padding: 0.5em;
	border: none;
	border-radius: 4px;
	cursor: pointer;
	font-size: 0.9em;
	margin-top: 0.5em;
}

.spawn-btn {
	background: #2196f3;
	color: white;
}

.spawn-btn:hover {
	background: #1976d2;
}

.reset-btn {
	background: #f44336;
	color: white;
}

.reset-btn:hover {
	background: #d32f2f;
}

.heat-status {
	padding: 0.4em 0.8em;
	border-radius: 4px;
	text-align: center;
	font-weight: bold;
	margin-top: 0.5em;
	background: #333;
	transition: background-color 0.3s;
}

.heat-status.detected {
	background: #ff5722;
	color: white;
	animation: pulse 1s infinite;
}

@keyframes pulse {
	0%,
	100% {
		opacity: 1;
	}
	50% {
		opacity: 0.7;
	}
}

.manual-controls {
	margin-top: 0.5em;
}

.manual-controls p {
	margin: 0 0 0.5em 0;
	font-weight: bold;
}

.key-hints {
	display: flex;
	flex-direction: column;
	gap: 0.2em;
}

.key-hints span {
	font-size: 0.8em;
	padding: 0.2em 0.4em;
	background: #333;
	border-radius: 3px;
}

.main-camera {
	position: absolute;
	top: 0;
	left: 0;
	width: 100vw;
	height: 100vh;
}

.main-camera canvas {
	width: 100vw !important;
	height: 100vh !important;
	display: block;
	border: none;
}

.minimap {
	position: absolute;
	top: 20px;
	right: 20px;
	width: 300px;
	height: 300px;
	z-index: 20;
}

.minimap canvas {
	width: 300px !important;
	height: 300px !important;
	border: 2px solid #666;
	display: block;
}

.minimap-fog {
	position: absolute;
	top: 0;
	left: 0;
	pointer-events: none;
}

/* Scrollbar styling for settings panel */
.settings-panel::-webkit-scrollbar {
	width: 6px;
}

.settings-panel::-webkit-scrollbar-track {
	background: #333;
	border-radius: 3px;
}

.settings-panel::-webkit-scrollbar-thumb {
	background: #555;
	border-radius: 3px;
}

.settings-panel::-webkit-scrollbar-thumb:hover {
	background: #777;
}

.detected-heat-types {
	margin-top: 0.5em;
	padding: 0.5em;
	background: #333;
	border-radius: 4px;
}

.detected-heat-types h4 {
	margin: 0 0 0.5em 0;
	font-size: 0.9em;
	color: #4caf50;
}

.heat-type {
	padding: 0.2em 0.4em;
	margin: 0.2em 0;
	background: #444;
	border-radius: 3px;
	font-size: 0.8em;
}
</style>
