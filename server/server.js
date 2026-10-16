
const http = require("http");
const WebSocket = require("ws");
const app = require("./src/app");

const {
  createRoom,
  joinRoom,
  getRoom,
  getPlayer,
  sendToSocket,
  broadcastToRoom,
  sendRoomState,
  startGame,
  prepareNextTurn,
  chooseWord,
  submitGuess,
  getWinners,
  removePlayer,
  advanceTurn
} = require("./src/services/roomServices");

const PORT = Number(process.env.PORT) || 5000;
const TURN_DURATION_MS = 60_000;

const timers = new Map();
const advanceTimeouts = new Map();

// Reveal one middle letter for words up to 5 letters,
// and two middle letters for words with 6 or more letters.
function generateWordHint(word) {
  const letters = word.split("");
  const count = word.length <= 5 ? 1 : 2;
  const start = Math.floor((word.length - count) / 2);

  return letters
    .map((letter, index) =>
      index >= start && index < start + count ? letter : "_"
    )
    .join(" ");
}

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

function clearTurnTimer(roomId) {
  const timer = timers.get(roomId);

  if (timer) {
    clearTimeout(timer);
    timers.delete(roomId);
  }
}

function clearAdvanceTimeout(roomId) {
  const timeout = advanceTimeouts.get(roomId);

  if (timeout) {
    clearTimeout(timeout);
    advanceTimeouts.delete(roomId);
  }
}

function endGame(room) {
  clearTurnTimer(room.id);
  clearAdvanceTimeout(room.id);

  const result = getWinners(room);

  broadcastToRoom(room, {
    type: "game_over",
    winners: result.winners,
    leaderboard: result.players,
    highestScore: result.highestScore
  });

  sendRoomState(room);
}

/*
 * Broadcast a turn that has already been prepared.
 * Do not call prepareNextTurn() again here.
 */
function broadcastPreparedTurn(room, turn) {
  if (!room || !turn || room.gameOver) {
    if (room) endGame(room);
    return;
  }

  clearTurnTimer(room.id);
  clearAdvanceTimeout(room.id);

  const { drawer, wordOptions } = turn;

  broadcastToRoom(room, {
    type: "next_turn",
    drawerId: drawer.id,
    drawerName: drawer.name,
    duration: TURN_DURATION_MS / 1000,
    turnNumber: room.turnsCompleted + 1,
    totalTurns: room.totalTurns,
    wordLength: null
  });

  sendToSocket(drawer.socket, {
    type: "word_options",
    words: wordOptions
  });

  broadcastToRoom(room, {
    type: "drawing_cleared"
  });

  sendRoomState(room);
}

/*
 * Prepare the initial turn.
 */
function startTurn(room) {
  clearTurnTimer(room.id);
  clearAdvanceTimeout(room.id);

  const turn = prepareNextTurn(room);

  if (!turn) {
    endGame(room);
    return;
  }

  broadcastPreparedTurn(room, turn);
}

/*
 * Advance exactly once, then broadcast the prepared turn.
 */
function scheduleNextTurn(room, delay = 1500) {
  if (!room) return;

  clearTurnTimer(room.id);
  clearAdvanceTimeout(room.id);

  const timeout = setTimeout(() => {
    advanceTimeouts.delete(room.id);

    const currentRoom = getRoom(room.id);

    if (!currentRoom || currentRoom.gameOver) {
      return;
    }

    const nextTurn = advanceTurn(currentRoom);

    if (!nextTurn) {
      endGame(currentRoom);
      return;
    }

    broadcastPreparedTurn(currentRoom, nextTurn);
  }, delay);

  advanceTimeouts.set(room.id, timeout);
}

function startSelectedWordTimer(room) {
  clearTurnTimer(room.id);

  const timer = setTimeout(() => {
    timers.delete(room.id);

    const currentRoom = getRoom(room.id);

    if (
      !currentRoom ||
      currentRoom.gameOver ||
      currentRoom.turnComplete
    ) {
      return;
    }

    currentRoom.turnComplete = true;

    broadcastToRoom(currentRoom, {
      type: "turn_ended",
      reason: "time",
      word: currentRoom.currentWord
    });

    scheduleNextTurn(currentRoom);
  }, TURN_DURATION_MS);

  timers.set(room.id, timer);
}

