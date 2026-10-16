
const WebSocket = require("ws");

// Player object create karne ke liye helper.
function createPlayer(id, name, socket) {
  return {
    id,
    name,
    score: 0,
    socket,
  };
}

// Room object create karne ke liye helper.
function createRoomData(id, hostId) {
  return {
    id,
    hostId,
    maxPlayers: 8,
    gameStarted: false,
    players: new Map(),
  };
}

// Player ki public details return karo.
// Socket ko client ke saath share nahi karna.
function toPublicPlayer(player) {
  return {
    id: player.id,
    name: player.name,
    score: player.score,
  };
}

// Functions ko doosri files mein use karne ke liye export karo.
module.exports = {
  createPlayer,
  createRoomData,
  toPublicPlayer,
};
