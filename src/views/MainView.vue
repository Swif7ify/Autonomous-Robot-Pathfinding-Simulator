<script setup>
import { ref, defineAsyncComponent } from 'vue'
const AsyncComponent = defineAsyncComponent(() => import('@/components/AsyncComponent.vue'))

const message = ref('Hello from script setup!')
</script>

<template>
  <h1>Hello World</h1>
  <h2>{{ message }}</h2>
  <AsyncComponent />
</template>

<style scoped>
/* Styles for MainView */
</style>

<!-- or -->

<style scoped src="@/assets/styles/main.css"></style>
