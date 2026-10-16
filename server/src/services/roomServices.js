
const { randomUUID } = require("crypto");

const rooms = new Map();

const MAX_PLAYERS = 8;
const ROUNDS_PER_PLAYER = 1;

const WORDS = [
  "apple",
  "rocket",
  "elephant",
  "football",
  "rainbow",
  "computer",
  "butterfly",
  "pizza",
  "airplane",
  "guitar",
  "mountain",
  "turtle",
  "sunflower",
  "camera",
  "dinosaur",
  "umbrella",
  "basketball",
  "watermelon",
  "lighthouse",
  "helicopter",
  "toothbrush",
  "snowman",
  "octopus",
  "train",
  "crown",
  "castle",
  "pineapple",
  "volcano",
  "keyboard",
  "penguin"
];

// -------------------- ROOM CREATION --------------------

function generateRoomId() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let roomId;

  do {
    roomId = Array.from(
      { length: 6 },
      () => chars[Math.floor(Math.random() * chars.length)]
    ).join("");
  } while (rooms.has(roomId));

  return roomId;
}

function createPlayer(socket, index) {
  return {
    id: randomUUID(),
    name: `Player ${index + 1}`,
    score: 0,
    socket,
    hasGuessed: false
  };
}

function createRoom(socket) {
  const roomId = generateRoomId();
  const player = createPlayer(socket, 0);

  const room = {
    id: roomId,
    hostId: player.id,
    players: [player],

    gameStarted: false,
    gameOver: false,

    currentDrawerId: null,
    currentWord: null,
    wordOptions: [],

    turnIndex: 0,
    turnsCompleted: 0,
    totalTurns: 0,
    roundsPerPlayer: ROUNDS_PER_PLAYER,

    turnComplete: false,
    strokes: []
  };

  rooms.set(roomId, room);

  return { room, player };
}

function joinRoom(roomId, socket) {
  const normalizedRoomId = String(roomId || "")
    .trim()
    .toUpperCase();

  const room = rooms.get(normalizedRoomId);

  if (!room) {
    throw new Error("Room not found. Check the Room ID.");
  }

  if (room.gameStarted || room.gameOver) {
    throw new Error("This game has already started.");
  }

  if (room.players.length >= MAX_PLAYERS) {
    throw new Error("This room is full.");
  }

  const player = createPlayer(socket, room.players.length);

  room.players.push(player);

  return { room, player };
}

// -------------------- ROOM HELPERS --------------------

function getRoom(roomId) {
  return rooms.get(roomId);
}

function getPlayer(room, playerId) {
  return room?.players.find(
    (player) => player.id === playerId
  );
}

function getPlayerBySocket(room, socket) {
  return room?.players.find(
    (player) => player.socket === socket
  );
}

function getPublicPlayers(room) {
  if (!room) return [];

  return room.players.map(
    ({ id, name, score, hasGuessed }) => ({
      id,
      name,
      score,
      hasGuessed
    })
  );
}

function sendToSocket(socket, payload) {
  if (socket && socket.readyState === 1) {
    socket.send(JSON.stringify(payload));
  }
}

function broadcastToRoom(room, payload) {
  if (!room) return;

  const data = JSON.stringify(payload);

  room.players.forEach((player) => {
    if (player.socket?.readyState === 1) {
      player.socket.send(data);
    }
  });
}

function sendRoomState(room) {
  if (!room) return;

  broadcastToRoom(room, {
    type: "player_list",
    roomId: room.id,
    hostId: room.hostId,
    players: getPublicPlayers(room),
    gameStarted: room.gameStarted,
    gameOver: room.gameOver,
    currentDrawerId: room.currentDrawerId,
    turnsCompleted: room.turnsCompleted,
    totalTurns: room.totalTurns
  });
}

// -------------------- WORD SELECTION --------------------

function getRandomWords(count = 3) {
  const shuffledWords = [...WORDS];

  for (let i = shuffledWords.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));

    [shuffledWords[i], shuffledWords[j]] = [
      shuffledWords[j],
      shuffledWords[i]
    ];
  }

  return shuffledWords.slice(0, count);
}

// -------------------- START GAME --------------------

function startGame(room, playerId) {
  if (!room) {
    throw new Error("Room not found.");
  }

  if (room.hostId !== playerId) {
    throw new Error("Only the host can start the game.");
  }

  if (room.gameStarted) {
    throw new Error("The game has already started.");
  }

  if (room.players.length < 2) {
    throw new Error("At least 2 players are needed to start.");
  }

  room.gameStarted = true;
  room.gameOver = false;

  room.turnIndex = 0;
  room.turnsCompleted = 0;
  room.totalTurns =
    room.players.length * room.roundsPerPlayer;

  room.currentDrawerId = null;
  room.currentWord = null;
  room.wordOptions = [];
  room.turnComplete = false;
  room.strokes = [];

  room.players.forEach((player) => {
    player.score = 0;
    player.hasGuessed = false;
  });

  return room.players[0];
}

// -------------------- TURN MANAGEMENT --------------------

