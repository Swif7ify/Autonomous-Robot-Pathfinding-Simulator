# 🚗 Path Finder Simulator

A 3D autonomous search and rescue/pathfinding simulator built with **Vue 3**, **Vite**, and **Three.js**.  
Simulate robot navigation, LiDAR scanning, and AI-driven search patterns in a dynamic environment.

---

## ✨ Features

- **Multiple Search Patterns:**

    - Grid Search
    - Spiral Search
    - Perimeter Sweep
    - Random Patrol

- **Modes:**

    - Auto (systematic exploration)
    - Manual (keyboard control)
    - Search & Rescue (aggressive heat-seeking)

- **Realistic LiDAR Simulation:**

    - Adjustable range, FOV, and ray count
    - Visualizes clear, blocked, and heat-detected paths

- **Dynamic Obstacles & Heat Sources:**

    - Human survivors, animals, fire, vehicles, electronics
    - Randomized placement and respawn

- **Fog of War:**

    - Robot clears fog as it explores
    - Mini-map with real-time updates

- **AI Pathfinding:**
    - Smart direction selection
    - Avoids obstacles, prioritizes unexplored areas and heat targets

---

## 🖥️ Recommended IDE Setup

- [VSCode](https://code.visualstudio.com/)
- [Volar](https://marketplace.visualstudio.com/items?itemName=Vue.volar) (disable Vetur)

---

## 🚀 Getting Started

### 1. Install dependencies

```sh
npm install
```

### 2. Start the development server

```sh
npm run dev
```

### 3. Build for production

```sh
npm run build
```

---

## 🎮 Controls

- **Manual Mode:**

    - `WASD` or Arrow Keys to move/turn the robot

- **Switch Modes/Patterns:**

    - Use UI buttons to toggle between search patterns and modes

- **Camera:**
    - Toggle first-person/third-person view

---

## 🛠️ Customization

- Change field size, number of obstacles, and heat objects from the UI
- Adjust LiDAR parameters (range, FOV, rays)
- Add your own textures in `/assets/`

---

## 📂 Project Structure

```
src/
  composables/
    usePathFinder.js   # Main robot logic, AI, and simulation
  assets/              # Textures for walls, ground, sky, heat
  components/          # Vue UI components
public/
  index.html           # App entry point
```

---

## 📖 References

- [Vue 3 Documentation](https://vuejs.org/)
- [Vite Documentation](https://vite.dev/)
- [Three.js Documentation](https://threejs.org/docs/)

---

## 🧑‍💻 Author

Made by Ordovez, Earl & Cordova Paulo.  
Feel free to fork, contribute, or open issues!

---
