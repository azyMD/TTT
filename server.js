import path from 'path'
import { fileURLToPath } from 'url'
import express from 'express'
import http from 'http'
import { Server as SocketIO } from 'socket.io'
import { Low } from 'lowdb'
import { JSONFile } from 'lowdb/node'

// ESM-friendly __dirname
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// ---- 1) LowDB Setup with Default Data ----
const adapter = new JSONFile('db.json')

// Provide a default structure (so LowDB won't complain)
const defaultData = {
  users: [],
  // For example, if you need another array or object, add it here:
  // games: []
}

// Create a new Low instance with default data
const db = new Low(adapter, defaultData)

// Load or create the DB as soon as possible
async function initDB() {
  await db.read() // If db.json is empty/missing, it becomes defaultData
  // db.data is guaranteed to be { users: [] } at minimum
  await db.write() // Ensure changes are written if it was empty
}

// ---- 2) Express & Socket.IO Setup ----
const app = express()
const server = http.createServer(app)
const io = new SocketIO(server)

// Serve static files (public folder)
app.use(express.static(path.join(__dirname, 'public')))

// In-memory store for the actual TicTacToe logic
let activeUsers = {}   
let activeGames = {}

// Utility: get or create user in db.data.users
function getOrCreateUser(username) {
  let user = db.data.users.find(u => u.username === username)
  if (!user) {
    user = { username, games: 0, wins: 0, losses: 0 }
    db.data.users.push(user)
  }
  return user
}

// ---- 3) Simple Express Routes ----
app.get('/login', async (req, res) => {
  const { username } = req.query
  if (!username) {
    return res.status(400).json({ success: false, message: 'Username is required' })
  }
  await initDB()
  const user = getOrCreateUser(username)
  await db.write()
  res.json({ success: true, user })
})

app.get('/telegram-login', async (req, res) => {
  await initDB()
  const user = getOrCreateUser('TelegramUser')
  await db.write()
  res.json({ success: true, user })
})

// ---- 4) Socket.IO Events for TicTacToe ----
io.on('connection', (socket) => {
  console.log('A user connected:', socket.id)

  socket.on('joinLobby', async (username) => {
    activeUsers[socket.id] = username
    io.emit('lobbyUpdate', getLobbyUsers())
  })

  socket.on('challengePlayer', (challengedSocketId) => {
    const challengerUsername = activeUsers[socket.id]
    io.to(challengedSocketId).emit('challengeReceived', {
      challengerSocketId: socket.id,
      challengerUsername
    })
  })

  socket.on('acceptChallenge', (challengerSocketId) => {
    const player1 = challengerSocketId
    const player2 = socket.id
    const gameId = player1 + player2 + Date.now()
    activeGames[gameId] = {
      player1,
      player2,
      board: Array(9).fill(null),
      currentTurn: player1,
      winner: null
    }
    io.to(player1).emit('startGame', {
      gameId,
      yourTurn: true,
      symbol: 'X'
    })
    io.to(player2).emit('startGame', {
      gameId,
      yourTurn: false,
      symbol: 'O'
    })
    io.emit('lobbyUpdate', getLobbyUsers())
  })

  socket.on('declineChallenge', (challengerSocketId) => {
    io.to(challengerSocketId).emit('challengeDeclined')
  })

  socket.on('makeMove', async ({ gameId, index, symbol }) => {
    const game = activeGames[gameId]
    if (!game) return
    if (game.currentTurn !== socket.id) return

    if (game.board[index] === null) {
      game.board[index] = symbol
      game.currentTurn = (game.currentTurn === game.player1) ? game.player2 : game.player1
      let gameOver = false
      const winner = checkWinner(game.board)
      game.winner = winner

      await initDB()

      if (winner) {
        gameOver = true
        const winnerId = (winner === 'X') ? game.player1 : game.player2
        const loserId  = (winner === 'X') ? game.player2 : game.player1
        const winnerName = activeUsers[winnerId]
        const loserName  = activeUsers[loserId]
        const winnerUser = getOrCreateUser(winnerName)
        const loserUser  = getOrCreateUser(loserName)

        winnerUser.games += 1
        winnerUser.wins  += 1
        loserUser.games  += 1
        loserUser.losses += 1
        await db.write()
      } else if (isDraw(game.board)) {
        gameOver = true
        const name1 = activeUsers[game.player1]
        const name2 = activeUsers[game.player2]
        const user1 = getOrCreateUser(name1)
        const user2 = getOrCreateUser(name2)
        user1.games += 1
        user2.games += 1
        await db.write()
      }

      io.to(game.player1).emit('boardUpdate', {
        board: game.board,
        yourTurn: (game.currentTurn === game.player1),
        gameOver,
        winner: game.winner
      })
      io.to(game.player2).emit('boardUpdate', {
        board: game.board,
        yourTurn: (game.currentTurn === game.player2),
        gameOver,
        winner: game.winner
      })

      if (gameOver) {
        setTimeout(() => {
          delete activeGames[gameId]
          io.emit('lobbyUpdate', getLobbyUsers())
        }, 3000)
      }
    }
  })

  socket.on('quitGame', async ({ gameId }) => {
    const game = activeGames[gameId]
    if (game) {
      const quitterId = socket.id
      const opponentId = (quitterId === game.player1) ? game.player2 : game.player1

      await initDB()

      const quitterName  = activeUsers[quitterId]
      const opponentName = activeUsers[opponentId]
      const quitterUser  = getOrCreateUser(quitterName)
      const opponentUser = getOrCreateUser(opponentName)

      quitterUser.games += 1
      quitterUser.losses += 1
      opponentUser.games += 1
      opponentUser.wins  += 1
      await db.write()

      io.to(opponentId).emit('opponentQuit')
      io.to(quitterId).emit('youQuit')
      delete activeGames[gameId]
      io.emit('lobbyUpdate', getLobbyUsers())
    }
  })

  socket.on('disconnect', () => {
    delete activeUsers[socket.id]
    io.emit('lobbyUpdate', getLobbyUsers())
    console.log(`User disconnected: ${socket.id}`)
  })
})

// Helpers
function getLobbyUsers() {
  const inGamePlayers = new Set()
  Object.values(activeGames).forEach(g => {
    inGamePlayers.add(g.player1)
    inGamePlayers.add(g.player2)
  })
  return Object.entries(activeUsers).map(([id, username]) => ({
    socketId: id,
    username,
    status: inGamePlayers.has(id) ? 'in-game' : 'available'
  }))
}

function checkWinner(board) {
  const lines = [
    [0,1,2],[3,4,5],[6,7,8],  // rows
    [0,3,6],[1,4,7],[2,5,8],  // columns
    [0,4,8],[2,4,6]           // diagonals
  ]
  for (const [a,b,c] of lines) {
    if (board[a] && board[a] === board[b] && board[b] === board[c]) {
      return board[a] // 'X' or 'O'
    }
  }
  return null
}

function isDraw(board) {
  return board.every(cell => cell !== null)
}

// Start server
const PORT = process.env.PORT || 3000
server.listen(PORT, async () => {
  await initDB()
  console.log(`Server running on port ${PORT}`)
})
