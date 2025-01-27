// server.js
const path = require('path');
const express = require('express');
const http = require('http');
const socketIO = require('socket.io');

// --- LowDB v4 (CommonJS) ---
const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');

// Create DB instance
const adapter = new FileSync('db.json');
const db = low(adapter);

// If "users" doesn't exist, set a default structure
db.defaults({ users: [] }).write();

// Express / Socket setup
const app = express();
const server = http.createServer(app);
const io = socketIO(server);

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// In-memory store for active users & games
let activeUsers = {}; // { socketId: username }
let activeGames = {}; // { gameId: { player1, player2, board, currentTurn, winner } }

// Utility: Get or create a user
function getOrCreateUser(username) {
  const existing = db.get('users').find({ username }).value();
  if (existing) return existing;

  // Otherwise create a new user record
  const newUser = { username, games: 0, wins: 0, losses: 0 };
  db.get('users').push(newUser).write();
  return newUser;
}

// ---- Express Routes ----

// 1) Simple custom login: /login?username=John
app.get('/login', (req, res) => {
  const { username } = req.query;
  if (!username) {
    return res.status(400).json({ success: false, message: 'Username is required.' });
  }
  
  const user = getOrCreateUser(username);
  return res.json({ success: true, user });
});

// 2) Placeholder for Telegram login: /telegram-login
app.get('/telegram-login', (req, res) => {
  // Pretend we do Telegram OAuth. We'll just use a dummy "TelegramUser".
  const user = getOrCreateUser('TelegramUser');
  return res.json({ success: true, user });
});

// ---- Socket.IO ----
io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  // User joins lobby
  socket.on('joinLobby', (username) => {
    activeUsers[socket.id] = username;
    io.emit('lobbyUpdate', getLobbyUsers());
  });

  // Challenge a player
  socket.on('challengePlayer', (challengedSocketId) => {
    const challengerUsername = activeUsers[socket.id];
    io.to(challengedSocketId).emit('challengeReceived', {
      challengerSocketId: socket.id,
      challengerUsername
    });
  });

  // Accept challenge
  socket.on('acceptChallenge', (challengerSocketId) => {
    const player1 = challengerSocketId;
    const player2 = socket.id;

    // Create a unique game ID
    const gameId = player1 + player2 + Date.now();

    activeGames[gameId] = {
      player1,
      player2,
      board: Array(9).fill(null), // 3x3
      currentTurn: player1,
      winner: null
    };

    // Start the game for both players
    io.to(player1).emit('startGame', {
      gameId,
      yourTurn: true,
      symbol: 'X'
    });
    io.to(player2).emit('startGame', {
      gameId,
      yourTurn: false,
      symbol: 'O'
    });

    // Update lobby
    io.emit('lobbyUpdate', getLobbyUsers());
  });

  // Decline challenge
  socket.on('declineChallenge', (challengerSocketId) => {
    io.to(challengerSocketId).emit('challengeDeclined');
  });

  // Make a move
  socket.on('makeMove', ({ gameId, index, symbol }) => {
    const game = activeGames[gameId];
    if (!game) return;
    if (game.currentTurn !== socket.id) return;

    // Place the move if cell is empty
    if (game.board[index] === null) {
      game.board[index] = symbol;
      game.currentTurn = (game.currentTurn === game.player1) ? game.player2 : game.player1;

      // Check winner or draw
      const winner = checkWinner(game.board);
      game.winner = winner;

      let gameOver = false;
      if (winner) {
        gameOver = true;
        // Update stats in DB
        const winnerId = (winner === 'X') ? game.player1 : game.player2;
        const loserId  = (winner === 'X') ? game.player2 : game.player1;

        const winnerName = activeUsers[winnerId];
        const loserName  = activeUsers[loserId];

        const winnerUser = db.get('users').find({ username: winnerName }).value();
        const loserUser  = db.get('users').find({ username: loserName }).value();

        winnerUser.games += 1;
        winnerUser.wins += 1;
        loserUser.games += 1;
        loserUser.losses += 1;

        db.write(); // Save changes
      } else if (isDraw(game.board)) {
        gameOver = true;

        // Both players get a game increment
        const name1 = activeUsers[game.player1];
        const name2 = activeUsers[game.player2];

        const user1 = db.get('users').find({ username: name1 }).value();
        const user2 = db.get('users').find({ username: name2 }).value();

        user1.games += 1;
        user2.games += 1;
        db.write();
      }

      // Send updated board to both players
      io.to(game.player1).emit('boardUpdate', {
        board: game.board,
        yourTurn: game.currentTurn === game.player1,
        gameOver,
        winner
      });
      io.to(game.player2).emit('boardUpdate', {
        board: game.board,
        yourTurn: game.currentTurn === game.player2,
        gameOver,
        winner
      });

      // If over, remove game after a short delay
      if (gameOver) {
        setTimeout(() => {
          delete activeGames[gameId];
          io.emit('lobbyUpdate', getLobbyUsers());
        }, 3000);
      }
    }
  });

  // Quit game
  socket.on('quitGame', ({ gameId }) => {
    const game = activeGames[gameId];
    if (game) {
      const quitterId = socket.id;
      const opponentId = (quitterId === game.player1) ? game.player2 : game.player1;

      // Update stats => Opponent gets a win
      const quitterName = activeUsers[quitterId];
      const opponentName = activeUsers[opponentId];

      const quitterUser  = db.get('users').find({ username: quitterName }).value();
      const opponentUser = db.get('users').find({ username: opponentName }).value();

      quitterUser.games += 1;
      quitterUser.losses += 1;
      opponentUser.games += 1;
      opponentUser.wins += 1;
      db.write();

      // Notify players
      io.to(opponentId).emit('opponentQuit', {});
      io.to(quitterId).emit('youQuit', {});

      delete activeGames[gameId];
      io.emit('lobbyUpdate', getLobbyUsers());
    }
  });

  // Disconnect
  socket.on('disconnect', () => {
    delete activeUsers[socket.id];
    io.emit('lobbyUpdate', getLobbyUsers());
    console.log('User disconnected:', socket.id);
  });
});

// Helper: Return array of users with status
function getLobbyUsers() {
  const inGamePlayers = new Set();
  Object.values(activeGames).forEach((game) => {
    inGamePlayers.add(game.player1);
    inGamePlayers.add(game.player2);
  });
  return Object.entries(activeUsers).map(([socketId, username]) => {
    const status = inGamePlayers.has(socketId) ? 'in-game' : 'available';
    return { socketId, username, status };
  });
}

// TicTacToe helpers
function checkWinner(board) {
  const combos = [
    [0,1,2],[3,4,5],[6,7,8], // rows
    [0,3,6],[1,4,7],[2,5,8], // cols
    [0,4,8],[2,4,6]          // diagonals
  ];
  for (let [a,b,c] of combos) {
    if (board[a] && board[a] === board[b] && board[b] === board[c]) {
      return board[a]; // 'X' or 'O'
    }
  }
  return null;
}

function isDraw(board) {
  return board.every(cell => cell !== null);
}

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
