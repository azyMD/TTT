const path = require('path');
const express = require('express');
const http = require('http');
const socketIO = require('socket.io');

// LowDB setup
const { Low, JSONFile } = require('lowdb');
const adapter = new JSONFile('db.json');
const db = new Low(adapter);

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

// Serve static files from /public
app.use(express.static(path.join(__dirname, 'public')));

// In-memory store of who’s logged in + active games
let activeUsers = {};   // { socketId: username }
let activeGames = {};   // { gameId: { player1, player2, board, currentTurn, winner } }

/**
 * Initialize the DB (LowDB) with default structure if empty.
 */
async function initDB() {
  await db.read();
  db.data ||= { users: [] }; // If db.data is undefined, set default structure
  await db.write();
}

/**
 * Get or create a user record in the database
 */
function getOrCreateUser(username) {
  const existingUser = db.data.users.find(u => u.username === username);
  if (existingUser) return existingUser;

  const newUser = {
    username,
    games: 0,
    wins: 0,
    losses: 0
  };
  db.data.users.push(newUser);
  return newUser;
}

// --- EXPRESS ROUTES ---

// Simple custom login (GET /login?username=John)
app.get('/login', async (req, res) => {
  const { username } = req.query;
  if (!username) {
    return res.status(400).json({ success: false, message: 'Username is required.' });
  }
  await initDB();
  const user = getOrCreateUser(username);
  await db.write();
  return res.json({ success: true, user });
});

// Placeholder Telegram login (GET /telegram-login)
app.get('/telegram-login', async (req, res) => {
  // In a real-world scenario, you'd perform Telegram OAuth or Widget verification here.
  // For demonstration, we just call them "TelegramUser".
  await initDB();
  const user = getOrCreateUser('TelegramUser');
  await db.write();
  return res.json({ success: true, user });
});

// --- SOCKET.IO ---

io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  // User joins the lobby
  socket.on('joinLobby', async (username) => {
    activeUsers[socket.id] = username;
    io.emit('lobbyUpdate', getLobbyUsers());
  });

  // Challenge another player
  socket.on('challengePlayer', (challengedSocketId) => {
    const challengerUsername = activeUsers[socket.id];
    const challengedUsername = activeUsers[challengedSocketId];

    // Notify challenged player
    io.to(challengedSocketId).emit('challengeReceived', {
      challengerSocketId: socket.id,
      challengerUsername
    });
  });

  // Accept challenge
  socket.on('acceptChallenge', (challengerSocketId) => {
    const player1 = challengerSocketId;
    const player2 = socket.id;

    // Create game ID
    const gameId = player1 + player2 + Date.now(); // guaranteed unique
    activeGames[gameId] = {
      player1,
      player2,
      board: Array(9).fill(null), // 3x3 TicTacToe
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

    // Update lobby (so they appear in-game)
    io.emit('lobbyUpdate', getLobbyUsers());
  });

  // Decline challenge
  socket.on('declineChallenge', (challengerSocketId) => {
    io.to(challengerSocketId).emit('challengeDeclined', {});
  });

  // Make a move
  socket.on('makeMove', async ({ gameId, index, symbol }) => {
    const game = activeGames[gameId];
    if (!game) return;
    if (game.currentTurn !== socket.id) return; // Not your turn

    // Place symbol if cell is empty
    if (game.board[index] === null) {
      game.board[index] = symbol;
      // Switch turn
      game.currentTurn = (game.currentTurn === game.player1) ? game.player2 : game.player1;

      // Check if there's a winner or draw
      const winner = checkWinner(game.board);
      game.winner = winner;

      let gameOver = false;
      await initDB();

      if (winner) {
        gameOver = true;
        // Update stats
        const winnerId = (winner === 'X') ? game.player1 : game.player2;
        const loserId  = (winner === 'X') ? game.player2 : game.player1;

        const winnerUsername = activeUsers[winnerId];
        const loserUsername  = activeUsers[loserId];

        const winnerUser = db.data.users.find(u => u.username === winnerUsername);
        const loserUser  = db.data.users.find(u => u.username === loserUsername);

        winnerUser.games += 1;
        winnerUser.wins += 1;
        loserUser.games += 1;
        loserUser.losses += 1;

        await db.write();
      } 
      else if (isDraw(game.board)) {
        gameOver = true;
        // Everyone gets a "game played" increment
        const user1Name = activeUsers[game.player1];
        const user2Name = activeUsers[game.player2];
        const user1 = db.data.users.find(u => u.username === user1Name);
        const user2 = db.data.users.find(u => u.username === user2Name);
        user1.games += 1;
        user2.games += 1;
        await db.write();
      }

      // Emit board updates
      io.to(game.player1).emit('boardUpdate', {
        board: game.board,
        yourTurn: game.currentTurn === game.player1,
        gameOver,
        winner: game.winner
      });
      io.to(game.player2).emit('boardUpdate', {
        board: game.board,
        yourTurn: game.currentTurn === game.player2,
        gameOver,
        winner: game.winner
      });

      // If game is over, remove from activeGames after a delay
      if (gameOver) {
        setTimeout(() => {
          delete activeGames[gameId];
          io.emit('lobbyUpdate', getLobbyUsers());
        }, 3000);
      }
    }
  });

  // Quit game
  socket.on('quitGame', async ({ gameId }) => {
    const game = activeGames[gameId];
    if (game) {
      const quitterId = socket.id;
      const opponentId = (quitterId === game.player1) ? game.player2 : game.player1;

      // Award opponent the win
      await initDB();
      const quitterUsername = activeUsers[quitterId];
      const opponentUsername = activeUsers[opponentId];

      const quitterUser  = db.data.users.find(u => u.username === quitterUsername);
      const opponentUser = db.data.users.find(u => u.username === opponentUsername);

      quitterUser.games += 1;
      quitterUser.losses += 1;
      opponentUser.games += 1;
      opponentUser.wins += 1;
      await db.write();

      // Notify players
      io.to(opponentId).emit('opponentQuit', {});
      io.to(quitterId).emit('youQuit', {});

      // Remove game
      delete activeGames[gameId];
      io.emit('lobbyUpdate', getLobbyUsers());
    }
  });

  // On disconnect, remove user
  socket.on('disconnect', () => {
    delete activeUsers[socket.id];
    io.emit('lobbyUpdate', getLobbyUsers());
    console.log('User disconnected:', socket.id);
  });
});

// --- HELPER FUNCTIONS ---

function getLobbyUsers() {
  // figure out who is in a game
  const inGamePlayers = new Set();
  for (const gId of Object.keys(activeGames)) {
    const g = activeGames[gId];
    inGamePlayers.add(g.player1);
    inGamePlayers.add(g.player2);
  }

  // Return array of { socketId, username, status }
  return Object.entries(activeUsers).map(([socketId, username]) => {
    const status = inGamePlayers.has(socketId) ? 'in-game' : 'available';
    return { socketId, username, status };
  });
}

// Check for winner
function checkWinner(board) {
  const combos = [
    [0,1,2], [3,4,5], [6,7,8],  // rows
    [0,3,6], [1,4,7], [2,5,8],  // columns
    [0,4,8], [2,4,6]            // diagonals
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

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, async () => {
  await initDB();
  console.log(`Server running on port ${PORT}`);
});
