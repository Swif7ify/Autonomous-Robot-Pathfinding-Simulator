<script setup>
import { ref } from 'vue'
import { usePathFinder } from '../composables/usePathFinder'

const mainCanvas = ref(null)
const miniMapCanvas = ref(null)
const miniMapFog = ref(null)

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
  manualControl,
  texturesEnabled,
  toggleTextures,
} = usePathFinder(mainCanvas, miniMapCanvas, miniMapFog)
</script>

<template>
  <div class="main-view">
    <div class="pattern-toggle">
      <button @click="togglePattern">Pattern: {{ currentPattern }}</button>
      <button @click="toggleMode">Mode: {{ currentMode }}</button>
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
      <label>
        <input type="checkbox" v-model="texturesEnabled" />
        Textures
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
}
.pattern-toggle button {
  font-size: 1rem;
  padding: 0.5em 1em;
  border-radius: 6px;
  border: none;
  background: #333;
  color: #fff;
  cursor: pointer;
  margin-right: 0.5em;
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
</style>
