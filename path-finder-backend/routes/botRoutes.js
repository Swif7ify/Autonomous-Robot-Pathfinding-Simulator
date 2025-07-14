const express = require("express");
const router = express.Router();
const botController = require("../controllers/bot.controller");

router.get("/test", botController.testApiEndpoint);
router.get("/coordinates/get", botController.getCoordinatesList);
router.post("/coordinates/add", botController.recordCoordinate);

module.exports = router;
