const { json } = require("express");

exports.testApiEndpoint = (req, res) => {
  res.json("Hello<3");
};

exports.getCoordinatesList = (req, res) => {
  List = [
    { x: 0, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: 2 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 1, y: 2 },
    { x: 2, y: 0 },
    { x: 2, y: 1 },
    { x: 2, y: 2 },
  ];

  jsonResponse = { List: List };
  res.json(jsonResponse);
};

exports.recordCoordinate = (req, res) => {};
