const path = require('path');
const express = require('express');

const systemRoutes = require('./routes/system');
const serviceRoutes = require('./routes/services');

const app = express();
const PORT = process.env.PORT || 3000;

// No login logic here on purpose: auth is handled one layer up, by Nginx
// Proxy Manager's basic auth in front of this container. This app only
// ever expects to be reached through NPM, over Tailscale.

app.use('/api/system', systemRoutes);
app.use('/api/services', serviceRoutes);

app.use(express.static(path.join(__dirname, '..', 'public')));

app.listen(PORT, () => {
  console.log(`Home Control Plane listening on :${PORT}`);
});
