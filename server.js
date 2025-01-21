const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static files
app.use(express.static("public"));

// Error logging utility
const logError = (error) => {
  const errorLogPath = path.join(__dirname, "error.log");
  const errorMessage = `[${new Date().toISOString()}] ${error.stack || error}\n`;
  fs.appendFileSync(errorLogPath, errorMessage, "utf8");
};

// Ongoing lobby and game states
const lobbyUsers = new Map(); // Stores players in the lobby
const ongoingGames = new Map(); // Stores active games

// Utility functions
const generateGameId = () => `game_${Math.random().toString(36).substr(2, 8)}`;
const createEmptyBoard = () => Array(9).fill(null);

// Check for a winner
function checkWinner(board) {
  const winningCombos = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8], // Rows
    [0, 3, 6], [1, 4, 7], [2, 5, 8], // Columns
    [0, 4, 8], [2, 4, 6],           // Diagonals
  ];
  for (const [a, b, c] of winningCombos) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return board[a];
    }
  }
  return board.every((cell) => cell !== null) ? "draw" : null;
}

// Socket.IO logic
io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  // Handle lobby join
  socket.on("joinLobby", (username) => {
    try {
      lobbyUsers.set(socket.id, { username, inGame: false });
      updateLobby();
    } catch (err) {
      logError(err);
      socket.emit("errorOccurred", "An error occurred while joining the lobby.");
    }
  });

  // Update the lobby
  const updateLobby = () => {
    const users = Array.from(lobbyUsers.entries()).map(([id, user]) => ({
      socketId: id,
      username: user.username,
      inGame: user.inGame,
    }));
    io.emit("lobbyData", users);
  };

  // Handle challenges
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

  // Handle challenge responses
  socket.on("challengeResponse", ({ from, accepted }) => {
    try {
      const challenger = lobbyUsers.get(from);
      const opponent = lobbyUsers.get(socket.id);

      if (accepted && challenger && opponent) {
        const gameId = generateGameId();
        const gameState = {
          gameId,
          board: createEmptyBoard(),
          currentPlayer: "X",
          players: [
            { socketId: from, symbol: "X", username: challenger.username },
            { socketId: socket.id, symbol: "O", username: opponent.username },
          ],
          winner: null,
        };

        ongoingGames.set(gameId, gameState);
        lobbyUsers.get(from).inGame = true;
        lobbyUsers.get(socket.id).inGame = true;

        io.to(from).emit("startGame", gameState);
        io.to(socket.id).emit("startGame", gameState);

        updateLobby();
      } else if (challenger) {
        io.to(from).emit("challengeDeclined", {
          reason: `${opponent.username} declined your challenge.`,
        });
      }
    } catch (err) {
      logError(err);
    }
  });

  // Handle moves
  socket.on("playerMove", ({ gameId, cellIndex }) => {
    try {
      console.log(`Move received: gameId=${gameId}, cellIndex=${cellIndex}, playerId=${socket.id}`);

      const game = ongoingGames.get(gameId);
      if (!game) {
        console.error("Game not found:", gameId);
        return;
      }

      if (game.board[cellIndex] !== null) {
        console.error("Invalid move: Cell already taken.");
        return;
      }

      const player = game.players.find((p) => p.socketId === socket.id);
      if (!player || game.currentPlayer !== player.symbol) {
        console.error("Invalid move: Not this player's turn.");
        return;
      }

      // Make the move
      game.board[cellIndex] = player.symbol;
      console.log("Board updated:", game.board);

      // Check for winner
      const winner = checkWinner(game.board);
      if (winner) {
        game.winner = winner;
        console.log(`Game over! Winner: ${winner}`);
      } else if (game.board.every((cell) => cell !== null)) {
        game.winner = "draw";
        console.log("Game over! It's a draw.");
      } else {
        game.currentPlayer = game.currentPlayer === "X" ? "O" : "X";
        console.log("Next turn:", game.currentPlayer);
      }

      // Broadcast the updated game state
      io.to(gameId).emit("updateGame", game);
    } catch (err) {
      logError(err);
      socket.emit("errorOccurred", "An error occurred while processing your move.");
    }
  });

  // Handle disconnections
  socket.on("disconnect", () => {
    try {
      console.log("User disconnected:", socket.id);
      const user = lobbyUsers.get(socket.id);

      if (user) {
        // Remove from lobby
        lobbyUsers.delete(socket.id);

        // End their ongoing game if any
        const gameId = Array.from(ongoingGames.keys()).find((id) =>
          ongoingGames.get(id).players.some((p) => p.socketId === socket.id)
        );

        if (gameId) {
          const game = ongoingGames.get(gameId);
          const opponent = game.players.find((p) => p.socketId !== socket.id);
          if (opponent) {
            io.to(opponent.socketId).emit("updateGame", {
              ...game,
              winner: "abandoned",
            });
          }
          ongoingGames.delete(gameId);
        }

        updateLobby();
      }
    } catch (err) {
      logError(err);
    }
  });
});

// Global error handlers
process.on("uncaughtException", (err) => {
  logError(err);
  console.error("Uncaught Exception:", err);
});

process.on("unhandledRejection", (err) => {
  logError(err);
  console.error("Unhandled Rejection:", err);
});

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
