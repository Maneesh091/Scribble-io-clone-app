
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Pencil,
  Eraser,
  Trash2,
  Trophy,
  Users,
  Copy,
  Palette,
  Clock3,
  Send,
  DoorOpen,
  RotateCcw
} from "lucide-react";
import "./App.css";

const SERVER_URL = "ws://localhost:5000";

const COLORS = [
  "#111827",
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#06b6d4",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
  "#ffffff"
];

function DrawingBoard({
  isDrawer,
  socketSend,
  brushColor,
  brushSize,
  tool,
  onRemoteDraw,
  onClear,
  resetKey
}) {
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);
  const previousPointRef = useRef(null);

  const getPoint = (event) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();

    return {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))
    };
  };

  const drawSegment = useCallback((segment) => {
    const canvas = canvasRef.current;
    if (!canvas || !segment?.points || segment.points.length < 2) return;

    const ctx = canvas.getContext("2d");
    const [start, end] = segment.points;

    ctx.beginPath();
    ctx.moveTo(start.x * canvas.width, start.y * canvas.height);
    ctx.lineTo(end.x * canvas.width, end.y * canvas.height);
    ctx.strokeStyle = segment.color || "#111827";
    ctx.lineWidth = segment.size || 4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();
  }, []);

  const clearCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }, []);

  useEffect(() => {
    clearCanvas();
  }, [clearCanvas, resetKey]);

  useEffect(() => {
    onRemoteDraw.current = drawSegment;
    onClear.current = clearCanvas;
  }, [drawSegment, clearCanvas, onRemoteDraw, onClear]);

  const startDrawing = (event) => {
    if (!isDrawer) return;

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);

    drawingRef.current = true;
    previousPointRef.current = getPoint(event);
  };

  const continueDrawing = (event) => {
    if (!isDrawer || !drawingRef.current) return;

    event.preventDefault();

    const currentPoint = getPoint(event);
    const previousPoint = previousPointRef.current;

    if (!previousPoint) {
      previousPointRef.current = currentPoint;
      return;
    }

    const segment = {
      points: [previousPoint, currentPoint],
      color: tool === "eraser" ? "#ffffff" : brushColor,
      size: tool === "eraser" ? Math.max(18, brushSize * 4) : brushSize
    };

    drawSegment(segment);
    socketSend({ type: "draw", stroke: segment });

    previousPointRef.current = currentPoint;
  };

  const stopDrawing = () => {
    drawingRef.current = false;
    previousPointRef.current = null;
  };

  return (
    <canvas
      ref={canvasRef}
      className={`drawing-canvas ${isDrawer ? "can-draw" : "view-only"}`}
      width={1000}
      height={600}
      onPointerDown={startDrawing}
      onPointerMove={continueDrawing}
      onPointerUp={stopDrawing}
      onPointerCancel={stopDrawing}
      onLostPointerCapture={stopDrawing}
      aria-label={isDrawer ? "Drawing canvas" : "Live drawing"}
    />
  );
}

