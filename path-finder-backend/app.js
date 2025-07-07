const express = require("express");
const cors = require("cors");
const app = express();

app.use(cors());
app.use(express.json()); // for parsing application/json

// Routes
// const indexRouter = require("./routes/index");
const botRouter = require("./routes/botRoutes");

// app.use("/", indexRouter);
app.use("/bot", botRouter);

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: "Something broke!" });
});

module.exports = app;
