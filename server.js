const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve the "public" folder
app.use(express.static(path.join(__dirname, "public")));

// Lobby: track { socketId => { username, inGame, score: {wins, losses, draws} } }
const lobbyUsers = new Map();

// Ongoing games: { gameId => gameState }
const ongoingGames = new Map();

function generateGameId() {
  return "game_" + Math.random().toString(36).substr(2, 8);
}

function createEmptyBoard() {
  return Array(9).fill(null);
}

function checkWinner(board) {
  const combos = [
    [0,1,2],[3,4,5],[6,7,8],
    [0,3,6],[1,4,7],[2,5,8],
    [0,4,8],[2,4,6]
  ];
  for (let [a,b,c] of combos) {
    if (board[a] && board[a] === board[b] && board[b] === board[c]) {
      return board[a]; // "X" or "O"
    }
  }
  return board.every(cell => cell !== null) ? "draw" : null;
}

// Socket.IO
io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  // Join Lobby
  socket.on("joinLobby", (username) => {
    if (lobbyUsers.has(socket.id)) return;
    lobbyUsers.set(socket.id, {
      username,
      inGame: false,
      score: { wins: 0, losses: 0, draws: 0 }
    });
    updateLobby();
  });

  function updateLobby() {
    const users = Array.from(lobbyUsers.entries()).map(([id, user]) => ({
      socketId: id,
      username: user.username,
      inGame: user.inGame,
      score: user.score
    }));
    io.emit("lobbyData", users);
  }

  // Challenge
  socket.on("challengeUser", (opponentId) => {
    const challenger = lobbyUsers.get(socket.id);
    const opponent = lobbyUsers.get(opponentId);
    if (!challenger || !opponent) return;
    if (challenger.inGame || opponent.inGame) return;

    io.to(opponentId).emit("challengeRequest", {
      from: socket.id,
      fromUsername: challenger.username
    });
  });

  socket.on("challengeResponse", ({ from, accepted }) => {
    const challenger = lobbyUsers.get(from);
    const responder = lobbyUsers.get(socket.id);
    if (!challenger || !responder) return;
    if (challenger.inGame || responder.inGame) return;

    if (accepted) {
      const gameId = generateGameId();
      const gameState = {
        gameId,
        board: createEmptyBoard(),
        currentPlayer: "X",
        players: [
          { socketId: from, symbol: "X", username: challenger.username },
          { socketId: socket.id, symbol: "O", username: responder.username }
        ],
        winner: null,
        replayRequests: []
      };

      ongoingGames.set(gameId, gameState);
      challenger.inGame = true;
      responder.inGame = true;

      // Start game for both
      io.to(from).emit("startGame", gameState);
      io.to(socket.id).emit("startGame", gameState);

      updateLobby();
    } else {
      io.to(from).emit("challengeDeclined", {
        reason: `${responder.username} declined your challenge.`
      });
    }
  });

  // Play with Bot
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
        { socketId: "BOT", symbol: "O", username: "Bot" }
      ],
      winner: null,
      replayRequests: [],
      isBotGame: true
    };

    ongoingGames.set(gameId, gameState);
    user.inGame = true;

    io.to(socket.id).emit("startGame", gameState);
    updateLobby();
  });

  // Player Move
  socket.on("playerMove", ({ gameId, cellIndex }) => {
    const game = ongoingGames.get(gameId);
    if (!game) return;
    if (game.board[cellIndex] !== null || game.winner) return;

    const player = game.players.find(p => p.socketId === socket.id);
    if (!player || player.symbol !== game.currentPlayer) return;

    game.board[cellIndex] = player.symbol;
    const result = checkWinner(game.board);

    if (result) {
      game.winner = result;
      if (result === "draw") {
        game.players.forEach((p) => {
          if (p.socketId !== "BOT") {
            lobbyUsers.get(p.socketId).score.draws++;
          }
        });
      } else {
        // We have a winner "X" or "O"
        const winnerPlayer = game.players.find((p) => p.symbol === result);
        const loserPlayer = game.players.find((p) => p.symbol !== result);
        if (winnerPlayer.socketId !== "BOT") {
          lobbyUsers.get(winnerPlayer.socketId).score.wins++;
        }
        if (loserPlayer.socketId !== "BOT") {
          lobbyUsers.get(loserPlayer.socketId).score.losses++;
        }
      }
    } else {
      game.currentPlayer = (game.currentPlayer === "X") ? "O" : "X";
      // If it's a bot game and next is "O" => do bot move
      if (game.isBotGame && game.currentPlayer === "O" && !game.winner) {
        // trivial bot: pick random empty cell
        const emptyIndices = game.board.map((val, i) => val === null ? i : null).filter(i => i !== null);
        if (emptyIndices.length) {
          const botMove = emptyIndices[Math.floor(Math.random() * emptyIndices.length)];
          game.board[botMove] = "O";
          const botResult = checkWinner(game.board);
          if (botResult) {
            game.winner = botResult;
            if (botResult === "draw") {
              // user draws
              const userPlayer = game.players.find(p => p.socketId !== "BOT");
              if (userPlayer) lobbyUsers.get(userPlayer.socketId).score.draws++;
            } else {
              // O wins or X wins
              if (botResult === "O") {
                // user loses
                const userPlayer = game.players.find(p => p.symbol === "X");
                if (userPlayer) lobbyUsers.get(userPlayer.socketId).score.losses++;
              } else {
                // "X" wins => user wins
                const userPlayer = game.players.find(p => p.symbol === "X");
                if (userPlayer) lobbyUsers.get(userPlayer.socketId).score.wins++;
              }
            }
          } else {
            game.currentPlayer = "X";
          }
        }
      }
    }

    io.to(gameId).emit("updateGame", game);
    updateLobby(); // so we see updated scores in lobby (on next refresh)
  });

  // Request Replay
  socket.on("requestReplay", ({ gameId }) => {
    const game = ongoingGames.get(gameId);
    if (!game) return;

    if (game.isBotGame) {
      // Single player => can reset immediately
      game.board = createEmptyBoard();
      game.currentPlayer = "X";
      game.winner = null;
      io.to(gameId).emit("updateGame", game);
    } else {
      // multiplayer => both must request
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

  // Exit to Lobby
  socket.on("exitToLobby", ({ gameId }) => {
    const game = ongoingGames.get(gameId);
    if (!game) return;

    const user = lobbyUsers.get(socket.id);
    if (user) user.inGame = false;

    if (!game.isBotGame) {
      const opponent = game.players.find(p => p.socketId !== socket.id);
      if (opponent && opponent.socketId !== "BOT") {
        const oppUser = lobbyUsers.get(opponent.socketId);
        if (oppUser) oppUser.inGame = false;
        io.to(opponent.socketId).emit("updateGame", {
          ...game,
          winner: "abandoned"
        });
      }
    }
    ongoingGames.delete(gameId);
    socket.leave(gameId);

    updateLobby();
    io.to(socket.id).emit("returnedToLobby");
  });

  // Disconnect
  socket.on("disconnect", () => {
    const user = lobbyUsers.get(socket.id);
    if (!user) return;

    user.inGame = false;
    lobbyUsers.delete(socket.id);

    const gameId = Array.from(ongoingGames.keys()).find(id =>
      ongoingGames.get(id).players.some(p => p.socketId === socket.id)
    );
    if (gameId) {
      const game = ongoingGames.get(gameId);
      const opponent = game.players.find(p => p.socketId !== socket.id);
      if (opponent && opponent.socketId !== "BOT") {
        lobbyUsers.get(opponent.socketId).inGame = false;
        io.to(opponent.socketId).emit("updateGame", {
          ...game,
          winner: "abandoned"
        });
      }
      ongoingGames.delete(gameId);
    }

    updateLobby();
  });
});

// IMPORTANT: Use process.env.PORT for Railway
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
