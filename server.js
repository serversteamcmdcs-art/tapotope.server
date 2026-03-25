const WebSocket = require("ws");
const PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: PORT });
const rooms = {};
let nextClientId = 2;

function broadcast(room, data, excludeWs) {
  const msg = JSON.stringify(data);
  room.clients.forEach(ws => {
    if (ws !== excludeWs && ws.readyState === WebSocket.OPEN)
      ws.send(msg);
  });
  if (room.host && room.host !== excludeWs && room.host.readyState === WebSocket.OPEN)
    room.host.send(msg);
}

function sendTo(ws, data) {
  if (ws && ws.readyState === WebSocket.OPEN)
    ws.send(JSON.stringify(data));
}

function getRoomByWs(ws) {
  for (const [id, room] of Object.entries(rooms)) {
    if (room.host === ws || room.clients.has(ws)) return { id, room };
  }
  return null;
}

wss.on("connection", (ws) => {
  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    switch (msg.type) {
      case "create_room": {
        const roomId = Math.random().toString(36).substr(2, 6).toUpperCase();
        rooms[roomId] = { host: ws, clients: new Set(), players: new Map() };
        ws.roomId = roomId;
        ws.playerId = 1;
        rooms[roomId].players.set(ws, { id: 1, name: msg.name || "Хост", isHost: true });
        sendTo(ws, { type: "room_created", roomId, playerId: 1 });
        break;
      }
      case "join_room": {
        const room = rooms[msg.roomId];
        if (!room) { sendTo(ws, { type: "error", message: "Комната не найдена!" }); return; }
        const pid = nextClientId++;
        ws.roomId = msg.roomId;
        ws.playerId = pid;
        room.clients.add(ws);
        room.players.set(ws, { id: pid, name: msg.name || "Игрок", isHost: false });
        sendTo(ws, { type: "joined_room", roomId: msg.roomId, playerId: pid });
        const playerList = [];
        room.players.forEach((p) => playerList.push(p));
        sendTo(ws, { type: "player_list", players: playerList });
        broadcast(room, { type: "player_joined", player: room.players.get(ws) }, ws);
        break;
      }
      case "start_game": {
        const found = getRoomByWs(ws);
        if (!found || found.room.host !== ws) return;
        broadcast(found.room, { type: "game_started" });
        sendTo(ws, { type: "game_started" });
        break;
      }
      case "relay": {
        const found = getRoomByWs(ws);
        if (!found) return;
        msg.senderId = ws.playerId;
        broadcast(found.room, msg, ws);
        break;
      }
      case "get_rooms": {
        const roomList = Object.entries(rooms).map(([id, r]) => ({ id, playerCount: r.players.size }));
        sendTo(ws, { type: "room_list", rooms: roomList });
        break;
      }
    }
  });
  ws.on("close", () => {
    const found = getRoomByWs(ws);
    if (!found) return;
    const { id: roomId, room } = found;
    const player = room.players.get(ws);
    if (player) broadcast(room, { type: "player_left", playerId: player.id }, ws);
    room.players.delete(ws);
    room.clients.delete(ws);
    if (room.host === ws) {
      broadcast(room, { type: "host_left" });
      delete rooms[roomId];
    }
  });
});
console.log("Relay сервер запущен на порту " + PORT);