function handleMessage(socket, message) {
  const roomId = socket.roomId;
  const playerId = socket.playerId;

  if (message.type === "create_room") {
    if (roomId) {
      throw new Error("You are already in a room.");
    }

    const { room, player } = createRoom(socket);

    socket.roomId = room.id;
    socket.playerId = player.id;

    sendToSocket(socket, {
      type: "room_created",
      roomId: room.id,
      playerId: player.id,
      playerName: player.name,
      hostId: room.hostId
    });

    sendRoomState(room);
    return;
  }

  if (message.type === "join_room") {
    if (roomId) {
      throw new Error("You are already in a room.");
    }

    const { room, player } = joinRoom(message.roomId, socket);

    socket.roomId = room.id;
    socket.playerId = player.id;

    sendToSocket(socket, {
      type: "room_joined",
      roomId: room.id,
      playerId: player.id,
      playerName: player.name,
      hostId: room.hostId
    });

    sendRoomState(room);
    return;
  }

  if (!roomId || !playerId) {
    throw new Error("Create or join a room first.");
  }

  const room = getRoom(roomId);
  const player = getPlayer(room, playerId);

  if (!room || !player || player.socket !== socket) {
    throw new Error("Room session not found. Please rejoin.");
  }

  if (message.type === "start_game") {
    startGame(room, playerId);

    broadcastToRoom(room, {
      type: "game_started"
    });

    startTurn(room);
    return;
  }

  if (message.type === "select_word") {
    const word = chooseWord(room, playerId, message.word);

    // Only the hint is broadcast to everyone.
    // The actual secret word is sent only to the drawer below.
    broadcastToRoom(room, {
      type: "word_selected",
      drawerId: playerId,
      drawerName: player.name,
      wordLength: word.length,
      wordHint: generateWordHint(word),
      duration: TURN_DURATION_MS / 1000
    });

    sendToSocket(socket, {
      type: "your_word",
      word
    });

    startSelectedWordTimer(room);
    return;
  }

  if (message.type === "draw") {
    if (
      !room.gameStarted ||
      room.gameOver ||
      room.currentDrawerId !== playerId ||
      !room.currentWord ||
      room.turnComplete
    ) {
      return;
    }

    if (
      !message.stroke ||
      !Array.isArray(message.stroke.points)
    ) {
      return;
    }

    broadcastToRoom(room, {
      type: "draw",
      playerId,
      stroke: message.stroke
    });

    return;
  }

  if (message.type === "clear_canvas") {
    if (
      room.currentDrawerId !== playerId ||
      !room.currentWord ||
      room.turnComplete
    ) {
      return;
    }

    broadcastToRoom(room, {
      type: "drawing_cleared"
    });

    return;
  }

  if (message.type === "guess") {
    const guess = String(message.guess || "").trim();

    if (!guess) return;

    const result = submitGuess(room, playerId, guess);

    if (result.ignored) return;

    if (result.correct) {
      clearTurnTimer(room.id);

      broadcastToRoom(room, {
        type: "correct_guess",
        playerId: result.player.id,
        playerName: result.player.name,
        drawerId: result.drawer?.id,
        drawerName: result.drawer?.name,
        word: result.word,
        guesserPoints: 10,
        drawerPoints: 5
      });

      sendRoomState(room);
      scheduleNextTurn(room, 1800);
      return;
    }

    broadcastToRoom(room, {
      type: "guess_message",
      playerId: player.id,
      playerName: player.name,
      guess
    });

    return;
  }

  if (message.type === "chat") {
    const text = String(message.text || "").trim().slice(0, 250);

    if (!text) return;

    broadcastToRoom(room, {
      type: "chat_message",
      playerId: player.id,
      playerName: player.name,
      text
    });
  }
}

wss.on("connection", (socket) => {
  sendToSocket(socket, {
    type: "welcome",
    message: "Connected to DoodleDash"
  });

  socket.on("message", (raw) => {
    try {
      const message = JSON.parse(raw.toString());

      if (!message || typeof message.type !== "string") {
        throw new Error("Invalid message.");
      }

      handleMessage(socket, message);
    } catch (error) {
      sendToSocket(socket, {
        type: "error",
        message: error.message || "Something went wrong."
      });
    }
  });

  socket.on("close", () => {
    const roomId = socket.roomId;

    if (!roomId) return;

    const roomBeforeRemoval = getRoom(roomId);

    const wasDrawer =
      roomBeforeRemoval?.currentDrawerId === socket.playerId;

    const room = removePlayer(roomId, socket);

    if (!room) {
      clearTurnTimer(roomId);
      clearAdvanceTimeout(roomId);
      return;
    }

    broadcastToRoom(room, {
      type: "player_left",
      message: "A player left the room."
    });

    if (room.gameOver) {
      endGame(room);
      return;
    }

    sendRoomState(room);

    if (wasDrawer && room.gameStarted) {
      scheduleNextTurn(room);
    }
  });

  socket.on("error", (error) => {
    console.error("WebSocket error:", error.message);
  });
});

server.listen(PORT, () => {
  console.log(
    `DoodleDash HTTP + WebSocket server running on port ${PORT}`
  );
});
