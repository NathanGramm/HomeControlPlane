const path = require('path');
const express = require('express');

const systemRoutes = require('./routes/system');
const serviceRoutes = require('./routes/services');
const minecraftRoutes = require('./routes/minecraft');
const fireflyRoutes = require('./routes/firefly');
const questRoutes = require('./routes/quests');
const piholeRoutes = require('./routes/pihole');
const jellyfinRoutes = require('./routes/jellyfin');

const app = express();
const PORT = process.env.PORT || 3000;

// No login logic here on purpose: auth is handled one layer up, by Nginx
// Proxy Manager's basic auth in front of this container. This app only
// ever expects to be reached through NPM, over Tailscale.

app.use('/api/system', systemRoutes);
app.use('/api/services', serviceRoutes);
app.use('/api/minecraft', minecraftRoutes);
app.use('/api/firefly', fireflyRoutes);
app.use('/api/quests', questRoutes);
app.use('/api/pihole', piholeRoutes);
app.use('/api/jellyfin', jellyfinRoutes);

app.use(express.static(path.join(__dirname, '..', 'public')));

app.listen(PORT, () => {
  console.log(`Home Control Plane listening on :${PORT}`);
});
