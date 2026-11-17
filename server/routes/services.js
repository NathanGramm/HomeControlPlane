const express = require('express');
const services = require('../config/services.json');

const router = express.Router();

// GET /api/services -> the tile list, straight from config/services.json.
// Edit that file (name/url/directUrl/category) to match your actual hostnames —
// nothing here needs a code change to add or rename a tile.
router.get('/', (req, res) => {
  res.json(services);
});

module.exports = router;