function prepareNextTurn(room) {
  if (!room || room.gameOver) {
    return null;
  }

  if (room.turnsCompleted >= room.totalTurns) {
    room.gameOver = true;
    room.currentDrawerId = null;
    room.currentWord = null;
    room.wordOptions = [];
    room.turnComplete = true;

    return null;
  }

  if (room.players.length < 2) {
    room.gameOver = true;
    room.currentDrawerId = null;
    room.currentWord = null;
    room.wordOptions = [];
    room.turnComplete = true;

    return null;
  }

  // Keep the current turn index within the player array.
  room.turnIndex =
    ((room.turnIndex % room.players.length) +
      room.players.length) %
    room.players.length;

  const drawer = room.players[room.turnIndex];

  if (!drawer) {
    room.gameOver = true;
    return null;
  }

  room.currentDrawerId = drawer.id;
  room.currentWord = null;
  room.wordOptions = getRandomWords();
  room.turnComplete = false;
  room.strokes = [];

  room.players.forEach((player) => {
    player.hasGuessed = false;
  });

  return {
    drawer,
    wordOptions: room.wordOptions
  };
}

function chooseWord(room, playerId, word) {
  if (!room || !room.gameStarted || room.gameOver) {
    throw new Error("The game is not running.");
  }

  if (room.turnComplete) {
    throw new Error("This turn has already ended.");
  }

  if (room.currentDrawerId !== playerId) {
    throw new Error("Only the current drawer can choose a word.");
  }

  if (room.currentWord) {
    throw new Error("A word has already been selected.");
  }

  if (!room.wordOptions.includes(word)) {
    throw new Error("Choose one of the offered words.");
  }

  room.currentWord = word;

  return word;
}

// -------------------- GUESSING AND SCORING --------------------

function submitGuess(room, playerId, guess) {
  if (
    !room ||
    !room.gameStarted ||
    room.gameOver ||
    !room.currentWord ||
    room.turnComplete
  ) {
    return {
      correct: false,
      ignored: true
    };
  }

  const player = getPlayer(room, playerId);

  // Drawer cannot guess their own word.
  if (
    !player ||
    player.id === room.currentDrawerId ||
    player.hasGuessed
  ) {
    return {
      correct: false,
      ignored: true
    };
  }

  const normalizedGuess = String(guess || "")
    .trim()
    .toLowerCase();

  if (!normalizedGuess) {
    return {
      correct: false,
      ignored: true
    };
  }

  const normalizedWord = room.currentWord
    .trim()
    .toLowerCase();

  if (normalizedGuess === normalizedWord) {
    // Award points only once per player per turn.
    player.score += 10;
    player.hasGuessed = true;

    const drawer = getPlayer(
      room,
      room.currentDrawerId
    );

    if (drawer) {
      drawer.score += 5;
    }

    room.turnComplete = true;

    return {
      correct: true,
      player,
      drawer,
      word: room.currentWord
    };
  }

  return {
    correct: false,
    ignored: false,
    player
  };
}

// -------------------- WINNER CALCULATION --------------------

function getWinners(room) {
  if (!room) {
    return {
      players: [],
      highestScore: 0,
      winners: []
    };
  }

  const players = getPublicPlayers(room).sort(
    (a, b) => b.score - a.score
  );

  const highestScore = players[0]?.score ?? 0;

  return {
    players,
    highestScore,
    winners: players.filter(
      (player) => player.score === highestScore
    )
  };
}

// -------------------- PLAYER DISCONNECTION --------------------

function removePlayer(roomId, socket) {
  const room = rooms.get(roomId);

  if (!room) {
    return null;
  }

  const removedIndex = room.players.findIndex(
    (player) => player.socket === socket
  );

  if (removedIndex === -1) {
    return room;
  }

  const removedPlayer = room.players[removedIndex];
  const wasDrawer =
    room.currentDrawerId === removedPlayer.id;

  room.players.splice(removedIndex, 1);

  if (room.players.length === 0) {
    rooms.delete(roomId);
    return null;
  }

  // Transfer host privileges when the host disconnects.
  if (removedPlayer.id === room.hostId) {
    room.hostId = room.players[0].id;
  }

  if (room.gameStarted && !room.gameOver) {
    if (wasDrawer) {
      /*
       * The current drawer's turn is being skipped.
       * Set the index immediately before the next player,
       * because advanceTurn() increments it once.
       */
      room.turnIndex =
        (removedIndex - 1 + room.players.length) %
        room.players.length;

      room.turnComplete = true;
    } else if (removedIndex < room.turnIndex) {
      room.turnIndex -= 1;
    }

    if (room.turnIndex >= room.players.length) {
      room.turnIndex = 0;
    }

    /*
     * Preserve completed turns and allow every remaining
     * player to receive a turn in the current round.
     */
    room.totalTurns = Math.max(
      room.turnsCompleted,
      room.turnsCompleted + room.players.length
    );

    if (room.players.length < 2) {
      room.gameOver = true;
      room.currentDrawerId = null;
      room.currentWord = null;
      room.wordOptions = [];
      room.turnComplete = true;
    }
  }

  return room;
}

// -------------------- ADVANCE TO NEXT TURN --------------------

function advanceTurn(room) {
  if (!room || room.gameOver) {
    return null;
  }

  // Count the turn that just ended.
  room.turnsCompleted += 1;

  if (room.turnsCompleted >= room.totalTurns) {
    room.gameOver = true;
    room.currentDrawerId = null;
    room.currentWord = null;
    room.wordOptions = [];
    room.turnComplete = true;

    return null;
  }

  if (room.players.length < 2) {
    room.gameOver = true;
    room.currentDrawerId = null;
    room.currentWord = null;
    room.wordOptions = [];
    room.turnComplete = true;

    return null;
  }

  // Move to the next player exactly once.
  room.turnIndex =
    (room.turnIndex + 1) % room.players.length;

  // Return the prepared turn to server.js.
  return prepareNextTurn(room);
}

module.exports = {
  rooms,
  createRoom,
  joinRoom,
  getRoom,
  getPlayer,
  getPlayerBySocket,
  getPublicPlayers,
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
};
