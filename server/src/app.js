
const express = require("express");
const cors = require("cors");

const app = express();

app.use(
  cors({
    origin: "http://localhost:5173"
  })
);

app.use(express.json());

app.get("/", (req, res) => {
  res.send("DoodleDash backend is running!");
});

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "DoodleDash server is healthy"
  });
});

module.exports = app;
