const locationStore = {
  markers: [],

  addMarker(marker) {
    this.markers.push(marker);
  },

  getMarkers() {
    return this.markers;
  },

  clearMarkers() {
    this.markers = [];
  },
};

module.exports = locationStore;
