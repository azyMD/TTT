const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const logError = (error) => {
  const errorLogPath = path.join(__dirname, "error.log");
  const errorMessage = `[${new Date().toISOString()}] ${error.stack || error}\n`;
  fs.appendFileSync(errorLogPath, errorMessage, "utf8");
};

const lobbyUsers = new Map();
const ongoingGames = new Map();

const generateGameId = () => `game_${Math.random().toString(36).substr(2, 8)}`;

const createEmptyBoard = () => Array(9).fill(null);

function checkWinner(board) {
  const winningCombos = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6]
  ];
  for (const [a, b, c] of winningCombos) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return board[a];
    }
  }
  return board.every((cell) => cell !== null) ? "draw" : null;
}

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("joinLobby", (username) => {
    try {
      lobbyUsers.set(socket.id, { username, inGame: false, score: { wins: 0, losses: 0, draws: 0 } });
      updateLobby();
    } catch (err) {
      logError(err);
      socket.emit("errorOccurred", "An error occurred while joining the lobby.");
    }
  });

  function updateLobby() {
    const users = Array.from(lobbyUsers.entries()).map(([id, user]) => ({
      socketId: id,
      username: user.username,
      inGame: user.inGame,
      score: user.score,
    }));
    io.emit("lobbyData", users);
  }

  socket.on("challengeUser", (opponentSocketId) => {
    try {
      const challenger = lobbyUsers.get(socket.id);
      const opponent = lobbyUsers.get(opponentSocketId);

      if (challenger && opponent && !challenger.inGame && !opponent.inGame) {
        io.to(opponentSocketId).emit("challengeRequest", {
          from: socket.id,
          fromUsername: challenger.username,
        });
      }
    } catch (err) {
      logError(err);
    }
  });

  socket.on("challengeResponse", ({ from, accepted }) => {
    try {
      const challenger = lobbyUsers.get(from);
      const responder = lobbyUsers.get(socket.id);

      if (!challenger || !responder) return;

      if (accepted && !challenger.inGame && !responder.inGame) {
        const gameId = generateGameId();
        const gameState = {
          gameId,
          board: createEmptyBoard(),
          currentPlayer: "X",
          players: [
            { socketId: from, symbol: "X", username: challenger.username },
            { socketId: socket.id, symbol: "O", username: responder.username },
          ],
          winner: null,
          replayRequests: [],
        };

        ongoingGames.set(gameId, gameState);

        challenger.inGame = true;
        responder.inGame = true;

        const fromSocket = io.sockets.sockets.get(from);
        const responderSocket = io.sockets.sockets.get(socket.id);
        fromSocket?.join(gameId);
        responderSocket?.join(gameId);

        io.to(gameId).emit("startGame", gameState);
        updateLobby();
      } else {
        io.to(from).emit("challengeDeclined", {
          reason: `${responder.username} declined your challenge.`,
        });
      }
    } catch (err) {
      logError(err);
    }
  });

  socket.on("playWithBot", () => {
    const user = lobbyUsers.get(socket.id);
    if (!user || user.inGame) return;

    const gameId = generateGameId();
    const gameState = {
      gameId,
      board: createEmptyBoard(),
      currentPlayer: "X",
      players: [
        { socketId: socket.id, symbol: "X", username: user.username },
        { socketId: "BOT", symbol: "O", username: "Bot" },
      ],
      winner: null,
      replayRequests: [],
      isBotGame: true,
    };

    ongoingGames.set(gameId, gameState);
    user.inGame = true;

    socket.join(gameId);
    io.to(socket.id).emit("startGame", gameState);
    updateLobby();
  });

  socket.on("playerMove", ({ gameId, cellIndex }) => {
    const game = ongoingGames.get(gameId);
    if (!game) return;

    if (game.board[cellIndex] !== null || game.winner) return;

    const player = game.players.find((p) => p.socketId === socket.id);
    if (!player || game.currentPlayer !== player.symbol) return;

    game.board[cellIndex] = player.symbol;

    const winner = checkWinner(game.board);
    if (winner) {
      game.winner = winner;

      if (winner === "draw") {
        game.players.forEach((p) => {
          if (p.socketId !== "BOT") lobbyUsers.get(p.socketId).score.draws++;
        });
      } else {
        const winnerPlayer = game.players.find((p) => p.symbol === winner);
        const loserPlayer = game.players.find((p) => p.symbol !== winner);

        if (winnerPlayer.socketId !== "BOT") lobbyUsers.get(winnerPlayer.socketId).score.wins++;
        if (loserPlayer.socketId !== "BOT") lobbyUsers.get(loserPlayer.socketId).score.losses++;
      }
    } else {
      game.currentPlayer = game.currentPlayer === "X" ? "O" : "X";
    }

    io.to(gameId).emit("updateGame", game);
  });

  socket.on("requestReplay", ({ gameId }) => {
    const game = ongoingGames.get(gameId);
    if (!game) return;

    if (game.isBotGame) {
      game.board = createEmptyBoard();
      game.currentPlayer = "X";
      game.winner = null;
      io.to(gameId).emit("updateGame", game);
    } else {
      if (!game.replayRequests.includes(socket.id)) {
        game.replayRequests.push(socket.id);
      }
      if (game.replayRequests.length === 2) {
        game.board = createEmptyBoard();
        game.currentPlayer = "X";
        game.winner = null;
        game.replayRequests = [];
        io.to(gameId).emit("updateGame", game);
      }
    }
  });

  socket.on("exitToLobby", ({ gameId }) => {
    const game = ongoingGames.get(gameId);
    if (!game) return;

    const user = lobbyUsers.get(socket.id);
    if (user) user.inGame = false;

    if (!game.isBotGame) {
      const opponent = game.players.find((p) => p.socketId !== socket.id);
      if (opponent) {
        lobbyUsers.get(opponent.socketId).inGame = false;
        io.to(opponent.socketId).emit("updateGame", {
          ...game,
          winner: "abandoned",
        });
      }
    }
    ongoingGames.delete(gameId);
    socket.leave(gameId);

    updateLobby();
    io.to(socket.id).emit("returnedToLobby");
  });

  socket.on("disconnect", () => {
    const user = lobbyUsers.get(socket.id);
    if (!user) return;

    user.inGame = false;
    lobbyUsers.delete(socket.id);

    const gameId = Array.from(ongoingGames.keys()).find((id) =>
      ongoingGames.get(id).players.some((p) => p.socketId === socket.id)
    );
    if (gameId) {
      const game = ongoingGames.get(gameId);
      const opponent = game.players.find((p) => p.socketId !== socket.id);
      if (opponent) {
        lobbyUsers.get(opponent.socketId).inGame = false;
        io.to(opponent.socketId).emit("updateGame", {
          ...game,
          winner: "abandoned",
        });
      }
      ongoingGames.delete(gameId);
    }

    updateLobby();
  });
});

server.listen(3000, () => {
  console.log("Server running on port 3000");
});