export default function App() {
  const socketRef = useRef(null);
  const playerIdRef = useRef("");
  const connectionAttemptRef = useRef(0);
  const onRemoteDraw = useRef(null);
  const onClear = useRef(null);
  const chatEndRef = useRef(null);

  const [connected, setConnected] = useState(false);
  const [connectionError, setConnectionError] = useState("");
  const [roomInput, setRoomInput] = useState("");
  const [roomId, setRoomId] = useState("");
  const [playerId, setPlayerId] = useState("");
  const [playerName, setPlayerName] = useState("");
  const [hostId, setHostId] = useState("");
  const [players, setPlayers] = useState([]);
  const [gameStarted, setGameStarted] = useState(false);
  const [gameOver, setGameOver] = useState(false);
  const [drawerId, setDrawerId] = useState("");
  const [drawerName, setDrawerName] = useState("");
  const [myWord, setMyWord] = useState("");
  const [wordOptions, setWordOptions] = useState([]);
  const [wordLength, setWordLength] = useState(null);
  const [wordHint, setWordHint] = useState("");
  const [turnNumber, setTurnNumber] = useState(0);
  const [totalTurns, setTotalTurns] = useState(0);
  const [timeLeft, setTimeLeft] = useState(0);
  const [messages, setMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [notice, setNotice] = useState("");
  const [winners, setWinners] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);
  const [brushColor, setBrushColor] = useState("#111827");
  const [brushSize, setBrushSize] = useState(5);
  const [tool, setTool] = useState("pencil");
  const [resetKey, setResetKey] = useState(0);
  const [hasGuessed, setHasGuessed] = useState(false);

  const isDrawer = Boolean(playerId) && drawerId === playerId;
  const isHost = Boolean(playerId) && hostId === playerId;
  const inRoom = Boolean(roomId && playerId);
  const canGuess = gameStarted && !gameOver && !isDrawer && !hasGuessed;

  const send = useCallback((payload) => {
    const socket = socketRef.current;

    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(payload));
      return true;
    }

    setNotice("Server connection lost. Please refresh and reconnect.");
    return false;
  }, []);

  useEffect(() => {
    const attemptId = ++connectionAttemptRef.current;
    const socket = new WebSocket(SERVER_URL);

    socketRef.current = socket;

    socket.onopen = () => {
      if (connectionAttemptRef.current !== attemptId) return;

      setConnected(true);
      setConnectionError("");
      setNotice("");
      console.log("DoodleDash WebSocket connected.");
    };

    socket.onmessage = (event) => {
      if (connectionAttemptRef.current !== attemptId) return;

      let data;

      try {
        data = JSON.parse(event.data);
      } catch {
        console.error("Received invalid WebSocket message.");
        return;
      }

      switch (data.type) {
        case "welcome":
          break;

        case "room_created":
        case "room_joined":
          playerIdRef.current = data.playerId || "";

          setRoomId(data.roomId);
          setRoomInput(data.roomId);
          setPlayerId(data.playerId);
          setPlayerName(data.playerName);
          setHostId(data.hostId);
          setNotice(
            data.type === "room_created"
              ? "Room created! Share the Room ID with your friends."
              : `Welcome, ${data.playerName}!`
          );

          setMessages((previous) => [
            ...previous,
            {
              id: crypto.randomUUID(),
              system: true,
              text:
                data.type === "room_created"
                  ? `Room ${data.roomId} created.`
                  : `You joined room ${data.roomId}.`
            }
          ]);
          break;

        case "player_list":
          setRoomId(data.roomId || "");
          setHostId(data.hostId || "");
          setPlayers(data.players || []);
          setTotalTurns(data.totalTurns || 0);

          if (data.gameStarted) setGameStarted(true);
          if (data.gameOver) setGameOver(true);
          break;

        case "game_started":
          setGameStarted(true);
          setGameOver(false);
          setNotice("Game started! Get ready for your turn.");
          setMyWord("");
          setWordOptions([]);
          setWordHint("");
          setHasGuessed(false);
          break;

        case "next_turn":
          setDrawerId(data.drawerId);
          setDrawerName(data.drawerName);
          setTurnNumber(data.turnNumber || 0);
          setTotalTurns(data.totalTurns || 0);
          setTimeLeft(data.duration || 60);
          setWordLength(null);
          setWordHint("");
          setMyWord("");
          setWordOptions([]);
          setHasGuessed(false);
          setResetKey((key) => key + 1);

          setNotice(
            data.drawerId === playerIdRef.current
              ? "Your turn! Choose a word to draw."
              : `${data.drawerName} is choosing a word.`
          );
          break;

        case "word_options":
          setWordOptions(data.words || []);
          setNotice("Choose one word. Keep it secret!");
          break;

        case "word_selected":
          setDrawerId(data.drawerId);
          setDrawerName(data.drawerName);
          setWordLength(data.wordLength);
          setWordHint(data.wordHint || "");
          setTimeLeft(data.duration || 60);
          setWordOptions([]);
          break;

        case "your_word":
          setMyWord(data.word);
          setNotice(`Draw: ${data.word}`);
          break;

        case "draw":
          if (data.playerId !== playerIdRef.current) {
            onRemoteDraw.current?.(data.stroke);
          }
          break;

        case "drawing_cleared":
          onClear.current?.();
          setResetKey((key) => key + 1);
          break;

        case "guess_message":
          setMessages((previous) => [
            ...previous,
            {
              id: crypto.randomUUID(),
              playerId: data.playerId,
              name: data.playerName,
              text: data.guess,
              guess: true
            }
          ]);
          break;

        case "correct_guess":
          setHasGuessed((alreadyGuessed) =>
            alreadyGuessed || data.playerId === playerIdRef.current
          );

          setMessages((previous) => [
            ...previous,
            {
              id: crypto.randomUUID(),
              system: true,
              text: `${data.playerName} guessed correctly! The word was "${data.word}".`
            }
          ]);

          setNotice(
            data.playerId === playerIdRef.current
              ? "Correct! You earned 10 points."
              : `${data.playerName} guessed the word!`
          );
          break;

        case "turn_ended":
          setMyWord("");
          setWordOptions([]);
          setWordHint("");
          setNotice(
            data.reason === "time"
              ? `Time is up! The word was "${data.word}".`
              : `The word was "${data.word}".`
          );
          break;

        case "chat_message":
          setMessages((previous) => [
            ...previous,
            {
              id: crypto.randomUUID(),
              playerId: data.playerId,
              name: data.playerName,
              text: data.text
            }
          ]);
          break;

        case "game_over":
          setGameOver(true);
          setGameStarted(true);
          setMyWord("");
          setWordOptions([]);
          setWordHint("");
          setWinners(data.winners || []);
          setLeaderboard(data.leaderboard || []);
          setNotice("Game over! Check the final leaderboard.");
          break;

        case "player_left":
          setNotice(data.message || "A player left the room.");
          break;

        case "error":
          setNotice(data.message || "Something went wrong.");
          break;

        default:
          break;
      }
    };

    socket.onerror = (event) => {
      if (connectionAttemptRef.current !== attemptId) return;

      console.error("WebSocket connection error:", event);
      setConnectionError(
        "Unable to connect. Make sure the backend is running on port 5000."
      );
    };

    socket.onclose = (event) => {
      if (connectionAttemptRef.current !== attemptId) return;

      setConnected(false);

      if (socketRef.current === socket) {
        socketRef.current = null;
      }

      console.warn(
        `WebSocket closed. Code: ${event.code}; reason: ${
          event.reason || "No reason supplied"
        }`
      );

      if (!event.wasClean) {
        setConnectionError(
          "Server connection closed. Check the backend terminal and reconnect."
        );
      }
    };

    return () => {
      if (connectionAttemptRef.current === attemptId) {
        connectionAttemptRef.current++;
      }

      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;

      if (
        socket.readyState === WebSocket.CONNECTING ||
        socket.readyState === WebSocket.OPEN
      ) {
        socket.close();
      }

      if (socketRef.current === socket) {
        socketRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!gameStarted || gameOver || timeLeft <= 0) return undefined;

    const interval = setInterval(() => {
      setTimeLeft((time) => Math.max(0, time - 1));
    }, 1000);

    return () => clearInterval(interval);
  }, [gameStarted, gameOver, turnNumber, timeLeft]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const createRoom = (event) => {
    event.preventDefault();

    if (!connected) {
      setNotice("Wait for the server connection.");
      return;
    }

    if (inRoom) {
      setNotice("You are already in a room.");
      return;
    }

    send({ type: "create_room" });
  };

  const joinRoom = (event) => {
    event.preventDefault();

    const code = roomInput.trim().toUpperCase();

    if (!connected) {
      setNotice("Wait for the server connection.");
      return;
    }

    if (inRoom) {
      setNotice("You are already in a room.");
      return;
    }

    if (!code) {
      setNotice("Enter a Room ID first.");
      return;
    }

    send({
      type: "join_room",
      roomId: code
    });
  };

  const startGame = () => {
    send({ type: "start_game" });
  };

  const chooseWord = (word) => {
    send({ type: "select_word", word });
  };

  const clearDrawing = () => {
    send({ type: "clear_canvas" });
    onClear.current?.();
    setResetKey((key) => key + 1);
  };

  const submitChat = (event) => {
    event.preventDefault();

    const text = chatInput.trim();
    if (!text) return;

    if (canGuess) {
      send({ type: "guess", guess: text });
    } else {
      send({ type: "chat", text });
    }

    setChatInput("");
  };

  const copyRoomId = async () => {
    try {
      await navigator.clipboard.writeText(roomId);
      setNotice("Room ID copied!");
    } catch {
      setNotice(`Room ID: ${roomId}`);
    }
  };

  const leaveRoom = () => {
    setNotice("To leave safely, close this tab and re-open DoodleDash.");
    setTimeout(() => window.location.reload(), 800);
  };

  const sortedPlayers = [...players].sort((a, b) => b.score - a.score);

  if (gameOver) {
    const finalPlayers = leaderboard.length
      ? leaderboard
      : sortedPlayers;

    return (
      <main className="app-shell">
        <section className="winner-page">
          <div className="winner-icon"><Trophy size={42} /></div>
          <p className="eyebrow">DOODLEDASH CHAMPIONSHIP</p>
          <h1>Game over!</h1>
          <p className="muted">
            {winners.length === 1
              ? `${winners[0].name} wins the game!`
              : winners.length > 1
                ? `It's a tie between ${winners.map((winner) => winner.name).join(", ")}!`
                : "Thanks for playing!"}
          </p>

          <div className="final-board">
            <h2><Trophy size={20} /> Final leaderboard</h2>
            {finalPlayers.map((player, index) => (
              <div className="score-row" key={player.id}>
                <span className="rank">{index + 1}</span>
                <span className="score-player">
                  {player.name}
                  {player.id === playerId ? " (You)" : ""}
                </span>
                <strong>{player.score} pts</strong>
              </div>
            ))}
          </div>

          <button
            className="primary-button"
            onClick={() => window.location.reload()}
          >
            <RotateCcw size={18} /> Play again
          </button>
        </section>
      </main>
    );
  }

  if (!inRoom) {
    return (
      <main className="app-shell">
        <header className="topbar">
          <a className="brand" href="/">
            <span className="brand-icon"><Pencil size={21} /></span>
            DoodleDash
          </a>
          <span className={`connection ${connected ? "online" : "offline"}`}>
            <span className="status-dot" />
            {connected ? "Server connected" : "Connecting…"}
          </span>
        </header>

        <section className="hero">
          <div className="hero-badge">🎨 DRAW · GUESS · WIN</div>
          <h1>Your doodle.<br /><span>Your victory.</span></h1>
          <p>
            Draw secret words, guess your friends’ sketches, and race to the top
            of the leaderboard.
          </p>

          <div className="lobby-grid">
            <article className="lobby-card create-card">
              <div className="card-icon"><Pencil size={23} /></div>
              <h2>Create a room</h2>
              <p>Start a new game and invite your friends.</p>
              <button
                className="primary-button full-width"
                onClick={createRoom}
                disabled={!connected}
              >
                Create room
              </button>
            </article>

            <article className="lobby-card join-card">
              <div className="card-icon secondary-icon"><DoorOpen size={23} /></div>
              <h2>Join a room</h2>
              <p>Got a Room ID? Jump straight into the game.</p>
              <form onSubmit={joinRoom}>
                <label htmlFor="room-id">Room ID</label>
                <input
                  id="room-id"
                  type="text"
                  value={roomInput}
                  onChange={(event) =>
                    setRoomInput(event.target.value.toUpperCase())
                  }
                  placeholder="e.g. AB12CD"
                  autoComplete="off"
                  maxLength={6}
                  spellCheck={false}
                  required
                />
                <button
                  className="primary-button full-width"
                  type="submit"
                  disabled={!connected}
                >
                  Join game
                </button>
              </form>
            </article>
          </div>

          <div className="lobby-note">
            <Users size={17} />
            Player names are generated automatically. No signup needed.
          </div>

          {(notice || connectionError) && (
            <p className="notice" role="status">
              {connectionError || notice}
            </p>
          )}
        </section>
      </main>
    );
  }

  return (
    <main className="game-shell">
      <header className="topbar game-topbar">
        <a className="brand" href="/">
          <span className="brand-icon"><Pencil size={21} /></span>
          DoodleDash
        </a>

        <div className="room-chip">
          <span>ROOM</span>
          <strong>{roomId}</strong>
          <button
            className="icon-button"
            onClick={copyRoomId}
            title="Copy Room ID"
          >
            <Copy size={16} />
          </button>
        </div>

        <div className={`connection ${connected ? "online" : "offline"}`}>
          <span className="status-dot" />
          {connected ? "Connected" : "Disconnected"}
        </div>
      </header>

      {notice && <div className="notice game-notice" role="status">{notice}</div>}

      <div className="game-layout">
        <aside className="side-panel players-panel">
          <div className="panel-heading">
            <h2><Users size={18} /> Players</h2>
            <span className="count-pill">{players.length}/8</span>
          </div>

          <div className="players-list">
            {sortedPlayers.map((player, index) => (
              <div className="player-row" key={player.id}>
                <div className={`player-avatar avatar-${index % 6}`}>
                  {player.name.charAt(0)}
                </div>
                <div className="player-info">
                  <strong>
                    {player.name}
                    {player.id === playerId ? " (You)" : ""}
                  </strong>
                  {player.id === hostId && <span className="host-label">HOST</span>}
                  {player.id === drawerId && gameStarted && (
                    <span className="drawer-label">DRAWING</span>
                  )}
                </div>
                <span className="player-score">{player.score}</span>
              </div>
            ))}
          </div>

          {!gameStarted && (
            <div className="host-controls">
              {isHost ? (
                <button
                  className="primary-button full-width"
                  onClick={startGame}
                  disabled={!connected || players.length < 2}
                >
                  Start game
                </button>
              ) : (
                <p className="waiting-text">Waiting for the host to start…</p>
              )}
              {players.length < 2 && (
                <small>At least 2 players are needed.</small>
              )}
            </div>
          )}

          <div className="rules-box">
            <strong>How to play</strong>
            <p>
              Guess correctly to earn 10 points. The drawer earns 5 points for
              a correct guess.
            </p>
          </div>

          <button className="text-button leave-button" onClick={leaveRoom}>
            Leave room
          </button>
        </aside>

        <section className="center-panel">
          <div className="turn-bar">
            <div className="turn-info">
              <span className="turn-label">
                {!gameStarted
                  ? "LOBBY"
                  : isDrawer
                    ? "YOUR TURN TO DRAW"
                    : `${drawerName || "Player"} IS DRAWING`}
              </span>
              <strong>
                {!gameStarted
                  ? "Waiting for the game to start"
                  : isDrawer
                    ? myWord
                      ? `Word: ${myWord}`
                      : "Choose your secret word"
                    : wordLength
                      ? `Hint: ${wordHint || "_ ".repeat(wordLength)}`
                      : "Get ready to guess!"}
              </strong>
            </div>
            {gameStarted && (
              <div className={`timer ${timeLeft <= 10 ? "timer-low" : ""}`}>
                <Clock3 size={17} />
                <strong>{`0:${String(timeLeft).padStart(2, "0")}`}</strong>
              </div>
            )}
          </div>

          {wordOptions.length > 0 && isDrawer && (
            <div className="word-picker">
              <strong>Choose a word to draw</strong>
              <div className="word-options">
                {wordOptions.map((word) => (
                  <button key={word} onClick={() => chooseWord(word)}>
                    {word}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="canvas-wrap">
            <DrawingBoard
              isDrawer={isDrawer && Boolean(myWord) && !gameOver}
              socketSend={send}
              brushColor={brushColor}
              brushSize={brushSize}
              tool={tool}
              onRemoteDraw={onRemoteDraw}
              onClear={onClear}
              resetKey={resetKey}
            />

            {!gameStarted && (
              <div className="canvas-placeholder">
                <div className="placeholder-icon"><Pencil size={30} /></div>
                <h3>Your canvas awaits!</h3>
                <p>
                  {isHost
                    ? "Invite a friend using the Room ID, then start the game."
                    : "Hang tight. The host will start the game soon."}
                </p>
              </div>
            )}
          </div>

          {isDrawer && myWord && !gameOver && (
            <div className="drawing-toolbar">
              <div className="tool-group">
                <button
                  className={tool === "pencil" ? "tool-button active" : "tool-button"}
                  onClick={() => setTool("pencil")}
                  title="Pencil"
                >
                  <Pencil size={17} />
                </button>
                <button
                  className={tool === "eraser" ? "tool-button active" : "tool-button"}
                  onClick={() => setTool("eraser")}
                  title="Eraser"
                >
                  <Eraser size={17} />
                </button>
                <button
                  className="tool-button"
                  onClick={clearDrawing}
                  title="Clear canvas"
                >
                  <Trash2 size={17} />
                </button>
              </div>

              <div className="color-group" aria-label="Brush color">
                <Palette size={17} />
                {COLORS.map((color) => (
                  <button
                    key={color}
                    className={`color-swatch ${brushColor === color ? "selected" : ""}`}
                    style={{ backgroundColor: color }}
                    onClick={() => setBrushColor(color)}
                    aria-label={`Select ${color}`}
                  />
                ))}
              </div>

              <label className="brush-control">
                <span>Size</span>
                <input
                  type="range"
                  min="2"
                  max="18"
                  value={brushSize}
                  onChange={(event) => setBrushSize(Number(event.target.value))}
                />
              </label>
            </div>
          )}

          <div className="turn-footer">
            <span>Turn {turnNumber || 0} of {totalTurns || 0}</span>
            <span>{players.length} players in this room</span>
          </div>
        </section>

        <aside className="side-panel chat-panel">
          <div className="panel-heading">
            <h2><Send size={17} /> Chat & guesses</h2>
          </div>

          <div className="chat-messages">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`chat-message ${message.system ? "system-message" : ""} ${message.guess ? "guess-message" : ""}`}
              >
                {message.system ? (
                  <span>{message.text}</span>
                ) : (
                  <>
                    <strong>{message.name}</strong>
                    <span>{message.text}</span>
                  </>
                )}
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>

          <form className="chat-form" onSubmit={submitChat}>
            <input
              type="text"
              value={chatInput}
              onChange={(event) => setChatInput(event.target.value)}
              placeholder={
                canGuess
                  ? "Type your guess…"
                  : isDrawer
                    ? "You're drawing!"
                    : "Send a message…"
              }
              maxLength={250}
              disabled={!connected || !gameStarted || gameOver}
              autoComplete="off"
            />
            <button
              type="submit"
              disabled={
                !connected || !gameStarted || gameOver || !chatInput.trim()
              }
              aria-label="Send message"
            >
              <Send size={17} />
            </button>
          </form>
          <p className="chat-hint">
            {canGuess
              ? "Guesses are checked automatically."
              : isDrawer
                ? "Keep your word secret!"
                : "Chat with your room."}
          </p>
        </aside>
      </div>
    </main>
  );
}
