const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static files from the "public" folder
app.use(express.static("public"));

// Utility function to log errors
const logError = (error) => {
  const errorLogPath = path.join(__dirname, "error.log");
  const errorMessage = `[${new Date().toISOString()}] ${error.stack || error}\n`;
  fs.appendFileSync(errorLogPath, errorMessage, "utf8");
};

// Track lobby users and ongoing games
const lobbyUsers = new Map();
const ongoingGames = new Map();

// Generate a random game ID
const generateGameId = () => `game_${Math.random().toString(36).substr(2, 8)}`;

// Create an empty 9‐cell board
const createEmptyBoard = () => Array(9).fill(null);

// Check for a winner (or draw)
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
  // Check if all cells are filled (draw)
  return board.every((cell) => cell !== null) ? "draw" : null;
}

// Socket.IO setup
io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  // ---------------------
  // Handle Lobby Join
  // ---------------------
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
  function updateLobby() {
    const users = Array.from(lobbyUsers.entries()).map(([id, user]) => ({
      socketId: id,
      username: user.username,
      inGame: user.inGame,
    }));
    io.emit("lobbyData", users);
  }

  // ---------------------
  // Handle "Play with Bot" (Optional/Placeholder)
  // ---------------------
  socket.on("playWithBot", () => {
    console.log(`User ${socket.id} requested to play with bot.`);
    // TODO: Implement your bot logic or match them against an AI
    // For now, just an example placeholder
    socket.emit("errorOccurred", "Bot play is not implemented yet.");
  });

  // ---------------------
  // Handle Challenges
  // ---------------------
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
      const opponent = lobbyUsers.get(socket.id);

      if (!challenger || !opponent) return;

      if (accepted && !challenger.inGame && !opponent.inGame) {
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

        // Store the game
        ongoingGames.set(gameId, gameState);

        // Mark both users as in‐game
        challenger.inGame = true;
        opponent.inGame = true;

        // **Join both players to a socket.io room identified by gameId**
        const fromSocket = io.sockets.sockets.get(from);
        const opponentSocket = io.sockets.sockets.get(socket.id);
        fromSocket?.join(gameId);
        opponentSocket?.join(gameId);

        // Emit the start game event to both players
        io.to(gameId).emit("startGame", gameState);

        // Update the lobby so everyone sees they are in‐game
        updateLobby();
      } else {
        // Declined case
        io.to(from).emit("challengeDeclined", {
          reason: `${opponent.username} declined your challenge.`,
        });
      }
    } catch (err) {
      logError(err);
    }
  });

  // ---------------------
  // Handle Player Moves
  // ---------------------
  socket.on("playerMove", ({ gameId, cellIndex }) => {
    try {
      console.log(
        `Move received: gameId=${gameId}, cellIndex=${cellIndex}, playerId=${socket.id}`
      );

      const game = ongoingGames.get(gameId);
      if (!game) {
        console.error("Game not found:", gameId);
        return;
      }

      // Check if cell is already taken
      if (game.board[cellIndex] !== null) {
        console.error("Invalid move: Cell already taken.");
        return;
      }

      // Check if it's this player's turn
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
      } else {
        // Otherwise, switch current player
        game.currentPlayer = game.currentPlayer === "X" ? "O" : "X";
      }

      // Broadcast the updated game state to both players in the room
      io.to(gameId).emit("updateGame", game);
    } catch (err) {
      logError(err);
      socket.emit("errorOccurred", "An error occurred while processing your move.");
    }
  });

  // ---------------------
  // Handle Disconnection
  // ---------------------
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
          if (game) {
            // Let the opponent know the game was abandoned
            const opponent = game.players.find((p) => p.socketId !== socket.id);
            if (opponent) {
              io.to(opponent.socketId).emit("updateGame", {
                ...game,
                winner: "abandoned",
              });
            }
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

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
